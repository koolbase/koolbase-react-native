import {
  koolbaseDataError,
  KoolbaseReferenceInvalidError,
  KoolbaseReferenceInUseError,
  KoolbaseDanglingReferencesError,
  KoolbaseCollectionReferencedError,
  KoolbaseDataError,
} from '../src/database-errors.js';

// Reference fields are enforced by the database, so their violations can
// surface from any write — an insert, an update, an upsert, or a batch at
// commit. These map the server's four codes to catchable classes; without
// them an app's instanceof check silently never runs, which is the same gap
// that left fourteen error codes unmapped before.
//
// The bodies here are what the API actually sends.

describe('reference errors', () => {
  it('reference_invalid is catchable', () => {
    const err = koolbaseDataError(400, {
      code: 'reference_invalid',
      error: 'field "grant_id" points at record 3f2b… which does not exist',
    });
    expect(err).toBeInstanceOf(KoolbaseReferenceInvalidError);
    expect(err).toBeInstanceOf(KoolbaseDataError);
    expect((err as KoolbaseDataError).code).toBe('reference_invalid');
    expect(err.message).toContain('grant_id');
  });

  it('reference_in_use is catchable', () => {
    const err = koolbaseDataError(409, {
      code: 'reference_in_use',
      error: 'record 8a1c… is still referenced by field "grant_id"',
    });
    expect(err).toBeInstanceOf(KoolbaseReferenceInUseError);
    expect((err as KoolbaseDataError).code).toBe('reference_in_use');
  });

  it('dangling_references carries the offending records', () => {
    // The point of the code: the caller has to repair the data, so it needs
    // to know which records are wrong. Koolbase never repairs them.
    const err = koolbaseDataError(409, {
      code: 'dangling_references',
      error: 'existing records point at records that do not exist',
      details: {
        dangling: [
          { record_id: 'rec_1', value: 'missing_1' },
          { record_id: 'rec_2', value: 'missing_2' },
        ],
      },
    });
    expect(err).toBeInstanceOf(KoolbaseDanglingReferencesError);
    const d = err as KoolbaseDanglingReferencesError;
    expect(d.dangling).toHaveLength(2);
    expect(d.dangling[0].record_id).toBe('rec_1');
    expect(d.dangling[1].value).toBe('missing_2');
  });

  it('dangling_references with no details is still catchable', () => {
    const err = koolbaseDataError(409, { code: 'dangling_references', error: 'nope' });
    expect(err).toBeInstanceOf(KoolbaseDanglingReferencesError);
    expect((err as KoolbaseDanglingReferencesError).dangling).toEqual([]);
  });

  it('collection_referenced is catchable', () => {
    const err = koolbaseDataError(409, {
      code: 'collection_referenced',
      error: 'another collection has a reference field pointing at this collection',
    });
    expect(err).toBeInstanceOf(KoolbaseCollectionReferencedError);
  });

  it('a reference error is not mistaken for a unique violation', () => {
    // Both are 409s on a write; branching on the class must still separate
    // "this value already exists" from "this record is still referenced".
    const err = koolbaseDataError(409, { code: 'reference_in_use', error: 'still referenced' });
    expect(err).toBeInstanceOf(KoolbaseReferenceInUseError);
    expect((err as KoolbaseDataError).code).not.toBe('unique_violation');
  });
});
