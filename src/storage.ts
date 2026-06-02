import { KoolbaseConfig, UploadOptions, UploadResult, KoolbaseObject } from './types';
import {
  KoolbaseStorageError,
  koolbaseStorageErrorFromResponse,
} from './storage-errors';

/**
 * Koolbase storage client — uploads, downloads, and deletes via presigned
 * Cloudflare R2 URLs.
 *
 * Uploads are **safe-by-default** (v5+): an upload to a path where an object
 * already exists is rejected with {@link KoolbaseStorageConflictError} unless
 * `overwrite: true` is passed.
 */
export class KoolbaseStorage {
  private config: KoolbaseConfig;
  private getToken: () => Promise<string | null>;

  constructor(config: KoolbaseConfig, getToken: () => Promise<string | null>) {
    this.config = config;
    this.getToken = getToken;
  }

  private async buildHeaders(): Promise<Record<string, string>> {
    const token = await this.getToken();
    return {
      'x-api-key': this.config.publicKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  /**
   * Upload a file to a bucket. Returns the object metadata and a download URL.
   *
   * By default (`overwrite: false`), uploads to a path where an object
   * already exists are **rejected** with a {@link KoolbaseStorageConflictError}.
   * Catch it to prompt the user, then retry with `overwrite: true` to replace
   * the existing object — or with a different `path`.
   *
   * Set `overwrite: true` for true upsert semantics — silently replace any
   * existing object at this path.
   *
   * Pass `options.metadata` to attach arbitrary user-defined key/value pairs
   * to the object at confirm time. Subject to the limits documented on
   * {@link KoolbaseObject.metadata}; violations throw
   * `KoolbaseStorageMetadataInvalidError`. On the `overwrite: true` path the
   * metadata REPLACES any prior metadata at this path (matches GCS semantics).
   * Use {@link updateMetadata} for post-upload merge changes.
   *
   * **Breaking change in v5.0.0**: the default flipped from silent overwrite
   * (legacy behavior) to safe-by-default. If you previously relied on uploads
   * overwriting silently, pass `overwrite: true` explicitly.
   */
  async upload(options: UploadOptions): Promise<UploadResult> {
    const overwrite = options.overwrite ?? false;
    const contentType = options.file.type;

    // ─── Step 1: Get presigned upload URL ───
    const urlRes = await fetch(
      `${this.config.baseUrl}/v1/sdk/storage/upload-url`,
      {
        method: 'POST',
        headers: {
          ...(await this.buildHeaders()),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bucket: options.bucket,
          path: options.path,
          content_type: contentType,
          overwrite,
        }),
      }
    );
    if (!urlRes.ok) {
      throw await koolbaseStorageErrorFromResponse(urlRes, 'Failed to get upload URL');
    }
    const { upload_url } = (await urlRes.json()) as { upload_url: string };

    // ─── Step 2: Upload directly to R2 ───
    // RN's fetch resolves local file URIs and Blob bodies on a raw PUT.
    // R2 presigned URLs expect raw binary, NOT multipart/form-data.
    const fileResp = await fetch(options.file.uri);
    const fileBlob = await fileResp.blob();
    const fileSize = fileBlob.size;

    const uploadRes = await fetch(upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: fileBlob,
    });
    if (!uploadRes.ok) {
      // R2 PUT errors don't follow the Koolbase error shape — surface as a
      // generic storage error rather than trying to decode a Koolbase body.
      throw new KoolbaseStorageError(
        `Upload to storage failed: ${uploadRes.status}`
      );
    }
    const etag = uploadRes.headers.get('etag') ?? '';

    // ─── Step 3: Confirm upload ───
    // Build the body conditionally so the `metadata` field is only sent
    // when the caller passed it — keeps the wire shape clean for callers
    // that don't care, and lets the server's omitempty path treat absent
    // as "no metadata."
    const confirmBody: Record<string, unknown> = {
      bucket: options.bucket,
      path: options.path,
      size: fileSize,
      content_type: contentType,
      etag,
      overwrite,
    };
    if (options.metadata !== undefined) {
      confirmBody.metadata = options.metadata;
    }

    const confirmRes = await fetch(
      `${this.config.baseUrl}/v1/sdk/storage/confirm`,
      {
        method: 'POST',
        headers: {
          ...(await this.buildHeaders()),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(confirmBody),
      }
    );
    if (!confirmRes.ok) {
      throw await koolbaseStorageErrorFromResponse(
        confirmRes,
        'Failed to confirm upload'
      );
    }
    const raw = await confirmRes.json();
    const object = mapObjectFromServer(raw);

    // ─── Step 4: Get download URL ───
    const downloadUrl = await this.getDownloadUrl(options.bucket, options.path);

    return { object, downloadUrl };
  }

  /**
   * Apply a partial metadata update to an existing object. Returns the
   * post-update {@link KoolbaseObject} with the merged metadata.
   *
   * **Merge semantics** (mirrors the server's JSONB merge):
   *
   * - Keys with a non-null string value are SET — added if missing,
   *   replacing any existing value at the key otherwise.
   * - Keys with `null` are DELETED from the stored metadata.
   * - Keys ABSENT from `metadata` are untouched — pre-existing entries
   *   for those keys remain unchanged.
   *
   * Validation runs server-side against the same rules as upload-time
   * metadata; violations throw `KoolbaseStorageMetadataInvalidError`,
   * whose `detail` field names the failing key and rule. The check is
   * performed against the projected post-merge state, so adding a key
   * that would push the object past the 50-key or 8KB ceiling is
   * rejected before the row is mutated.
   *
   * @example
   * // Add a tag, update an existing key, and drop another in one call:
   * const updated = await Koolbase.storage.updateMetadata(
   *   'photos',
   *   'sunset.jpg',
   *   {
   *     category: 'landscape',  // SET or UPDATE
   *     tag:      'sunset',     // SET or UPDATE
   *     owner:    null,         // DELETE
   *   }
   * );
   * console.log(updated.metadata);
   * // -> { category: 'landscape', tag: 'sunset' }
   */
  async updateMetadata(
    bucket: string,
    path: string,
    metadata: Record<string, string | null>
  ): Promise<KoolbaseObject> {
    const res = await fetch(
      `${this.config.baseUrl}/v1/sdk/storage/objects/metadata`,
      {
        method: 'PATCH',
        headers: {
          ...(await this.buildHeaders()),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ bucket, path, metadata }),
      }
    );
    if (!res.ok) {
      throw await koolbaseStorageErrorFromResponse(res, 'Failed to update metadata');
    }
    const raw = await res.json();
    return mapObjectFromServer(raw);
  }

  /**
   * Get a signed download URL for a file.
   */
  async getDownloadUrl(bucket: string, path: string): Promise<string> {
    const url =
      `${this.config.baseUrl}/v1/sdk/storage/download-url` +
      `?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
    const res = await fetch(url, { headers: await this.buildHeaders() });
    if (!res.ok) {
      throw await koolbaseStorageErrorFromResponse(res, 'Failed to get download URL');
    }
    const data = (await res.json()) as { url: string };
    return data.url;
  }

  /**
   * Delete a file from a bucket.
   */
  async delete(bucket: string, path: string): Promise<void> {
    const res = await fetch(`${this.config.baseUrl}/v1/sdk/storage/object`, {
      method: 'DELETE',
      headers: {
        ...(await this.buildHeaders()),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bucket, path }),
    });
    if (res.status === 204) return;
    if (!res.ok) {
      throw await koolbaseStorageErrorFromResponse(res, 'Failed to delete file');
    }
  }
}

/**
 * Maps the snake_case server JSON to the camelCase {@link KoolbaseObject}.
 * Defensive: missing or null `metadata` (older / non-Koolbase responses)
 * is coerced to an empty object so callers always see a typed
 * `Record<string, string>` rather than null.
 */
function mapObjectFromServer(raw: any): KoolbaseObject {
  return {
    id: raw.id,
    projectId: raw.project_id,
    bucketId: raw.bucket_id,
    userId: raw.user_id ?? null,
    path: raw.path,
    size: raw.size ?? 0,
    contentType: raw.content_type ?? null,
    metadata: (raw.metadata as Record<string, string> | undefined) ?? {},
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}
