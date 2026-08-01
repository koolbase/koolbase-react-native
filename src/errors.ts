/**
 * The root of every error the SDK raises.
 *
 * Each subsystem has its own family beneath this — data, storage, auth — so an
 * application can catch narrowly where it wants to and broadly where it does
 * not:
 *
 * ```ts
 * try {
 *   await Koolbase.storage.upload(...);
 * } catch (e) {
 *   if (e instanceof KoolbaseUnauthenticatedError) return goToLogin();
 *   if (e instanceof KoolbaseStorageError) return showError(e.message);
 *   throw e;
 * }
 * ```
 *
 * The families used to be unrelated roots, which meant a failure belonging to no
 * single subsystem — a rejected credential, discovered by whichever call
 * happened to make it — had to be redefined in each one.
 */
export class KoolbaseError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
    this.name = 'KoolbaseError';
    // Required for `instanceof` to work across the prototype chain when
    // targeting ES5-era output, which TypeScript's class extension otherwise
    // breaks. Every subclass repeats it for the same reason.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The server would not accept the caller's credentials.
 *
 * Raised by any surface — a query, an upload, a Function invoke — because a
 * session stops working for the whole SDK at once, not one subsystem at a time.
 *
 * Named for what the server actually reports. A 401 covers an expired session, a
 * revoked key, a malformed header, and no credentials at all, and the server
 * does not distinguish them: calling this "session expired" would claim a
 * precision that does not exist, and an app that signed a user out on a revoked
 * API key would be acting on it.
 *
 * When the SDK holds a session it clears it before throwing, so by the time an
 * application catches this the user is already signed out.
 */
export class KoolbaseUnauthenticatedError extends KoolbaseError {
  constructor(message: string) {
    super(message, 'unauthenticated');
    this.name = 'KoolbaseUnauthenticatedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
