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
 * Surfaced by `insert`, `update`, and `upsert` whenever the server is
 * reachable and rejects the write with a 409. These writes are online-first:
 * a server-side conflict throws immediately. Only a genuine network failure
 * falls back to the offline queue, where a conflict that surfaces at sync
 * time is handled by the sync engine rather than thrown here.
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
 * Thrown when the supplied vector's length does not match the dimension
 * declared on the collection's vector field — the server responds with
 * 400 and code `vector_dimension_mismatch`. The message includes both
 * the expected and actual dimensions so you can surface a precise error.
 *
 * @example
 * try {
 *   await koolbase.db.setVector(id, 'embedding', [0.1, 0.2]); // 2 dims
 * } catch (e) {
 *   if (e instanceof KoolbaseVectorDimensionMismatchError) {
 *     showError(e.message); // "expected 1536, got 2"
 *   }
 * }
 */
export class KoolbaseVectorDimensionMismatchError extends KoolbaseDataError {
  constructor(message?: string) {
    super(
      message ?? 'Vector dimension does not match field declaration',
      'vector_dimension_mismatch',
    );
    this.name = 'KoolbaseVectorDimensionMismatchError';
    Object.setPrototypeOf(
      this,
      KoolbaseVectorDimensionMismatchError.prototype,
    );
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
    case 'vector_not_found':
    case 'vector_field_not_found':
      return new KoolbaseNotFoundError(message);
    case 'permission_denied':
      return new KoolbasePermissionError(message);
    case 'rate_limit':
      return new KoolbaseRateLimitError(message);
    case 'validation_error':
    case 'vector_collection_mismatch':
    case 'unsupported_dimension':
      return new KoolbaseValidationError(message);
    case 'vector_dimension_mismatch':
      return new KoolbaseVectorDimensionMismatchError(message);
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
