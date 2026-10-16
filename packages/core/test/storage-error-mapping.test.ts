import { koolbaseStorageError } from '../src/storage-errors';
import * as errors from '../src/storage-errors';
import { KoolbasePlanLimitError } from '../src/errors';

// Storage's half of the same guard the auth and database tables provide.
describe('storage error mapping', () => {
  it.each([
    ['path_conflict', errors.KoolbaseStorageConflictError],
    ['quota_exceeded', errors.KoolbaseStorageQuotaError],
    ['file_too_large', errors.KoolbaseStorageFileTooLargeError],
    ['mime_not_allowed', errors.KoolbaseStorageMimeTypeError],
    ['metadata_invalid', errors.KoolbaseStorageMetadataInvalidError],
    ['upload_expired', errors.KoolbaseUploadExpiredError],
    ['cap_below_usage', errors.KoolbaseCapBelowUsageError],
    ['upload_url_failed', errors.KoolbaseUploadURLFailedError],
    ['upload_not_found', errors.KoolbaseUploadNotFoundError],
    ['bucket_busy', errors.KoolbaseStorageBusyError],
    ['invalid_cursor', errors.KoolbaseStorageInvalidCursorError],
    ['sign_in_required', errors.KoolbaseStorageSignInRequiredError],
    ['not_allowed', errors.KoolbaseStoragePermissionError],
    ['file_in_use', errors.KoolbaseStorageFileInUseError],
    ['name_has_history', errors.KoolbaseStorageNameHasHistoryError],
    ['upload_incomplete', errors.KoolbaseUploadIncompleteError],
    ['malware_found', errors.KoolbaseStorageMalwareError],
    ['quarantined', errors.KoolbaseStorageQuarantinedError],
    ['plan_limit_reached', KoolbasePlanLimitError]])('%s maps to its own class', (code, Expected) => {
    expect(koolbaseStorageError(400, { code, error: 'server message' })).toBeInstanceOf(Expected);
  });

  it('storage S6: malware keeps the server message; a 423 with no code is quarantined', () => {
    const m = koolbaseStorageError(422, { code: 'malware_found', error: 'malware found: Eicar-Signature' });
    expect(m).toBeInstanceOf(errors.KoolbaseStorageMalwareError);
    expect(m.message).toBe('malware found: Eicar-Signature');
    expect(m.code).toBe('malware_found');
    const q = koolbaseStorageError(423, { error: 'locked' });
    expect(q).toBeInstanceOf(errors.KoolbaseStorageQuarantinedError);
    expect(q.code).toBe('quarantined');
    expect(q).toBeInstanceOf(errors.KoolbaseStorageError);
  });
});
