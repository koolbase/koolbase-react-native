import { KoolbaseError, KoolbaseUnauthenticatedError } from './errors.js';
/**
 * Base class for errors surfaced by the Koolbase data layer (database reads
 * and writes). Every data error carries a `message` and, when the server
 * provides one, its stable `code` (e.g. `not_found`, `validation_error`,
 * `unique_violation`).
 *
 * Catch this to handle any data-layer failure generically, or catch a
 * specific subclass to branch on the kind of failure.
 */
export class KoolbaseDataError extends KoolbaseError {
  /**
   * Structured payload from the server's error body, when it sent one — e.g. a
   * revision_mismatch 409 carries {expected_revision, current_revision,
   * record}. Attached by the factory; absent when the body had none.
   */
  details?: Record<string, unknown>;

  constructor(message: string, code?: string) {
    super(message, code);
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
/**
 * An upsert whose filter matched more than one record.
 *
 * Refused rather than resolved: picking one of several would be a silent
 * guess about which row the caller meant, and the wrong guess overwrites data
 * nobody asked to change. Narrow the filter, or add a unique constraint over
 * the fields you are matching on so the ambiguity cannot arise.
 */
export class KoolbaseAmbiguousMatchError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'Upsert match resolved to more than one record', 'ambiguous_match');
    this.name = 'KoolbaseAmbiguousMatchError';
    Object.setPrototypeOf(this, KoolbaseAmbiguousMatchError.prototype);
  }
}

/** A unique constraint already covers those fields. */
export class KoolbaseConstraintExistsError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'A unique constraint already exists for these fields', 'constraint_exists');
    this.name = 'KoolbaseConstraintExistsError';
    Object.setPrototypeOf(this, KoolbaseConstraintExistsError.prototype);
  }
}

/** No such unique constraint. */
export class KoolbaseConstraintNotFoundError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'Unique constraint not found', 'constraint_not_found');
    this.name = 'KoolbaseConstraintNotFoundError';
    Object.setPrototypeOf(this, KoolbaseConstraintNotFoundError.prototype);
  }
}

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
  /**
   * The code is carried rather than fixed, because the server distinguishes
   * what was missing — a record, a collection, a vector field — and an app
   * reading e.code should get that answer rather than the category. Catching
   * the class still works for anyone who only cares that something was
   * absent.
   */
  constructor(message?: string, code = 'not_found') {
    super(message ?? 'The requested resource was not found', code);
    this.name = 'KoolbaseNotFoundError';
    Object.setPrototypeOf(this, KoolbaseNotFoundError.prototype);
  }
}

/**
 * Thrown when the request is rejected as invalid — the server responds with
 * 400 and code `validation_error`.
 */
export class KoolbaseValidationError extends KoolbaseDataError {
  /**
   * Carries its code for the same reason KoolbaseNotFoundError does: a
   * dimension the platform does not support and a vector pointed at the wrong
   * collection are both validation failures, and an app should still be able
   * to tell which without reading the message.
   */
  constructor(message?: string, code = 'validation_error') {
    super(message ?? 'The request was invalid', code);
    this.name = 'KoolbaseValidationError';
    Object.setPrototypeOf(this, KoolbaseValidationError.prototype);
  }
}

/**
 * Thrown when the caller is authenticated but not allowed to perform the
 * operation — the server responds with 403 and code `permission_denied`
 * (typically a collection access rule rejecting the read/write).
 */
/**
 * Authenticated, and not permitted to do this — distinct from a rule denying
 * access to a record. Its own class rather than folding into
 * KoolbasePermissionError, which hardcodes permission_denied: an error
 * reporting a code the server did not send is a small lie, and apps that
 * branch on e.code rather than instanceof would act on it.
 */
export class KoolbaseInsufficientAuthorityError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'You do not have the authority to perform this action', 'insufficient_authority');
    this.name = 'KoolbaseInsufficientAuthorityError';
    Object.setPrototypeOf(this, KoolbaseInsufficientAuthorityError.prototype);
  }
}

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
): KoolbaseError {
  const code: string | undefined = body?.code;
  const message: string = body?.error ?? fallbackMessage;
  const field: string | undefined = body?.details?.field;
  const attach = (err: KoolbaseError): KoolbaseError => {
    // The body's structured details ride along on data errors — a
    // revision_mismatch 409 carries the current revision and record, and
    // discarding them here is how a refused conflict-resolution became
    // permanently unresolvable: the information arrived and died in this file.
    if (err instanceof KoolbaseDataError && body?.details) {
      err.details = body.details as Record<string, unknown>;
    }
    return err;
  };
  // Status-first for auth: a 401 means the credentials were not accepted,
  // whatever code the body claims. Trusting a mislabelled body here bypasses
  // session-clearing and strands the app signed-in with dead credentials.
  if (status === 401) {
    return new KoolbaseUnauthenticatedError(message);
  }

  // ─── code-first ───
  switch (code) {
    case 'unique_violation':
      return attach(new KoolbaseConflictError(message, field));
    case 'ambiguous_match':
      return attach(new KoolbaseAmbiguousMatchError(message));
    case 'constraint_exists':
      return attach(new KoolbaseConstraintExistsError(message));
    case 'constraint_not_found':
      return attach(new KoolbaseConstraintNotFoundError(message));
    case 'insufficient_authority':
      return attach(new KoolbaseInsufficientAuthorityError(message));
    case 'not_found':
    case 'record_not_found':
    case 'collection_not_found':
    case 'vector_not_found':
    case 'vector_field_not_found':
      return attach(new KoolbaseNotFoundError(message, code));
    case 'unauthenticated':
    case 'invalid_token':
      return attach(new KoolbaseUnauthenticatedError(message));
    case 'permission_denied':
      return attach(new KoolbasePermissionError(message));
    case 'rate_limit':
      return attach(new KoolbaseRateLimitError(message));
    case 'validation_error':
    case 'vector_collection_mismatch':
    case 'unsupported_dimension':
      return attach(new KoolbaseValidationError(message, code));
    case 'vector_dimension_mismatch':
      return attach(new KoolbaseVectorDimensionMismatchError(message));
  }

  // ─── status fallback (pre-code servers) ───
  switch (status) {
    case 409:
      return attach(new KoolbaseConflictError(message));
    case 404:
      return attach(new KoolbaseNotFoundError(message));
    case 401:
      // The status carries the meaning: every 401 from this server reports the
      // same code, so it cannot say whether the session expired, the key was
      // revoked, or the header was malformed. Safe to treat uniformly because a
      // permission failure is 403 — a 401 means the credentials were not
      // accepted, not that this caller may not proceed.
      return attach(new KoolbaseUnauthenticatedError(message));
    case 403:
      return attach(new KoolbasePermissionError(message));
    case 429:
      return attach(new KoolbaseRateLimitError(message));
    case 400:
      return attach(new KoolbaseValidationError(message));
  }

  return attach(new KoolbaseDataError(message, code));
}
