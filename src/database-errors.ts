/**
 * Thrown when a write is rejected because the value would violate a
 * collection's unique constraint — the server responds with 409 Conflict.
 * Catch it to handle duplicates, e.g. an email or username already in use.
 *
 * Currently surfaced by `upsert` (the online-only write). `insert` and
 * `update` are optimistic/offline-first: they accept the write locally and
 * sync in the background, so a constraint conflict on those paths is a
 * sync-time concern rather than a thrown error.
 *
 * @example
 * try {
 *   await koolbase.db.upsert('users', { email }, { name });
 * } catch (e) {
 *   if (e instanceof KoolbaseConflictError) {
 *     showError('That email is already registered.');
 *   }
 * }
 */
export class KoolbaseConflictError extends Error {
  code: string;

  constructor(message?: string) {
    super(message ?? 'Value violates a unique constraint');
    this.code = 'unique_violation';
    this.name = 'KoolbaseConflictError';
    Object.setPrototypeOf(this, KoolbaseConflictError.prototype);
  }
}
