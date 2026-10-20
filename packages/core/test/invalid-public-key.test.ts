import { koolbaseDataError } from '../src/database-errors';
import { koolbaseStorageError } from '../src/storage-errors';
import { functionInvokeError } from '../src/function-errors';
import {
  INVALID_PUBLIC_KEY_MESSAGE,
  KoolbaseInvalidPublicKeyError,
  KoolbaseUnauthenticatedError,
  invalidPublicKeyIn,
} from '../src/errors';

// #168/#169: a refused app key is a setup problem. It is never a session
// failure (which signs the user out) and never a wrong password.
describe('a refused app key', () => {
  const body = { code: 'invalid_public_key', error: INVALID_PUBLIC_KEY_MESSAGE };

  it('is the key, not a session, on a data 401', () => {
    const err = koolbaseDataError(401, body);
    expect(err).toBeInstanceOf(KoolbaseInvalidPublicKeyError);
    expect(err).not.toBeInstanceOf(KoolbaseUnauthenticatedError);
  });

  it('leaves any other data 401 a session failure', () => {
    expect(koolbaseDataError(401, { code: 'unauthenticated', error: 'no' })).toBeInstanceOf(
      KoolbaseUnauthenticatedError,
    );
  });

  it('is the key, not a session, on a storage 401', () => {
    const err = koolbaseStorageError(401, body);
    expect(err).toBeInstanceOf(KoolbaseInvalidPublicKeyError);
    expect(err).not.toBeInstanceOf(KoolbaseUnauthenticatedError);
  });

  it('is the key on a Function 401, by code or by the server words', () => {
    expect(functionInvokeError(401, 'x', 'invalid_public_key')).toBeInstanceOf(KoolbaseInvalidPublicKeyError);
    expect(functionInvokeError(401, INVALID_PUBLIC_KEY_MESSAGE)).toBeInstanceOf(KoolbaseInvalidPublicKeyError);
    expect(functionInvokeError(401, 'session over')).toBeInstanceOf(KoolbaseUnauthenticatedError);
  });

  it('is read from a body, and only that refusal', () => {
    expect(invalidPublicKeyIn(JSON.stringify(body))).toBeInstanceOf(KoolbaseInvalidPublicKeyError);
    expect(invalidPublicKeyIn('{"code":"unauthenticated"}')).toBeNull();
    expect(invalidPublicKeyIn('not json')).toBeNull();
  });

  it('carries its code', () => {
    expect(new KoolbaseInvalidPublicKeyError().code).toBe('invalid_public_key');
  });
});
