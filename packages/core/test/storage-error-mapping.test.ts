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
    ['plan_limit_reached', KoolbasePlanLimitError],
  ])('%s maps to its own class', (code, Expected) => {
    expect(koolbaseStorageError(400, { code, error: 'server message' })).toBeInstanceOf(Expected);
  });
});
