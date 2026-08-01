import { KoolbaseError, KoolbaseUnauthenticatedError } from './errors';

/**
 * A Function call did not succeed.
 *
 * Every failure used to be a bare `Error`, so an application could only match on
 * message text — and a missing Function, a caller without permission, a Function
 * that threw, and an exhausted plan limit all looked alike, though they call for
 * entirely different responses.
 */
export class FunctionInvokeError extends KoolbaseError {
  statusCode?: number;

  constructor(message: string, statusCode?: number, code?: string) {
    super(message, code);
    this.statusCode = statusCode;
    this.name = 'FunctionInvokeError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** No Function by that name is deployed to this project. */
export class FunctionNotFoundError extends FunctionInvokeError {
  constructor(message: string) {
    super(message, 404, 'not_found');
    this.name = 'FunctionNotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The caller may not invoke this Function.
 *
 * Distinct from an authentication failure: the credentials were accepted and
 * this caller is not permitted. Retrying will not help, and signing the user out
 * would be wrong.
 */
export class FunctionPermissionError extends FunctionInvokeError {
  constructor(message: string) {
    super(message, 403, 'permission_denied');
    this.name = 'FunctionPermissionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** The Function rejected its arguments. */
export class FunctionValidationError extends FunctionInvokeError {
  constructor(message: string) {
    super(message, 400, 'validation_error');
    this.name = 'FunctionValidationError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The project's Function invocations are used up.
 *
 * Nothing about the call is wrong — retrying will not help until the plan
 * allows it. The one failure here fixed by changing a plan rather than code.
 */
export class FunctionQuotaExceededError extends FunctionInvokeError {
  constructor(message: string) {
    super(message, 402, 'limit_reached');
    this.name = 'FunctionQuotaExceededError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The Function ran and threw.
 *
 * The message is the Function's own, not the platform's — it comes from the code
 * that was deployed.
 */
export class FunctionExecutionError extends FunctionInvokeError {
  constructor(message: string, statusCode?: number) {
    super(message, statusCode, 'execution_failed');
    this.name = 'FunctionExecutionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Builds the right error for a failed invocation. */
export function functionInvokeError(status: number, message: string): KoolbaseError {
  switch (status) {
    case 401:
      // Not a Function failure. A rejected credential stops the whole SDK
      // working, so it raises the shared type.
      return new KoolbaseUnauthenticatedError(message);
    case 403:
      return new FunctionPermissionError(message);
    case 404:
      return new FunctionNotFoundError(message);
    case 400:
      return new FunctionValidationError(message);
    case 402:
      return new FunctionQuotaExceededError(message);
  }
  if (status >= 500) return new FunctionExecutionError(message, status);
  return new FunctionInvokeError(message, status);
}
