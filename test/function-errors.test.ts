import { functionInvokeError } from '../src/function-errors';
import {
  FunctionInvokeError,
  FunctionNotFoundError,
  FunctionPermissionError,
  FunctionQuotaExceededError,
  FunctionValidationError,
  FunctionExecutionError,
} from '../src/function-errors';
import { KoolbaseError, KoolbaseUnauthenticatedError } from '../src/errors';

/**
 * Every failed invocation was a bare Error, so an application could only match
 * on message text — and a missing Function, a caller without permission, a
 * Function that threw, and an exhausted plan limit all looked alike, though they
 * call for entirely different responses.
 */
describe('function failures', () => {
  it('are told apart', () => {
    expect(functionInvokeError(404, 'x')).toBeInstanceOf(FunctionNotFoundError);
    expect(functionInvokeError(403, 'x')).toBeInstanceOf(FunctionPermissionError);
    expect(functionInvokeError(400, 'x')).toBeInstanceOf(FunctionValidationError);
    expect(functionInvokeError(402, 'x')).toBeInstanceOf(FunctionQuotaExceededError);
    expect(functionInvokeError(500, 'x')).toBeInstanceOf(FunctionExecutionError);
  });

  it('a 401 is an authentication failure, not a Function failure', () => {
    const err = functionInvokeError(401, 'unauthorized');
    expect(err).toBeInstanceOf(KoolbaseUnauthenticatedError);
    expect(err).not.toBeInstanceOf(FunctionInvokeError);
  });

  // Signing someone out for calling a Function they may not call would be worse
  // than the loop this all exists to fix.
  it('a 403 does not sign the user out', () => {
    expect(functionInvokeError(403, 'x')).not.toBeInstanceOf(
      KoolbaseUnauthenticatedError
    );
  });

  it('everything is catchable as an SDK failure', () => {
    for (const status of [400, 401, 402, 403, 404, 418, 500]) {
      expect(functionInvokeError(status, 'x')).toBeInstanceOf(KoolbaseError);
    }
  });
});
