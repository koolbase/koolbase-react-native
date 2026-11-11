import { koolbaseDataError } from '../src/database-errors';
import { koolbaseStorageError } from '../src/storage-errors';
import { functionInvokeError } from '../src/function-errors';
import {
  KoolbasePreviewError,
  KoolbaseUnauthenticatedError,
  PREVIEW_ENDED_MESSAGE,
  PREVIEW_OTHER_PROJECT_MESSAGE,
  previewRefusalIn,
} from '../src/errors';

// A Run preview the API would not serve (koolbase-preview.app): an ended
// preview, or another project's key. Both are 403s from the API's preview
// guard. Neither is the user's session: nothing signs out.
describe('a refused Run preview', () => {
  const ended = { code: 'preview_not_live', error: 'this preview has expired or was replaced; press Run again' };
  const other = { code: 'preview_origin_mismatch', error: 'a preview can only call its own project' };

  it('says an ended preview has ended, on a data 403', () => {
    const err = koolbaseDataError(403, ended);
    expect(err).toBeInstanceOf(KoolbasePreviewError);
    expect(err).not.toBeInstanceOf(KoolbaseUnauthenticatedError);
    expect(err.code).toBe('preview_not_live');
    expect(err.message).toBe(PREVIEW_ENDED_MESSAGE);
  });

  it("names another project's key, on a storage 403", () => {
    const err = koolbaseStorageError(403, other);
    expect(err).toBeInstanceOf(KoolbasePreviewError);
    expect(err.message).toBe(PREVIEW_OTHER_PROJECT_MESSAGE);
  });

  it('is the preview, not a permission, on a Function 403', () => {
    expect(functionInvokeError(403, 'x', 'preview_not_live')).toBeInstanceOf(KoolbasePreviewError);
    expect(functionInvokeError(403, 'no')).not.toBeInstanceOf(KoolbasePreviewError);
  });

  it('is read from a body, and only that', () => {
    expect(previewRefusalIn(JSON.stringify(ended))).toBeInstanceOf(KoolbasePreviewError);
    expect(previewRefusalIn(JSON.stringify(other))?.code).toBe('preview_origin_mismatch');
    expect(previewRefusalIn('{"code":"permission_denied"}')).toBeNull();
    expect(previewRefusalIn('not json')).toBeNull();
  });
});
