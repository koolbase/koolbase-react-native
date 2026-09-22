import { KoolbaseError, KoolbasePlanLimitError, KoolbaseUnauthenticatedError } from './errors.js';
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
/**
 * The record changed between reading it and writing it.
 *
 * Optimistic concurrency: a write carrying a revision is refused when the
 * server has moved on, rather than overwriting whatever happened in between.
 * The refusal carries the server's current record and both revisions, so
 * resolving needs no second fetch — and cannot race one.
 *
 * Distinct from KoolbaseConflict, which models a queued OFFLINE write and
 * carries a baseline as well, because a change composed hours ago needs its
 * original context to be resolvable. Here the caller still has their data in
 * hand.
 *
 * Until 11.3.0 this arrived as a generic data error and the details had to be
 * dug out of an untyped bag — the information the server went to the trouble
 * of attaching, unreachable in practice.
 */
/** A vector field with that name already exists on the collection. */
/**
 * A seed or import operation was refused. The code says which stage:
 * invalid_seed_file (the file itself, with a "problems" list in details),
 * seed_key_not_unique (the key does not identify rows uniquely),
 * seed_needs_decision (conflicts need a choice before proceeding), or
 * seed_conflicts_require_force (overwriting would discard the target's
 * version of rows that changed on both sides — details carry the rows).
 *
 * One class with the code distinguishing them, rather than four: these are
 * dashboard and CLI operations, and a caller handling one handles them the
 * same way — show the reason and let a human decide.
 */
export class KoolbaseSeedError extends KoolbaseDataError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = 'KoolbaseSeedError';
    Object.setPrototypeOf(this, KoolbaseSeedError.prototype);
  }
}

/** A project slug that another project already holds. */
export class KoolbaseSlugTakenError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'A project with this slug already exists', 'slug_taken');
    this.name = 'KoolbaseSlugTakenError';
    Object.setPrototypeOf(this, KoolbaseSlugTakenError.prototype);
  }
}

/** An invitation that has been revoked or has expired. */
export class KoolbaseInvitationInvalidError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'This invitation has been revoked or expired', 'invitation_invalid');
    this.name = 'KoolbaseInvitationInvalidError';
    Object.setPrototypeOf(this, KoolbaseInvitationInvalidError.prototype);
  }
}

/** The project id in the request is not valid. */
export class KoolbaseProjectInvalidError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'Invalid project id', 'project_invalid');
    this.name = 'KoolbaseProjectInvalidError';
    Object.setPrototypeOf(this, KoolbaseProjectInvalidError.prototype);
  }
}

/** The request body could not be decoded. */
export class KoolbaseInvalidBodyError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'Could not decode the request body', 'invalid_body');
    this.name = 'KoolbaseInvalidBodyError';
    Object.setPrototypeOf(this, KoolbaseInvalidBodyError.prototype);
  }
}

/**
 * The request asked for no change — an update with nothing to update.
 */
export class KoolbaseNoChangesError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'The request contains no changes', 'no_changes');
    this.name = 'KoolbaseNoChangesError';
    Object.setPrototypeOf(this, KoolbaseNoChangesError.prototype);
  }
}

/**
 * Something already exists, or something is in the wrong state, where the
 * server did not say more than that.
 *
 * Carries whichever generic code arrived — conflict, duplicate,
 * state_conflict — rather than four classes for codes that differ only in
 * spelling. A caller who needs to branch finely is being underserved by the
 * server, not by this.
 */
export class KoolbaseStateConflictError extends KoolbaseDataError {
  constructor(message: string, code: string) {
    super(message, code);
    this.name = 'KoolbaseStateConflictError';
    Object.setPrototypeOf(this, KoolbaseStateConflictError.prototype);
  }
}

export class KoolbaseVectorFieldExistsError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'A vector field with that name already exists on this collection', 'vector_field_exists');
    this.name = 'KoolbaseVectorFieldExistsError';
    Object.setPrototypeOf(this, KoolbaseVectorFieldExistsError.prototype);
  }
}

/**
 * A backfill was asked for on a field that embeds nothing automatically.
 * Set provider, model and source_field on the field first.
 */
export class KoolbaseFieldNotAutoEmbedError extends KoolbaseDataError {
  constructor(message?: string) {
    super(
      message ?? 'This vector field has no auto-embedding config; set provider, model and source_field first',
      'field_not_auto_embed'
    );
    this.name = 'KoolbaseFieldNotAutoEmbedError';
    Object.setPrototypeOf(this, KoolbaseFieldNotAutoEmbedError.prototype);
  }
}

/**
 * Embedding config is partial. Provider, model and source_field are set
 * together or cleared together — half a configuration is refused rather than
 * half-applied, which would embed against a model nobody chose.
 */
export class KoolbaseInvalidEmbeddingConfigError extends KoolbaseDataError {
  constructor(message?: string) {
    super(
      message ?? 'Embedding config requires provider, model and source_field together, or all cleared',
      'invalid_embedding_config'
    );
    this.name = 'KoolbaseInvalidEmbeddingConfigError';
    Object.setPrototypeOf(this, KoolbaseInvalidEmbeddingConfigError.prototype);
  }
}

/**
 * The project has no embedding provider configured. Embedding runs on the
 * project's own Gemini or OpenAI key.
 */
export class KoolbaseProviderNotConfiguredError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'No embedding provider is configured for this project', 'provider_not_configured');
    this.name = 'KoolbaseProviderNotConfiguredError';
    Object.setPrototypeOf(this, KoolbaseProviderNotConfiguredError.prototype);
  }
}

/** The configured provider's credentials were rejected by the provider. */
export class KoolbaseProviderInvalidError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'The embedding provider credentials are not valid', 'provider_invalid');
    this.name = 'KoolbaseProviderInvalidError';
    Object.setPrototypeOf(this, KoolbaseProviderInvalidError.prototype);
  }
}

export class KoolbaseRevisionMismatchError extends KoolbaseDataError {
  constructor(
    message?: string,
    readonly expectedRevision?: number,
    readonly currentRevision?: number,
    /** The record as the server holds it now. */
    readonly current?: Record<string, unknown>
  ) {
    super(message ?? 'The record has changed since you read it', 'revision_mismatch');
    this.name = 'KoolbaseRevisionMismatchError';
    Object.setPrototypeOf(this, KoolbaseRevisionMismatchError.prototype);
  }
}

/**
 * The same idempotency key sent with different data.
 *
 * Refused rather than replayed: the two requests do not agree, so neither
 * answer is safe. Usually a key reused by accident across two operations.
 */
export class KoolbaseIdempotencyKeyReusedError extends KoolbaseDataError {
  /**
   * Carries its code: the database package calls this idempotency_key_reused
   * and fiscal calls it idempotency_conflict, and an error reporting a code
   * the server did not send is a small lie that apps branching on e.code act
   * on.
   */
  constructor(message?: string, code = 'idempotency_key_reused') {
    super(message ?? 'Idempotency key reused with different data', code);
    this.name = 'KoolbaseIdempotencyKeyReusedError';
    Object.setPrototypeOf(this, KoolbaseIdempotencyKeyReusedError.prototype);
  }
}

/** A batch write failed for a reason the server did not classify further. */
export class KoolbaseBatchFailedError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'The batch write failed', 'batch_failed');
    this.name = 'KoolbaseBatchFailedError';
    Object.setPrototypeOf(this, KoolbaseBatchFailedError.prototype);
  }
}

/**
 * Creating a unique constraint over data that already breaks it. details
 * carry the offending values, so they can be shown rather than hunted for.
 */
export class KoolbaseDuplicateValuesError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'The collection has duplicate values for these fields', 'duplicate_values');
    this.name = 'KoolbaseDuplicateValuesError';
    Object.setPrototypeOf(this, KoolbaseDuplicateValuesError.prototype);
  }
}

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
 * A reference field points at a record that does not exist, is deleted, or
 * lives in another collection — the server responds 400 `reference_invalid`.
 *
 * Checked when the write commits, so it can surface from an insert, an update,
 * an upsert or a batch. In a batch the whole transaction is refused: nothing
 * in it was written.
 */
export class KoolbaseReferenceInvalidError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'A reference points at a record that does not exist', 'reference_invalid');
    this.name = 'KoolbaseReferenceInvalidError';
    Object.setPrototypeOf(this, KoolbaseReferenceInvalidError.prototype);
  }
}

/**
 * A record could not be deleted because live records still reference it, under
 * a reference declared `on_delete: restrict` — 409 `reference_in_use`.
 *
 * Delete the referencing records first, or in the same batch: the check runs at
 * commit, so one batch may delete a parent and its children in any order.
 */
export class KoolbaseReferenceInUseError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'This record is still referenced by other records', 'reference_in_use');
    this.name = 'KoolbaseReferenceInUseError';
    Object.setPrototypeOf(this, KoolbaseReferenceInUseError.prototype);
  }
}

/**
 * A reference could not be declared because existing records already point at
 * records that do not exist — 409 `dangling_references`.
 *
 * `dangling` lists the offending records so they can be repaired; Koolbase
 * never repairs them for you. It is capped at the first 50.
 */
export class KoolbaseDanglingReferencesError extends KoolbaseDataError {
  dangling: Array<{ record_id: string; value: string }>;

  constructor(message?: string, dangling?: Array<{ record_id: string; value: string }>) {
    super(message ?? 'Existing records point at records that do not exist', 'dangling_references');
    this.dangling = dangling ?? [];
    this.name = 'KoolbaseDanglingReferencesError';
    Object.setPrototypeOf(this, KoolbaseDanglingReferencesError.prototype);
  }
}

/**
 * A collection could not be deleted because another collection has a reference
 * field pointing at it — 409 `collection_referenced`. Remove that reference
 * first.
 */
export class KoolbaseCollectionReferencedError extends KoolbaseDataError {
  constructor(message?: string) {
    super(message ?? 'Another collection references this one', 'collection_referenced');
    this.name = 'KoolbaseCollectionReferencedError';
    Object.setPrototypeOf(this, KoolbaseCollectionReferencedError.prototype);
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
    case 'reference_invalid':
      return attach(new KoolbaseReferenceInvalidError(message));
    case 'reference_in_use':
      return attach(new KoolbaseReferenceInUseError(message));
    case 'dangling_references': {
      const d = (body?.details ?? {}) as { dangling?: Array<{ record_id: string; value: string }> };
      return attach(new KoolbaseDanglingReferencesError(message, d.dangling));
    }
    case 'collection_referenced':
      return attach(new KoolbaseCollectionReferencedError(message));
    case 'plan_limit_reached': {
      const d = (body?.details ?? {}) as { resource?: string; limit?: number; plan?: string };
      return new KoolbasePlanLimitError(message, d.resource, d.limit, d.plan);
    }
    case 'invalid_seed_file':
    case 'seed_key_not_unique':
    case 'seed_needs_decision':
    case 'seed_conflicts_require_force':
      return attach(new KoolbaseSeedError(message, code!));
    case 'slug_taken':
      return attach(new KoolbaseSlugTakenError(message));
    case 'invitation_invalid':
      return attach(new KoolbaseInvitationInvalidError(message));
    case 'project_invalid':
      return attach(new KoolbaseProjectInvalidError(message));
    case 'invalid_body':
      return attach(new KoolbaseInvalidBodyError(message));
    case 'no_changes':
      return attach(new KoolbaseNoChangesError(message));
    case 'conflict':
    case 'duplicate':
    case 'state_conflict':
      return attach(new KoolbaseStateConflictError(message, code!));
    case 'vector_field_exists':
      return attach(new KoolbaseVectorFieldExistsError(message));
    case 'field_not_auto_embed':
      return attach(new KoolbaseFieldNotAutoEmbedError(message));
    case 'invalid_embedding_config':
      return attach(new KoolbaseInvalidEmbeddingConfigError(message));
    case 'provider_not_configured':
      return attach(new KoolbaseProviderNotConfiguredError(message));
    case 'provider_invalid':
      return attach(new KoolbaseProviderInvalidError(message));
    case 'revision_mismatch': {
      // The typed fields come off details, which the server attaches for
      // exactly this. attach() still puts the whole bag on the error, so
      // nothing is lost for a caller reading it directly.
      const d = (body?.details ?? {}) as {
        expected_revision?: number;
        current_revision?: number;
        record?: Record<string, unknown>;
      };
      return attach(
        new KoolbaseRevisionMismatchError(
          message,
          d.expected_revision,
          d.current_revision,
          d.record
        )
      );
    }
    // Two codes, one situation — the database and fiscal packages name it
    // differently and a caller should not have to know which spoke.
    case 'idempotency_key_reused':
    case 'idempotency_conflict':
      return attach(new KoolbaseIdempotencyKeyReusedError(message, code));
    case 'batch_failed':
      return attach(new KoolbaseBatchFailedError(message));
    case 'duplicate_values':
      return attach(new KoolbaseDuplicateValuesError(message));
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
