/**
 * Base error type for all Koolbase storage errors. Catchable via
 * `instanceof KoolbaseStorageError` to handle any storage-related failure
 * generically; subclasses let you handle specific cases.
 */
export class KoolbaseStorageError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
    this.name = 'KoolbaseStorageError';
    Object.setPrototypeOf(this, KoolbaseStorageError.prototype);
  }
}

/**
 * Thrown when an upload is rejected because an object already exists at
 * the requested path — the server responds with 409 Conflict and code
 * `path_conflict`. Catch it to give the user an "overwrite this file?"
 * prompt, then retry the upload with `overwrite: true`.
 *
 * `path` is the colliding path the server rejected, surfaced from the
 * response body for diagnostics and UI.
 *
 * @example
 * try {
 *   await Koolbase.storage.upload({
 *     bucket: 'avatars',
 *     path: 'me.png',
 *     file: { uri, name, type: 'image/png' },
 *   });
 * } catch (e) {
 *   if (e instanceof KoolbaseStorageConflictError) {
 *     const ok = await confirm(`${e.path} already exists. Overwrite?`);
 *     if (ok) {
 *       await Koolbase.storage.upload({
 *         bucket: 'avatars',
 *         path: 'me.png',
 *         file: { uri, name, type: 'image/png' },
 *         overwrite: true,
 *       });
 *     }
 *   }
 * }
 */
export class KoolbaseStorageConflictError extends KoolbaseStorageError {
  path?: string;

  constructor(message?: string, path?: string) {
    super(message ?? 'An object already exists at this path', 'path_conflict');
    this.path = path;
    this.name = 'KoolbaseStorageConflictError';
    Object.setPrototypeOf(this, KoolbaseStorageConflictError.prototype);
  }
}

/**
 * Thrown when the requested bucket or object does not exist — the server
 * responds with 404. Also surfaced for cross-tenant access attempts
 * (Koolbase's 404-over-403 convention prevents enumeration in
 * multi-tenant contexts).
 */
export class KoolbaseStorageNotFoundError extends KoolbaseStorageError {
  constructor(message?: string) {
    super(message ?? 'The requested bucket or object was not found', 'not_found');
    this.name = 'KoolbaseStorageNotFoundError';
    Object.setPrototypeOf(this, KoolbaseStorageNotFoundError.prototype);
  }
}

/**
 * Thrown when the request is rejected as invalid — the server responds
 * with 400 (e.g. a malformed path, missing field, invalid bucket name).
 */
export class KoolbaseStorageValidationError extends KoolbaseStorageError {
  constructor(message?: string) {
    super(message ?? 'The storage request was invalid', 'validation_error');
    this.name = 'KoolbaseStorageValidationError';
    Object.setPrototypeOf(this, KoolbaseStorageValidationError.prototype);
  }
}

/**
 * Thrown when the caller is authenticated but not allowed to perform the
 * storage operation — the server responds with 403.
 */
export class KoolbaseStoragePermissionError extends KoolbaseStorageError {
  constructor(message?: string) {
    super(
      message ?? 'You do not have permission to perform this storage action',
      'permission_denied'
    );
    this.name = 'KoolbaseStoragePermissionError';
    Object.setPrototypeOf(this, KoolbaseStoragePermissionError.prototype);
  }
}

/**
 * Thrown when an upload would push the bucket past its configured
 * `max_size_bytes` quota — the server responds with 409 Conflict and code
 * `quota_exceeded`. The server cleans up the underlying R2 object before
 * returning; nothing leaks. Catch this to surface a "bucket is full"
 * message or prompt the caller to delete older files. The per-bucket
 * quota is set at bucket creation time and is currently immutable.
 *
 * Distinct from {@link KoolbaseStorageConflictError} (which also uses
 * 409 but means "path collides"); branch on the error type via
 * `instanceof`, not on status.
 */
export class KoolbaseStorageQuotaError extends KoolbaseStorageError {
  constructor(message?: string) {
    super(message ?? 'Bucket quota exceeded', 'quota_exceeded');
    this.name = 'KoolbaseStorageQuotaError';
    Object.setPrototypeOf(this, KoolbaseStorageQuotaError.prototype);
  }
}

/**
 * Thrown when a single file exceeds the bucket's configured
 * `max_file_size_bytes` — the server responds with 413 Payload Too Large
 * and code `file_too_large`. The server cleans up the underlying R2
 * object before returning. The configured per-file limit lives on the
 * bucket record; check `Bucket.maxFileSizeBytes` to surface a clear
 * "files must be under X MB" message at the call site.
 */
export class KoolbaseStorageFileTooLargeError extends KoolbaseStorageError {
  constructor(message?: string) {
    super(message ?? 'File exceeds the bucket maximum file size', 'file_too_large');
    this.name = 'KoolbaseStorageFileTooLargeError';
    Object.setPrototypeOf(this, KoolbaseStorageFileTooLargeError.prototype);
  }
}

/**
 * Thrown when an upload's content-type isn't in the bucket's configured
 * `allowed_mime_types` allowlist — the server responds with 415
 * Unsupported Media Type and code `mime_not_allowed`. The check runs at
 * presign time, so no bytes are transferred before rejection.
 *
 * Allowlists support `type/*` wildcards (e.g. `image/*` matches every
 * image content-type). A bucket with no allowlist configured accepts
 * every type.
 */
export class KoolbaseStorageMimeTypeError extends KoolbaseStorageError {
  constructor(message?: string) {
    super(message ?? 'Content-type not allowed for this bucket', 'mime_not_allowed');
    this.name = 'KoolbaseStorageMimeTypeError';
    Object.setPrototypeOf(this, KoolbaseStorageMimeTypeError.prototype);
  }
}

/**
 * Thrown when an object metadata payload (either at upload-confirm time
 * or via `updateMetadata`) fails server-side validation — the server
 * responds with 400 and code `metadata_invalid`.
 *
 * The `detail` field carries the specific reason from the server — e.g.
 * `'key "foo bar": must match [a-z0-9_]+'`, `'exceeds 50 keys (got 53)'`,
 * or `'exceeds 8192 bytes total (sum of all key + value lengths)'`. The
 * detail names the failing key and rule so callers can fix the offending
 * entry without guessing what shape rule was violated.
 *
 * Validation rules (enforced server-side):
 * - At most 50 keys per object.
 * - At most 8KB total (sum of byte lengths across all keys + values).
 * - Keys: 1–64 chars, must match `[a-z0-9_]+`.
 * - Keys with a leading underscore are reserved for system use.
 * - Values: at most 1024 chars each.
 *
 * @example
 * try {
 *   await Koolbase.storage.updateMetadata('photos', 'sunset.jpg', {
 *     tag: 'sunset',
 *     'BAD KEY': 'oops',
 *   });
 * } catch (e) {
 *   if (e instanceof KoolbaseStorageMetadataInvalidError) {
 *     console.warn('Metadata rejected:', e.detail);
 *     // -> 'Metadata rejected: key "BAD KEY": must match [a-z0-9_]+'
 *   }
 * }
 */
export class KoolbaseStorageMetadataInvalidError extends KoolbaseStorageError {
  /**
   * The specific validation failure reported by the server. Names the
   * failing key (when applicable) and the rule that was violated.
   * Surface this directly to developer logs or user-facing UI.
   */
  detail?: string;

  constructor(message?: string, detail?: string) {
    super(message ?? 'Metadata payload is invalid', 'metadata_invalid');
    this.detail = detail;
    this.name = 'KoolbaseStorageMetadataInvalidError';
    Object.setPrototypeOf(this, KoolbaseStorageMetadataInvalidError.prototype);
  }
}

/**
 * Maps a non-2xx storage-layer response to a typed
 * {@link KoolbaseStorageError}, preferring the server's stable `code` and
 * falling back to the HTTP status for older or uncoded responses. Always
 * returns an error to throw.
 *
 * Status-fallback note: HTTP 409 covers both path_conflict and
 * quota_exceeded. Without a `code` field, the mapper defaults 409 to
 * {@link KoolbaseStorageConflictError} since path collisions are the more
 * common case. Modern Koolbase servers always emit `code`, so this only
 * matters for very old API responses or non-Koolbase 409s.
 */
export function koolbaseStorageError(
  status: number,
  body: any,
  fallbackMessage = 'Storage request failed'
): KoolbaseStorageError {
  const code: string | undefined = body?.code;
  const message: string = body?.error ?? fallbackMessage;

  // ─── code-first ───
  switch (code) {
    case 'path_conflict':
      return new KoolbaseStorageConflictError(message, body?.path);
    case 'quota_exceeded':
      return new KoolbaseStorageQuotaError(message);
    case 'file_too_large':
      return new KoolbaseStorageFileTooLargeError(message);
    case 'mime_not_allowed':
      return new KoolbaseStorageMimeTypeError(message);
    case 'metadata_invalid':
      return new KoolbaseStorageMetadataInvalidError(message, body?.detail);
  }

  // ─── status fallback (pre-code servers or uncoded paths) ───
  switch (status) {
    case 409:
      return new KoolbaseStorageConflictError(message);
    case 413:
      return new KoolbaseStorageFileTooLargeError(message);
    case 415:
      return new KoolbaseStorageMimeTypeError(message);
    case 404:
      return new KoolbaseStorageNotFoundError(message);
    case 403:
      return new KoolbaseStoragePermissionError(message);
    case 400:
      return new KoolbaseStorageValidationError(message);
  }

  return new KoolbaseStorageError(message, code);
}

/**
 * Convenience wrapper over {@link koolbaseStorageError} that decodes the
 * response body for you. Use at call sites that have the raw `Response`.
 */
export async function koolbaseStorageErrorFromResponse(
  res: Response,
  fallbackMessage = 'Storage request failed'
): Promise<KoolbaseStorageError> {
  let body: any = {};
  try {
    body = await res.json();
  } catch (_) {
    // body wasn't JSON — fall through with empty object
  }
  return koolbaseStorageError(res.status, body, fallbackMessage);
}
