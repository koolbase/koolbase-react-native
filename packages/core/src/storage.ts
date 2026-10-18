import { KoolbaseStorageProjectIdentityError } from './storage-errors.js';
import { sessionFetch } from './network.js';
import { KoolbaseError, KoolbaseUnauthenticatedError } from './errors.js';
import {
  KoolbaseConfig,
  UploadOptions,
  UploadResult,
  KoolbaseObject,
  KoolbaseObjectVersion,
  KoolbaseImageTransform,
} from './types.js';
import {
  KoolbaseStorageError,
  koolbaseStorageErrorFromResponse,
} from './storage-errors.js';
import { KoolbaseUploadTask, putWithProgress, runUploadTask } from './storage-transfer.js';
import { MultipartPlan, sendParts } from './storage-multipart.js';
import { KoolbaseDownloadCancelledError } from './storage-errors.js';
import { refreshBucketFiles } from './files-refresh.js';
import { KoolbaseNetworkError } from './network.js';
import {
  KoolbaseFileInfo,
  KoolbaseFilePage,
  ListFilesOptions,
  fileInfoFromJson,
  filePageFromJson,
  listFilesQuery,
} from './storage-files.js';


/** An upload task whose success reloads the bucket's file lists (storage S4). */
function listsReload(task: KoolbaseUploadTask, bucket: string): KoolbaseUploadTask {
  task.result.then(() => { void refreshBucketFiles(bucket); }, () => {});
  return task;
}

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

  /**
   * Called when the server rejects the caller's credentials.
   *
   * A session stops working for the whole SDK at once, not one subsystem at a
   * time, so a 401 met during an upload has to clear it just as one met during a
   * query does. Otherwise an app whose failing call happens to be a file upload
   * keeps believing it is signed in.
   */
  private onSessionExpired?: () => Promise<void>;

  /** The project id from the bootstrap payload, '' until it arrives. */
  private projectIdProvider?: () => string;
  /** A background bootstrap refresh, nudged when identity is missing. */
  private nudgeBootstrap?: () => void;

  constructor(
    config: KoolbaseConfig,
    getToken: () => Promise<string | null>,
    onSessionExpired?: () => Promise<void>,
    projectIdProvider?: () => string,
    nudgeBootstrap?: () => void,
  ) {
    this.config = config;
    this.getToken = getToken;
    this.onSessionExpired = onSessionExpired;
    this.projectIdProvider = projectIdProvider;
    this.nudgeBootstrap = nudgeBootstrap;
  }

  /**
   * Builds the error for a failed response and clears the session when the
   * credentials were refused, before the error reaches the caller.
   */
  private async error(res: Response, fallback?: string): Promise<KoolbaseError> {
    const err = await koolbaseStorageErrorFromResponse(res, fallback);
    if (err instanceof KoolbaseUnauthenticatedError) {
      await this.onSessionExpired?.();
    }
    return err;
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
    const task = this.startUpload(options);
    const signal = options.signal;
    const onAbort = () => task.cancel();
    if (signal) {
      if (signal.aborted) task.cancel();
      else signal.addEventListener('abort', onAbort);
    }
    const stop = options.onProgress
      ? task.onProgress((p) => options.onProgress?.(Math.round(p.fraction * 100), p))
      : null;
    try {
      return await task.result;
    } finally {
      stop?.();
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Starts an upload you can follow and cancel: the same upload as
   * {@link upload}, returned at once as a {@link KoolbaseUploadTask}.
   *
   * The task goes pending -> uploading (bytes sent of total) -> verifying
   * -> completed, or failed / cancelled. `cancel()` stops it until the
   * server begins checking the bytes (verifying); nothing is stored. Only
   * completed means the file can be referenced from a record.
   *
   * @example
   * const task = Koolbase.storage.startUpload({ bucket: 'posters', path: 'gig.png', file });
   * const stop = task.onProgress((p) => setPercent(Math.round(p.fraction * 100)));
   * cancelButton.onclick = () => task.cancel();
   * const { object } = await task.result;
   */
  startUpload(options: UploadOptions): KoolbaseUploadTask {
    return listsReload(runUploadTask((task) => this.runUpload(options, task)), options.bucket);
  }

  private async runUpload(options: UploadOptions, task: KoolbaseUploadTask): Promise<UploadResult> {
    task.checkCancelled();
    const overwrite = options.overwrite ?? false;
    // A Blob (browser File included) knows its own type; the React Native
    // URI form carries it alongside. Falling back to octet-stream keeps a
    // typeless Blob from presigning with an empty content type, which R2
    // then refuses at PUT.
    const isBlob = typeof Blob !== 'undefined' && options.file instanceof Blob;
    const contentType = isBlob
      ? (options.file as Blob).type || 'application/octet-stream'
      : (options.file as { type: string }).type;
    if (isBlob) task.setTotal((options.file as Blob).size);

    // A browser hands us the bytes already: a File from an input is a Blob,
    // and fetching its .uri would be fetching undefined. React Native hands
    // us a local URI, and its fetch resolves that into a Blob -- read first,
    // since its size decides how it is sent (S3).
    const fileBlob = isBlob
      ? (options.file as Blob)
      : await (await sessionFetch((options.file as { uri: string }).uri)).blob();
    task.setTotal(fileBlob.size);
    task.checkCancelled();
    // Large files go in parts: resumable, each part retried (S3).
    if (fileBlob.size > KoolbaseStorage.multipartThreshold) {
      return this.runInParts(options.bucket, options, task, fileBlob, contentType, null);
    }

    // ─── Step 1: Get presigned upload URL ───
    const urlRes = await sessionFetch(
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
      throw await this.error(urlRes, 'Failed to get upload URL');
    }
    const { upload_url, upload_id } = (await urlRes.json()) as { upload_url: string; upload_id?: string };
    task.checkCancelled();

    // ─── Step 2: Upload directly to R2 ───
    // R2 presigned URLs expect raw binary, NOT multipart/form-data.
    const fileSize = fileBlob.size;

    const uploadRes = await putWithProgress(task, upload_url, fileBlob, contentType);
    if (uploadRes.status < 200 || uploadRes.status >= 300) {
      // R2 PUT errors don't follow the Koolbase error shape — surface as a
      // generic storage error rather than trying to decode a Koolbase body.
      throw new KoolbaseStorageError(
        `Upload to storage failed: ${uploadRes.status}`
      );
    }
    const etag = uploadRes.etag;

    // From here the server checks the bytes and puts them in place; the
    // upload can no longer be cancelled.
    task.verifying();

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
    // The confirm names its upload, so it takes exactly these bytes.
    if (upload_id) {
      confirmBody.upload_id = upload_id;
    }
    if (options.metadata !== undefined) {
      confirmBody.metadata = options.metadata;
    }

    const confirmRes = await sessionFetch(
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
      throw await this.error(
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
   * Files larger than this go up in parts (S3): each part retried on its
   * own, the upload resumable for a day with `resumeUpload`. 16 MiB.
   */
  static multipartThreshold = 16 * 1024 * 1024;

  /**
   * Resumes a large file's upload that failed or was interrupted -- the
   * network dropped, the app was closed -- sending only the parts that did
   * not arrive. `uploadId` is the failed task's `uploadId`; `file` must be
   * the same file. Within a day of the upload beginning.
   *
   * @example
   * const task = Koolbase.storage.startUpload({ bucket: 'video', path: 'talk.mp4', file });
   * saveForLater(task.uploadId); // once the upload has begun
   * // ... after a restart:
   * await Koolbase.storage.resumeUpload({ bucket: 'video', uploadId, file }).result;
   */
  resumeUpload(options: {
    bucket: string;
    uploadId: string;
    file: UploadOptions['file'];
    metadata?: Record<string, string>;
    overwrite?: boolean;
  }): KoolbaseUploadTask {
    return listsReload(runUploadTask(async (task) => {
      const isBlob = typeof Blob !== 'undefined' && options.file instanceof Blob;
      const blob = isBlob
        ? (options.file as Blob)
        : await (await sessionFetch((options.file as { uri: string }).uri)).blob();
      task.setTotal(blob.size);
      return this.runInParts(options.bucket, options, task, blob, '', options.uploadId);
    }), options.bucket);
  }

  private async runInParts(
    bucket: string,
    options: { path?: string; metadata?: Record<string, string>; overwrite?: boolean },
    task: KoolbaseUploadTask,
    file: Blob,
    contentType: string,
    resumeId: string | null,
  ): Promise<UploadResult> {
    const base = `${this.config.baseUrl}/v1/sdk/storage/uploads`;
    const json = async () => ({ ...(await this.buildHeaders()), 'Content-Type': 'application/json' });
    const overwrite = options.overwrite ?? false;
    let plan: MultipartPlan;
    if (resumeId) {
      const res = await sessionFetch(`${base}?bucket=${encodeURIComponent(bucket)}&upload_id=${encodeURIComponent(resumeId)}`, {
        headers: await this.buildHeaders(),
      });
      if (!res.ok) throw await this.error(res, 'Failed to resume the upload');
      plan = (await res.json()) as MultipartPlan;
      if (plan.size !== file.size) {
        throw new KoolbaseStorageError(
          `This is not the file the upload began with: it has ${file.size} bytes, the upload ${plan.size}`,
          'validation_error',
        );
      }
    } else {
      const res = await sessionFetch(base, {
        method: 'POST',
        headers: await json(),
        body: JSON.stringify({ bucket, path: options.path, content_type: contentType, size: file.size, overwrite }),
      });
      if (!res.ok) throw await this.error(res, 'Failed to begin the upload');
      plan = (await res.json()) as MultipartPlan;
    }
    task.setUploadId(plan.upload_id);
    task.checkCancelled();

    await sendParts(task, plan, file, {
      links: async (parts) => {
        const res = await sessionFetch(`${base}/parts`, {
          method: 'POST',
          headers: await json(),
          body: JSON.stringify({ bucket, upload_id: plan.upload_id, parts }),
        });
        if (!res.ok) throw await this.error(res, 'Failed to get upload links');
        return ((await res.json()) as { links: Record<string, string> }).links;
      },
      abort: async () => {
        await sessionFetch(base, {
          method: 'DELETE',
          headers: await json(),
          body: JSON.stringify({ bucket, upload_id: plan.upload_id }),
        });
      },
    });

    // The parts have arrived: the server joins and checks them. No longer
    // cancellable.
    task.verifying();
    const body: Record<string, unknown> = { bucket, upload_id: plan.upload_id, overwrite };
    if (options.metadata !== undefined) body.metadata = options.metadata;
    const done = await sessionFetch(`${base}/complete`, { method: 'POST', headers: await json(), body: JSON.stringify(body) });
    if (!done.ok) throw await this.error(done, 'Failed to complete the upload');
    const object = mapObjectFromServer(await done.json());
    const downloadUrl = await this.getDownloadUrl(bucket, object.path);
    return { object, downloadUrl };
  }

  /**
   * Downloads a file's bytes, reporting them as they arrive (S3):
   * `onProgress(received, total)`, total null when the size is not known.
   * Aborting `signal` stops it with `KoolbaseDownloadCancelledError`.
   *
   * @example
   * const blob = await Koolbase.storage.download({ bucket: 'video', path: 'talk.mp4', onProgress: (r, t) => setPct(t ? r / t : 0) });
   */
  async download(options: {
    bucket: string;
    path: string;
    versionId?: string;
    onProgress?: (received: number, total: number | null) => void;
    signal?: AbortSignal;
  }): Promise<Blob> {
    if (options.signal?.aborted) throw new KoolbaseDownloadCancelledError();
    const url = await this.getDownloadUrl(options.bucket, options.path, options.versionId);
    const report = options.onProgress ?? (() => undefined);
    const XHR = (globalThis as { XMLHttpRequest?: new () => XMLHttpRequest }).XMLHttpRequest;
    if (XHR) {
      return new Promise<Blob>((resolve, reject) => {
        const xhr = new XHR();
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          options.signal?.removeEventListener('abort', stop);
          fn();
        };
        const stop = () => {
          xhr.abort();
          finish(() => reject(new KoolbaseDownloadCancelledError()));
        };
        options.signal?.addEventListener('abort', stop);
        xhr.open('GET', url);
        xhr.responseType = 'blob';
        xhr.onprogress = (ev: ProgressEvent) => report(ev.loaded, ev.lengthComputable ? ev.total : null);
        xhr.onload = () =>
          finish(() => {
            if (xhr.status < 200 || xhr.status >= 300) {
              reject(new KoolbaseStorageError(`Download failed: ${xhr.status}`));
              return;
            }
            const blob = xhr.response as Blob;
            report(blob.size, blob.size);
            resolve(blob);
          });
        xhr.onerror = () => finish(() => reject(new KoolbaseNetworkError(url, new Error('the download did not complete'))));
        xhr.onabort = () => finish(() => reject(new KoolbaseDownloadCancelledError()));
        xhr.send();
      });
    }
    let res: Response;
    try {
      res = await fetch(url, { signal: options.signal });
    } catch (e) {
      if (options.signal?.aborted) throw new KoolbaseDownloadCancelledError();
      throw new KoolbaseNetworkError(url, e);
    }
    if (!res.ok) throw new KoolbaseStorageError(`Download failed: ${res.status}`);
    const total = Number(res.headers.get('content-length')) || null;
    const reader = res.body?.getReader?.();
    if (!reader) {
      const blob = await res.blob();
      report(blob.size, blob.size);
      return blob;
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    report(0, total);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        report(received, total);
      }
    } catch (e) {
      if (options.signal?.aborted) throw new KoolbaseDownloadCancelledError();
      throw new KoolbaseNetworkError(url, e);
    }
    return new Blob(chunks as BlobPart[], { type: res.headers.get('content-type') ?? '' });
  }

  /**
   * One page of a bucket's files. The bucket's view rule is applied to every
   * file: the page holds only files the signed-in person may view. Pass the
   * page's `nextCursor` back as `cursor` for the next one; a page can hold
   * fewer files than `limit` and still have a next.
   *
   * @example
   * let cursor: string | undefined;
   * do {
   *   const page = await Koolbase.storage.listFiles({ bucket: 'posters', prefix: 'events/', cursor });
   *   show(page.files);
   *   cursor = page.nextCursor ?? undefined;
   * } while (cursor);
   */
  async listFiles(options: ListFilesOptions): Promise<KoolbaseFilePage> {
    const res = await sessionFetch(
      `${this.config.baseUrl}/v1/sdk/storage/files?${listFilesQuery(options)}`,
      { headers: await this.buildHeaders() },
    );
    if (!res.ok) {
      throw await this.error(res, 'Failed to list files');
    }
    return filePageFromJson((await res.json()) as Record<string, unknown>);
  }

  /**
   * One file's details -- size, type, metadata, who uploaded it, and its
   * permanent link while its bucket is public. Throws
   * `KoolbaseStorageNotFoundError` for a file that is not there or that
   * the bucket's view rule hides from the caller.
   */
  async getFileInfo(bucket: string, path: string): Promise<KoolbaseFileInfo> {
    const res = await sessionFetch(
      `${this.config.baseUrl}/v1/sdk/storage/file?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`,
      { headers: await this.buildHeaders() },
    );
    if (!res.ok) {
      throw await this.error(res, 'Failed to get the file');
    }
    return fileInfoFromJson((await res.json()) as Record<string, unknown>);
  }

  /**
   * Move a file to `to`, in its bucket or into `toBucket` (S1b). Nothing is
   * uploaded again. The bucket's rules decide: delete on the file, and
   * upload at the destination, whose limits apply as to an upload. The
   * destination must be free.
   *
   * Within one bucket the file keeps its kept versions. Refused with
   * `KoolbaseStorageFileInUseError` while records point at the file: change
   * them first, or {@link copy} it.
   *
   * @example
   * await Koolbase.storage.move({ bucket: 'inbox', from: 'scan.png', toBucket: 'vault', to: '2026/scan.png' });
   */
  async move(options: { bucket: string; from: string; to: string; toBucket?: string }): Promise<KoolbaseObject> {
    return this.transfer('move', options);
  }

  /**
   * Copy a file to `to`, in its bucket or into `toBucket` (S1b): a new file,
   * the caller's, with the same bytes. The bucket's rules decide: view on
   * the file, and upload at the destination.
   */
  async copy(options: { bucket: string; from: string; to: string; toBucket?: string }): Promise<KoolbaseObject> {
    return this.transfer('copy', options);
  }

  private async transfer(op: 'move' | 'copy', o: { bucket: string; from: string; to: string; toBucket?: string }): Promise<KoolbaseObject> {
    const body: Record<string, string> = { bucket: o.bucket, from: o.from, to: o.to };
    if (o.toBucket && o.toBucket !== o.bucket) body.to_bucket = o.toBucket;
    const res = await sessionFetch(`${this.config.baseUrl}/v1/sdk/storage/${op}`, {
      method: 'POST',
      headers: { ...(await this.buildHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw await this.error(res, op === 'move' ? 'Failed to move the file' : 'Failed to copy the file');
    }
    const moved = mapObjectFromServer(await res.json());
    void refreshBucketFiles(o.bucket, ...(o.toBucket && o.toBucket !== o.bucket ? [o.toBucket] : []));
    return moved;
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
    const res = await sessionFetch(
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
      throw await this.error(res, 'Failed to update metadata');
    }
    const raw = await res.json();
    void refreshBucketFiles(bucket);
    return mapObjectFromServer(raw);
  }

  /**
   * Get a signed download URL for a file.
   *
   * `options.preset` names one of the project's image presets (Storage →
   * Presets): an image's current version is then given sized as the preset
   * says -- a private bucket's as a signed, hour-long address -- after the
   * same rules decide whether this person may see it. Anything not an image
   * is given as it is.
   */
  async getDownloadUrl(bucket: string, path: string, versionId?: string, options?: { preset?: string }): Promise<string> {
    let url =
      `${this.config.baseUrl}/v1/sdk/storage/download-url` +
      `?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
    if (versionId) {
      url += `&version_id=${encodeURIComponent(versionId)}`;
    }
    if (options?.preset) {
      url += `&preset=${encodeURIComponent(options.preset)}`;
    }
    const res = await sessionFetch(url, { headers: await this.buildHeaders() });
    if (!res.ok) {
      throw await this.error(res, 'Failed to get download URL');
    }
    const data = (await res.json()) as { url: string };
    return data.url;
  }

  /**
   * The stable public CDN URL for a file in a public bucket, using the project
   * identity the SDK learned at bootstrap -- the runtime form of
   * {@link KoolbaseStorage.publicUrl}, needing no projectId (as Flutter's).
   *
   * Throws {@link KoolbaseStorageProjectIdentityError} while identity is
   * unavailable, and nudges a background bootstrap refresh so a later call in
   * the same session succeeds once connectivity returns.
   */
  publicUrlFor(args: { bucket: string; path: string; transform?: KoolbaseImageTransform; preset?: string }): string {
    const pid = this.projectIdProvider?.() ?? '';
    if (pid === '') {
      this.nudgeBootstrap?.();
      throw new KoolbaseStorageProjectIdentityError();
    }
    // A named preset (Storage → Presets): the edge sizes it; no transform.
    if (args.preset) return KoolbaseStorage.publicUrlWithPreset({ projectId: pid, presetName: args.preset, bucket: args.bucket, path: args.path });
    return KoolbaseStorage.publicUrl({ projectId: pid, bucket: args.bucket, path: args.path, transform: args.transform });
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
    const res = await sessionFetch(url, {
      method: 'DELETE',
      headers: {
        ...(await this.buildHeaders()),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bucket, path }),
    });
    if (res.ok) {
      void refreshBucketFiles(bucket);
      return;
    }
    throw await this.error(res, 'Failed to delete file');
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
    const res = await sessionFetch(url, { headers: await this.buildHeaders() });
    if (!res.ok) {
      throw await this.error(res, 'Failed to list versions');
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
    const res = await sessionFetch(url, { headers: await this.buildHeaders() });
    if (!res.ok) {
      throw await this.error(res, 'Failed to fetch version');
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
    const res = await sessionFetch(url, {
      method: 'POST',
      headers: await this.buildHeaders(),
    });
    if (!res.ok) {
      throw await this.error(res, 'Failed to restore version');
    }
    const restored = mapObjectFromServer(await res.json());
    void refreshBucketFiles(bucket);
    return restored;
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
    const res = await sessionFetch(url, {
      method: 'DELETE',
      headers: await this.buildHeaders(),
    });
    if (res.status === 204) return;
    if (!res.ok) {
      throw await this.error(res, 'Failed to purge version');
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
