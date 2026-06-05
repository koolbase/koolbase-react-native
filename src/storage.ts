import {
  KoolbaseConfig,
  UploadOptions,
  UploadResult,
  KoolbaseObject,
  KoolbaseObjectVersion,
  KoolbaseImageTransform,
} from './types';
import {
  KoolbaseStorageError,
  koolbaseStorageErrorFromResponse,
} from './storage-errors';


// --- Cloudflare image-transform URL helpers -------------------------------
// Module-private — callers use KoolbaseStorage.publicUrl / publicUrlForObject.

function clampInt(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(v)));
}

/**
 * Serializes a transform spec to Cloudflare's comma-separated key=value
 * options segment (e.g. `width=400,format=webp,quality=80`). Returns the
 * empty string when no fields are set — callers can use that to skip the
 * `/cdn-cgi/image/` URL prefix entirely.
 */
function serializeTransform(t: KoolbaseImageTransform): string {
  const parts: string[] = [];
  if (t.width != null) parts.push(`width=${clampInt(t.width, 1, 2000)}`);
  if (t.height != null) parts.push(`height=${clampInt(t.height, 1, 2000)}`);
  if (t.format) parts.push(`format=${t.format}`);
  if (t.quality != null) parts.push(`quality=${clampInt(t.quality, 1, 100)}`);
  if (t.fit) parts.push(`fit=${t.fit}`);
  if (t.dpr != null) parts.push(`dpr=${clampInt(t.dpr, 1, 3)}`);
  if (t.gravity) parts.push(`gravity=${t.gravity}`);
  return parts.join(',');
}

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
  async getDownloadUrl(bucket: string, path: string, versionId?: string): Promise<string> {
    let url =
      `${this.config.baseUrl}/v1/sdk/storage/download-url` +
      `?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
    if (versionId) {
      url += `&version_id=${encodeURIComponent(versionId)}`;
    }
    const res = await fetch(url, { headers: await this.buildHeaders() });
    if (!res.ok) {
      throw await koolbaseStorageErrorFromResponse(res, 'Failed to get download URL');
    }
    const data = (await res.json()) as { url: string };
    return data.url;
  }

  /**
   * Build the stable public CDN URL for a file in a public bucket.
   *
   * Returns the URL unconditionally — no check on whether the file
   * exists or whether the bucket is actually public. Use when you
   * know the file is in a public bucket and want the URL without a
   * network round-trip (build-time URL generation, server-side
   * rendering, batch image processing, etc.).
   *
   * For safer construction from an Object you already have, use
   * {@link KoolbaseStorage.publicUrlForObject} — it checks the stored
   * `r2Bucket` value and returns `null` when the object isn't in the
   * public R2 bucket.
   */
  static publicUrl(args: {
    projectId: string;
    bucket: string;
    path: string;
    /**
     * Optional Cloudflare Image Transformations. Adds a `/cdn-cgi/image/`
     * URL prefix; billed against the koolbase.com zone's free monthly
     * allocation (5,000 unique transforms/month). Each unique combination
     * of `path` + options is cached and billed only once per calendar month.
     */
    transform?: KoolbaseImageTransform;
  }): string {
    // Encode each path segment individually so slashes are preserved
    // while spaces, parens, hashes, and query characters are escaped.
    const encoded = args.path.split('/').map(encodeURIComponent).join('/');
    const opts = args.transform ? serializeTransform(args.transform) : '';
    if (!opts) {
      return `https://cdn.koolbase.com/${args.projectId}/${args.bucket}/${encoded}`;
    }
    return `https://cdn.koolbase.com/cdn-cgi/image/${opts}/${args.projectId}/${args.bucket}/${encoded}`;
  }

  /**
   * Returns the stable CDN URL for an object when its bytes physically
   * live in the public R2 bucket, `null` otherwise.
   *
   * Returns `null` for:
   * - Files in private buckets (no public URL ever)
   * - Legacy files in public buckets whose bytes still live in the
   *   private R2 bucket from before Gap #2 (no permanent URL until
   *   they're re-uploaded)
   *
   * The bucket name must be supplied because {@link KoolbaseObject}
   * carries only the bucket ID, not its name. Typically the caller
   * already knows which bucket they queried.
   */
  static publicUrlForObject(
    obj: KoolbaseObject,
    bucket: string,
    options?: { transform?: KoolbaseImageTransform },
  ): string | null {
    if (obj.r2Bucket !== 'koolbase-storage-public') return null;
    return KoolbaseStorage.publicUrl({
      projectId: obj.projectId,
      bucket,
      path: obj.path,
      transform: options?.transform,
    });
  }

  /**
   * Builds a named-preset CDN URL. The preset is resolved at the Cloudflare
   * edge by the koolbase-cdn-worker, which looks up
   * `preset:{project_id}:{preset_name}` in Workers KV and applies the stored
   * transformation options. Presets are managed in the dashboard under
   * Storage → Presets.
   *
   * Unknown preset names yield a 404 at the edge — the URL itself always
   * constructs successfully without a network round-trip.
   *
   * For safer construction from an Object you already have, use
   * {@link KoolbaseStorage.publicUrlForObjectWithPreset} — it checks the
   * stored `r2Bucket` value and returns `null` when the object isn't in the
   * public R2 bucket.
   */
  static publicUrlWithPreset(args: {
    projectId: string;
    presetName: string;
    bucket: string;
    path: string;
  }): string {
    const encoded = args.path.split('/').map(encodeURIComponent).join('/');
    return `https://cdn.koolbase.com/p/${args.projectId}/${args.presetName}/${args.bucket}/${encoded}`;
  }

  /**
   * Returns the named-preset CDN URL for the given object, or `null` if the
   * object isn't in the public R2 bucket.
   */
  static publicUrlForObjectWithPreset(
    obj: KoolbaseObject,
    bucket: string,
    presetName: string,
  ): string | null {
    if (obj.r2Bucket !== 'koolbase-storage-public') return null;
    return KoolbaseStorage.publicUrlWithPreset({
      projectId: obj.projectId,
      presetName,
      bucket,
      path: obj.path,
    });
  }

  /**
   * Delete a file from a bucket.
   */
  async delete(bucket: string, path: string, forcePurge?: boolean): Promise<void> {
    const url = forcePurge
      ? `${this.config.baseUrl}/v1/sdk/storage/object?force_purge=true`
      : `${this.config.baseUrl}/v1/sdk/storage/object`;
    const res = await fetch(url, {
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

  /**
   * List all versions of a file path, newest-first. Returns a flat list
   * mixing the current row (with `isCurrent: true`) and all history
   * rows. Delete markers are included so callers can render the full
   * timeline; filter client-side to hide them if the UI only wants
   * restorable versions.
   *
   * Returns an empty array (not an error) when the path has no history
   * and no current row.
   */
  async listVersions(bucket: string, path: string): Promise<KoolbaseObjectVersion[]> {
    const url =
      `${this.config.baseUrl}/v1/sdk/storage/object-versions` +
      `?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
    const res = await fetch(url, { headers: await this.buildHeaders() });
    if (!res.ok) {
      throw await koolbaseStorageErrorFromResponse(res, 'Failed to list versions');
    }
    const data = (await res.json()) as { versions?: unknown[] };
    const list = Array.isArray(data.versions) ? data.versions : [];
    return list.map((v) => fromVersionJson(v as Record<string, unknown>));
  }

  /**
   * Fetch metadata for a single version by id. Works against both the
   * current row and any history row — the response's `isCurrent` tells
   * you which.
   */
  async getVersion(
    bucket: string,
    path: string,
    versionId: string,
  ): Promise<KoolbaseObjectVersion> {
    const url =
      `${this.config.baseUrl}/v1/sdk/storage/object-versions/${encodeURIComponent(versionId)}` +
      `?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
    const res = await fetch(url, { headers: await this.buildHeaders() });
    if (!res.ok) {
      throw await koolbaseStorageErrorFromResponse(res, 'Failed to fetch version');
    }
    return fromVersionJson((await res.json()) as Record<string, unknown>);
  }

  /**
   * Bring a history version back as the current version. The
   * previously-current row (if any) is snapshotted into history first,
   * so this operation is itself a versioned event you can undo. The
   * restored row gets a freshly-minted version_id; the target stays in
   * history at its original version_id.
   *
   * Throws if the bucket has versioning off, if the target is the
   * already-current version, or if the target is a delete marker.
   */
  async restoreVersion(
    bucket: string,
    path: string,
    versionId: string,
  ): Promise<KoolbaseObject> {
    const url =
      `${this.config.baseUrl}/v1/sdk/storage/object-versions/${encodeURIComponent(versionId)}/restore` +
      `?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: await this.buildHeaders(),
    });
    if (!res.ok) {
      throw await koolbaseStorageErrorFromResponse(res, 'Failed to restore version');
    }
    return mapObjectFromServer(await res.json());
  }

  /**
   * Hard-remove a single history version — both the metadata row and
   * the .versions/ R2 bytes (or just the row, for delete markers).
   * Refuses to operate on the current version; use {@link delete} with
   * `forcePurge: true` to wipe everything for a path.
   */
  async purgeVersion(bucket: string, path: string, versionId: string): Promise<void> {
    const url =
      `${this.config.baseUrl}/v1/sdk/storage/object-versions/${encodeURIComponent(versionId)}` +
      `?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: await this.buildHeaders(),
    });
    if (res.status === 204) return;
    if (!res.ok) {
      throw await koolbaseStorageErrorFromResponse(res, 'Failed to purge version');
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
    r2Bucket: raw.r2_bucket ?? 'koolbase-storage',
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

/**
 * Maps the snake_case server JSON of a version row to the camelCase
 * {@link KoolbaseObjectVersion}. Mirrors `fromObjectJson` shape.
 */
function fromVersionJson(j: Record<string, unknown>): KoolbaseObjectVersion {
  const rawMeta = j.metadata;
  const metadata: Record<string, string> = {};
  if (rawMeta && typeof rawMeta === 'object') {
    for (const [k, v] of Object.entries(rawMeta as Record<string, unknown>)) {
      if (typeof v === 'string') metadata[k] = v;
    }
  }
  return {
    versionId: (j.version_id as string | null) ?? null,
    path: j.path as string,
    size: Number(j.size ?? 0),
    contentType: (j.content_type as string | null) ?? null,
    etag: (j.etag as string | null) ?? null,
    metadata,
    r2Bucket: (j.r2_bucket as string) ?? '',
    userId: (j.user_id as string | null) ?? null,
    isDeleteMarker: Boolean(j.is_delete_marker),
    isCurrent: Boolean(j.is_current),
    createdAt: j.created_at as string,
  };
}
