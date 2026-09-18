import { ConflictReason } from './offline-state';

/** Resolves conflicts by id. */
export interface ConflictResolver {
  resolveWithLocal(conflictId: string): Promise<void>;
  resolveWithServer(conflictId: string): Promise<void>;
  resolveWithMerge(conflictId: string, data: Record<string, unknown>): Promise<void>;
  abandon(conflictId: string): Promise<void>;
}

/**
 * A queued offline write that could not be applied, waiting for a decision.
 *
 * Not an error to dismiss and not a write to retry: retrying cannot help, and
 * discarding it would lose a change the user believes is saved. It waits, and
 * keeps waiting across restarts, until the application decides.
 *
 * Only the application can decide. Whether a later edit should win depends on
 * what the data means, and a platform that chooses for everyone is wrong for
 * someone.
 */
export class KoolbaseConflict {
  constructor(
    readonly id: string,
    readonly reason: ConflictReason,
    readonly operation: 'insert' | 'update' | 'delete',
    readonly collection: string,
    readonly recordId: string,
    /** The change the user made, still unapplied. */
    readonly local: Record<string, unknown> | undefined,
    /** The record as it was when the change was composed, where that is known. */
    readonly baseline: Record<string, unknown> | undefined,
    /**
     * The record as the server held it when the write was refused, captured with
     * the refusal so deciding needs no fetch and cannot race one.
     *
     * Undefined when the reason is `baseline_unavailable` — nothing was ever
     * sent, so the server never answered.
     */
    readonly server: Record<string, unknown> | undefined,
    readonly baseRevision: number | undefined,
    readonly serverRevision: number | undefined,
    readonly createdAt: string,
    private readonly resolver: ConflictResolver,
  ) {}

  /**
   * Fields where the user's change and the server's version disagree.
   *
   * Only the fields the change touches: a record accumulates values the write
   * never asserted, and listing those would bury the real disagreement. Empty
   * when there is no server version to compare against.
   */
  get divergentFields(): string[] {
    if (!this.local) return [];
    if (!this.server) return Object.keys(this.local);
    return Object.keys(this.local).filter(
      (k) => JSON.stringify(this.server![k]) !== JSON.stringify(this.local![k]),
    );
  }

  /** How long this has been waiting. Metadata, not a deletion rule. */
  get ageMs(): number {
    return Date.now() - new Date(this.createdAt).getTime();
  }

  /**
   * Reapplies the user's change to the record as it stands now.
   *
   * An explicit decision to overwrite the server's version of the fields that
   * disagree. Conditional where a revision is known, so a record that moved
   * again while someone was deciding produces a new conflict rather than an
   * unnoticed overwrite.
   */
  resolveWithLocal(): Promise<void> {
    return this.resolver.resolveWithLocal(this.id);
  }

  /** Keeps the server's version and discards the user's change, as a decision. */
  resolveWithServer(): Promise<void> {
    return this.resolver.resolveWithServer(this.id);
  }

  /** Applies something the application composed from both versions. */
  resolveWithMerge(data: Record<string, unknown>): Promise<void> {
    return this.resolver.resolveWithMerge(this.id, data);
  }

  /** Drops the change without claiming either version won. */
  abandon(): Promise<void> {
    return this.resolver.abandon(this.id);
  }
}
