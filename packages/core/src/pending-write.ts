import { QueuedWrite } from './offline-state';

/**
 * A change made offline, waiting to be sent.
 *
 * The counterpart to KoolbaseConflict, one step earlier in the lifecycle: a
 * conflict is a write the server refused; a pending write is one the server has
 * not seen yet. Both are durable state an app should surface — a queue nobody
 * can see accumulates invisibly, and the changes it holds feel saved to the
 * user while existing only on this device.
 *
 * The case that makes this API matter: logout. Queues are per-user and survive
 * logout by design, so a user signing out with pending writes walks away
 * believing their edits saved — and they sync whenever that user next logs in
 * on this device, which may be never. Warn before logout:
 *
 * ```ts
 * const pending = await Koolbase.db.pendingWrites();
 * if (pending.length > 0) {
 *   // "You have 3 unsynced changes. Sync now, or they wait until you
 *   //  next sign in on this device."
 * }
 * ```
 *
 * This is a snapshot, not a live handle — re-read after a sync. Per-user:
 * another account's queue on this device is not visible here.
 */
export interface PendingWrite {
  id: string;
  operation: 'insert' | 'update' | 'delete';
  collection: string;
  /** Absent for an insert the server has not yet assigned. */
  recordId?: string;
  /** What the user changed. Absent for a delete. */
  data?: Record<string, unknown>;
  enqueuedAt: string;
  /** Failed send attempts so far. A count, not a policy — nothing drops it. */
  attempts: number;
}

/**
 * Maps the stored write to its public shape, field by field.
 *
 * Deliberately not a spread: the stored write carries baseline and baseRevision
 * — replay mechanics, not contract. A spread would leak whatever the storage
 * shape grows next; naming each field means new internals stay internal until
 * someone chooses otherwise.
 */
export function toPendingWrite(w: QueuedWrite): PendingWrite {
  return {
    id: w.id,
    operation: w.operation,
    collection: w.collection,
    recordId: w.recordId,
    data: w.data,
    enqueuedAt: w.enqueuedAt,
    attempts: w.retries,
  };
}
