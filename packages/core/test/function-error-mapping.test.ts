import { functionInvokeError } from '../src/function-errors';
import * as fnErrors from '../src/function-errors';
import { KoolbaseUnauthenticatedError } from '../src/errors';

// Functions map by HTTP status rather than by an error code, which is right
// for an invoke — the failure modes are transport-shaped. But 504 fell into
// the generic 5xx branch, so a function that was KILLED FOR RUNNING TOO LONG
// was indistinguishable from one that threw. Those need different answers:
// a timeout means retry or raise the limit, an exception means fix the code.
// The server already tells them apart; it logs 504 as "timeout".

describe('function invoke errors', () => {
  it.each([
    [401, KoolbaseUnauthenticatedError],
    [403, fnErrors.FunctionPermissionError],
    [404, fnErrors.FunctionNotFoundError],
    [400, fnErrors.FunctionValidationError],
    [402, fnErrors.FunctionQuotaExceededError],
    [429, fnErrors.FunctionRateLimitError],
    [504, fnErrors.FunctionTimeoutError],
    [500, fnErrors.FunctionExecutionError],
  ])('%s maps to its own type', (status, Expected) => {
    expect(functionInvokeError(status as number, 'failed')).toBeInstanceOf(Expected);
  });

  it('a timeout is not an execution failure', () => {
    // The specific confusion this exists to prevent.
    const timeout = functionInvokeError(504, 'timed out');
    expect(timeout).not.toBeInstanceOf(fnErrors.FunctionExecutionError);
    expect((timeout as { code?: string }).code).toBe('timeout');
  });

  it('an unknown status still produces something catchable', () => {
    expect(functionInvokeError(418, 'teapot')).toBeInstanceOf(fnErrors.FunctionInvokeError);
  });
});
