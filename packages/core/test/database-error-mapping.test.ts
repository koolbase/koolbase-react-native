import { koolbaseDataError } from '../src/database-errors';
import * as errors from '../src/database-errors';
import { KoolbaseServiceUnavailableError } from '../src/errors';

// Every database and vector error code the API emits, mapped to the class an
// app catches.
//
// Same guard as the auth table: a code with no case falls through to a
// generic error and the app's `instanceof` branch silently never runs.
// Nothing inside the SDK can detect that, which is how four codes went
// unmapped — including ambiguous_match, where an upsert refuses because the
// filter matched several records and the app is told only that something
// failed.

const cases: Array<[string, new (...a: never[]) => Error]> = [
  ['unique_violation', errors.KoolbaseConflictError],
  ['not_found', errors.KoolbaseNotFoundError],
  ['record_not_found', errors.KoolbaseNotFoundError],
  ['collection_not_found', errors.KoolbaseNotFoundError],
  ['vector_not_found', errors.KoolbaseNotFoundError],
  ['vector_field_not_found', errors.KoolbaseNotFoundError],
  ['permission_denied', errors.KoolbasePermissionError],
  ['rate_limit', errors.KoolbaseRateLimitError],
  ['validation_error', errors.KoolbaseValidationError],
  ['vector_collection_mismatch', errors.KoolbaseValidationError],
  ['unsupported_dimension', errors.KoolbaseValidationError],
  ['vector_dimension_mismatch', errors.KoolbaseVectorDimensionMismatchError],

  // Added 19 Sep, after comparing what the API emits against what this mapped.
  ['ambiguous_match', errors.KoolbaseAmbiguousMatchError],
  ['constraint_exists', errors.KoolbaseConstraintExistsError],
  ['constraint_not_found', errors.KoolbaseConstraintNotFoundError],
  ['insufficient_authority', errors.KoolbaseInsufficientAuthorityError],

  // Mapped once the constants file made the API's full list exact.
  ['revision_mismatch', errors.KoolbaseRevisionMismatchError],
  ['idempotency_key_reused', errors.KoolbaseIdempotencyKeyReusedError],
  ['idempotency_conflict', errors.KoolbaseIdempotencyKeyReusedError],
  ['batch_failed', errors.KoolbaseBatchFailedError],
  ['duplicate_values', errors.KoolbaseDuplicateValuesError],
  ['vector_field_exists', errors.KoolbaseVectorFieldExistsError],
  ['field_not_auto_embed', errors.KoolbaseFieldNotAutoEmbedError],
  ['invalid_embedding_config', errors.KoolbaseInvalidEmbeddingConfigError],
  ['provider_not_configured', errors.KoolbaseProviderNotConfiguredError],
  ['provider_invalid', errors.KoolbaseProviderInvalidError],
  ['slug_taken', errors.KoolbaseSlugTakenError],
  ['invitation_invalid', errors.KoolbaseInvitationInvalidError],
  ['project_invalid', errors.KoolbaseProjectInvalidError],
  ['invalid_body', errors.KoolbaseInvalidBodyError],
  ['no_changes', errors.KoolbaseNoChangesError],
  ['invalid_seed_file', errors.KoolbaseSeedError],
  ['seed_key_not_unique', errors.KoolbaseSeedError],
  ['seed_needs_decision', errors.KoolbaseSeedError],
  ['seed_conflicts_require_force', errors.KoolbaseSeedError],
  ['conflict', errors.KoolbaseStateConflictError],
  ['duplicate', errors.KoolbaseStateConflictError],
  ['state_conflict', errors.KoolbaseStateConflictError],
  // #162.
  ['auto_embedding_managed', errors.KoolbaseAutoEmbeddingManagedError],
  ['reembed_confirmation_required', errors.KoolbaseReembedConfirmationRequiredError],
  ['embedding_model_unsupported', errors.KoolbaseEmbeddingModelUnsupportedError],
  // #161: shared, any request to the project.
  ['placement_unavailable', KoolbaseServiceUnavailableError],
];

describe('database error mapping', () => {
  it.each(cases)('%s maps to its own class', (code, Expected) => {
    const err = koolbaseDataError(400, { code, error: 'server message' });
    expect(err).toBeInstanceOf(Expected);
  });

  it.each(cases)('%s reports the code the server sent', (code) => {
    // An error whose `code` differs from the response is a small lie, and
    // apps that branch on e.code rather than instanceof act on it. This is
    // why insufficient_authority did not fold into KoolbasePermissionError,
    // which hardcodes permission_denied.
    const err = koolbaseDataError(400, { code, error: 'server message' }) as { code?: string };
    expect(err.code).toBe(code);
  });

  it('a re-embed refusal carries its estimate', () => {
    const estimate = {
      records: 2400, records_to_embed: 2000, estimated_input_tokens: 51000, provider: 'openai',
      model: 'text-embedding-3-large', dimensions: 1536, billed_by: 'your_provider', estimate: true,
      cache_may_apply: false, sampled_records: 500,
    };
    const err = koolbaseDataError(409, { code: 'reembed_confirmation_required', error: 'confirm', details: estimate });
    expect(err).toBeInstanceOf(errors.KoolbaseReembedConfirmationRequiredError);
    expect((err as errors.KoolbaseReembedConfirmationRequiredError).estimate).toEqual(estimate);
  });

  it('a database that cannot be reached is worth retrying', () => {
    const err = koolbaseDataError(503, { code: 'placement_unavailable', error: 'try again' });
    expect(err).toBeInstanceOf(KoolbaseServiceUnavailableError);
    expect((err as KoolbaseServiceUnavailableError).retryable).toBe(true);
    expect(err.message).toBe('try again');
  });

  it('carries the server message rather than a canned one', () => {
    const err = koolbaseDataError(400, {
      code: 'ambiguous_match',
      error: 'upsert match resolved to more than one record',
    });
    expect(err.message).toBe('upsert match resolved to more than one record');
  });
});
