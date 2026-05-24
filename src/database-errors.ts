/**
 * Base class for errors surfaced by the Koolbase data layer (database reads
 * and writes). Every data error carries a `message` and, when the server
 * provides one, its stable `code` (e.g. `not_found`, `validation_error`,
 * `unique_violation`).
 *
 * Catch this to handle any data-layer failure generically, or catch a
 * specific subclass to branch on the kind of failure.
 */
export class KoolbaseDataError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
    this.name = 'KoolbaseDataError';
    Object.setPrototypeOf(this, KoolbaseDataError.prototype);
  }
}

/**
 * Thrown when a write is rejected because the value would violate a
 * collection's unique constraint — the server responds with 409 Conflict.
 * Catch it to handle duplicates, e.g. an email or username already in use.
 *
 * `field` names the field that collided, when the server reports it
 * (`details.field`) — useful when a collection has more than one unique
 * constraint and you need to know which value clashed.
 *
 * Currently surfaced by `upsert` (the online-only write). `insert` and
 * `update` are optimistic/offline-first: they accept the write locally and
 * sync in the background, so a constraint conflict on those paths is a
 * sync-time concern rather than a thrown error.
 *
 * @example
 * try {
 *   await koolbase.db.upsert('users', { email }, { name });
 * } catch (e) {
 *   if (e instanceof KoolbaseConflictError) {
 *     showError(`That ${e.field ?? 'value'} is already registered.`);
 *   }
 * }
 */
export class KoolbaseConflictError extends KoolbaseDataError {
  field?: string;

  constructor(message?: string, field?: string) {
    super(message ?? 'Value violates a unique constraint', 'unique_violation');
    this.field = field;
    this.name = 'KoolbaseConflictError';
    Object.setPrototypeOf(this, KoolbaseConflictError.prototype);
  }
}

/**
 * Thrown when the requested record or collection does not exist — the server
 * responds with 404 and code `not_found` / `record_not_found` /
 * `collection_not_found`.
 */
export class KoolbaseNotFoundError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'The requested resource was not found', 'not_found');
    this.name = 'KoolbaseNotFoundError';
    Object.setPrototypeOf(this, KoolbaseNotFoundError.prototype);
  }
}

/**
 * Thrown when the request is rejected as invalid — the server responds with
 * 400 and code `validation_error`.
 */
export class KoolbaseValidationError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'The request was invalid', 'validation_error');
    this.name = 'KoolbaseValidationError';
    Object.setPrototypeOf(this, KoolbaseValidationError.prototype);
  }
}

/**
 * Thrown when the caller is authenticated but not allowed to perform the
 * operation — the server responds with 403 and code `permission_denied`
 * (typically a collection access rule rejecting the read/write).
 */
export class KoolbasePermissionError extends KoolbaseDataError {
  constructor(message?: string) {
    super(
      message ?? 'You do not have permission to perform this action',
      'permission_denied'
    );
    this.name = 'KoolbasePermissionError';
    Object.setPrototypeOf(this, KoolbasePermissionError.prototype);
  }
}

/**
 * Thrown when the server is rate-limiting the caller — 429 with code
 * `rate_limit`. Back off and retry after a short delay.
 */
export class KoolbaseRateLimitError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'Too many requests, please slow down', 'rate_limit');
    this.name = 'KoolbaseRateLimitError';
    Object.setPrototypeOf(this, KoolbaseRateLimitError.prototype);
  }
}

/**
 * Maps a non-2xx data-layer response to a typed {@link KoolbaseDataError},
 * preferring the server's stable `code` and falling back to the HTTP status
 * for older or uncoded responses. Always returns an error to throw.
 */
export function koolbaseDataError(
  status: number,
  body: any,
  fallbackMessage = 'Request failed'
): KoolbaseDataError {
  const code: string | undefined = body?.code;
  const message: string = body?.error ?? fallbackMessage;
  const field: string | undefined = body?.details?.field;

  // ─── code-first ───
  switch (code) {
    case 'unique_violation':
      return new KoolbaseConflictError(message, field);
    case 'not_found':
    case 'record_not_found':
    case 'collection_not_found':
      return new KoolbaseNotFoundError(message);
    case 'permission_denied':
      return new KoolbasePermissionError(message);
    case 'rate_limit':
      return new KoolbaseRateLimitError(message);
    case 'validation_error':
      return new KoolbaseValidationError(message);
  }

  // ─── status fallback (pre-code servers) ───
  switch (status) {
    case 409:
      return new KoolbaseConflictError(message);
    case 404:
      return new KoolbaseNotFoundError(message);
    case 403:
      return new KoolbasePermissionError(message);
    case 429:
      return new KoolbaseRateLimitError(message);
    case 400:
      return new KoolbaseValidationError(message);
  }

  return new KoolbaseDataError(message, code);
}
