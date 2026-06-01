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
 * `PATH_CONFLICT`. Catch it to give the user an "overwrite this file?"
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
    super(message ?? 'An object already exists at this path', 'PATH_CONFLICT');
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
 * Maps a non-2xx storage-layer response to a typed
 * {@link KoolbaseStorageError}, preferring the server's stable `code` and
 * falling back to the HTTP status for older or uncoded responses. Always
 * returns an error to throw.
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
    case 'PATH_CONFLICT':
      return new KoolbaseStorageConflictError(message, body?.path);
  }

  // ─── status fallback (pre-code servers or uncoded paths) ───
  switch (status) {
    case 409:
      return new KoolbaseStorageConflictError(message);
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
