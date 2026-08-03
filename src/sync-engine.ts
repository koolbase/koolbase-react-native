import {
  readOfflineState,
  mutateOfflineState,
  migrateLegacyQueue,
  QueuedWrite,
} from './offline-state';
import { KoolbaseUnauthenticatedError } from './errors';
import NetInfo from '@react-native-community/netinfo';
import {
  invalidateCache,
  removeCachedRecord,
} from './cache-store';
import { KoolbaseConfig } from './types';

type SyncCallback = () => void;

/**
 * Internal signal that the server refused a write because the record moved.
 *
 * Not exported: a conflict during replay becomes durable state rather than
 * reaching a caller, since nobody is waiting on a write made hours ago.
 */
/**
 * Whether the server's answer can change on a later attempt.
 *
 * Terminal means the same request would meet the same decision: the data does
 * not satisfy the collection's rules, the record is gone, the caller is not
 * permitted, a unique value is taken. Retrying spends attempts to learn what is
 * already known.
 *
 * 403 is terminal even though a role change could later permit it. A queue that
 * holds writes indefinitely against a maybe is how a retry loop becomes
 * invisible — surfacing it lets an app retry deliberately if roles change.
 */
function isTerminal(status: number): boolean {
  return status === 400 || status === 403 || status === 404 || status === 409;
}

/** Raised when the server refused for a reason retrying cannot change. */
class TerminalRejection extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class RevisionMismatch extends Error {
  constructor(
    readonly serverRecord?: Record<string, unknown>,
    readonly serverRevision?: number,
  ) {
    super('revision mismatch');
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SyncEngine {
  private config: KoolbaseConfig;
  private getUserId: () => string | null;
  private getToken: () => Promise<string | null>;
  private onSyncComplete?: SyncCallback;

  /**
   * Called when the server rejects the caller's credentials during replay.
   *
   * Background sync is the likeliest place to meet a dead session: the queue
   * replays writes made long before the session stopped being honoured.
   */
  private onSessionExpired?: () => Promise<void>;
  private unsubscribe?: () => void;
  private isSyncing = false;

  constructor(
    config: KoolbaseConfig,
    getUserId: () => string | null,
    getToken: () => Promise<string | null>,
    onSyncComplete?: SyncCallback,
    onSessionExpired?: () => Promise<void>
  ) {
    this.config = config;
    this.getUserId = getUserId;
    this.getToken = getToken;
    this.onSyncComplete = onSyncComplete;
    this.onSessionExpired = onSessionExpired;
  }

  start(): void {
    this.unsubscribe = NetInfo.addEventListener(state => {
      if (state.isConnected && state.isInternetReachable !== false) {
        this.flush();
      }
    });
  }

  stop(): void {
    this.unsubscribe?.();
  }

  async flush(): Promise<void> {
    if (this.isSyncing) return;
    const userId = this.getUserId();
    if (!userId) return;

    this.isSyncing = true;
    try {
      // Before anything is sent. Writes queued by an earlier version sit under a
      // different key, and a migration that ran after replay — or depended on
      // being online — would give the same input different outcomes. It clears
      // the old key when done, so later calls find nothing and return.
      await migrateLegacyQueue(userId);

      const { pending } = await readOfflineState(userId);
      if (pending.length === 0) return;

      // Records whose chain stopped this pass. Writes queued after a conflicted
      // one were composed against the state it would have produced, so applying
      // them now would write against a state their baseline never described.
      const blocked = new Set<string>();

      for (const queued of pending) {
        if (queued.recordId && blocked.has(queued.recordId)) continue;

        // Read fresh. The list was taken at the start of the pass, so a write
        // behind one that has already landed still carries the revision it was
        // queued with — and would replay against a revision its predecessor has
        // since superseded, conflicting for a reason the user never caused.
        const state = await readOfflineState(userId);
        const write = state.pending.find((w) => w.id === queued.id);
        if (!write) continue;

        try {
          const revision = await this.executeWrite(write);
          // The replayed write just changed the server; the cache must stop
          // testifying to the old world. Mirrors the online paths — a replayed
          // delete evicts the record, and every replayed write invalidates the
          // collection's cached queries, so the next query reconverges instead
          // of serving a ghost.
          if (write.operation === 'delete' && write.recordId) {
            await removeCachedRecord(userId, write.recordId);
          }
          await invalidateCache(userId, write.collection);
          await mutateOfflineState(userId, (s) => {
            s.pending = s.pending.filter((w) => w.id !== write.id);
            // Anything behind this for the same record was composed against its
            // result, and now knows the revision that result carries.
            if (revision !== undefined && write.recordId) {
              for (const w of s.pending) {
                if (w.recordId === write.recordId) w.baseRevision = revision;
              }
            }
          });
        } catch (e) {
          if (e instanceof KoolbaseUnauthenticatedError) {
            // The session is gone, so nothing else in the queue can succeed.
            // Stopping beats spending a retry on every remaining write against
            // a token the server has already refused; the queue is intact and
            // replays after login.
            await this.onSessionExpired?.();
            return;
          }
          if (e instanceof RevisionMismatch) {
            // Not a failure to retry — retrying cannot help. It becomes durable
            // unresolved state, in one write so it can be in neither place nor
            // both.
            await mutateOfflineState(userId, (s) => {
              s.pending = s.pending.filter((w) => w.id !== write.id);
              s.conflicts.push({
                id: write.id,
                // The record moved between the change being made and the queue
                // reaching it — distinct from a write that never had a baseline
                // to compare against at all.
                reason: 'concurrent_modification',
                operation: write.operation,
                collection: write.collection,
                recordId: write.recordId!,
                local: write.data,
                baseline: write.baseline,
                server: e.serverRecord,
                baseRevision: write.baseRevision,
                serverRevision: e.serverRevision,
                createdAt: new Date().toISOString(),
              });
            });
            if (write.recordId) blocked.add(write.recordId);
            continue;
          }
          if (e instanceof TerminalRejection) {
            // The server made a decision that will not change on a later
            // attempt. Retrying spends attempts to learn what is already known;
            // dropping loses a change the user believes is saved. It waits,
            // with what the server said, so someone can act on it.
            await mutateOfflineState(userId, (s) => {
              s.pending = s.pending.filter((w) => w.id !== write.id);
              s.conflicts.push({
                id: write.id,
                reason: 'rejected',
                operation: write.operation,
                collection: write.collection,
                recordId: write.recordId ?? '',
                local: write.data,
                baseline: write.baseline,
                baseRevision: write.baseRevision,
                message: e.message,
                createdAt: new Date().toISOString(),
              });
            });
            // A terminally rejected insert leaves an optimistic record behind
            // — cached at enqueue for a record the server refused to create.
            // Left alone it is a phantom: it renders as saved, and an offline
            // edit against it queues a write to a record that does not exist.
            // Evict it, and invalidate the collection so cached queries stop
            // serving it. The conflict above keeps the user's data and the
            // server's verdict; the cache stops testifying to a fiction.
            // MUTATION: phantom eviction removed
            if (write.recordId) blocked.add(write.recordId);
            continue;
          }
          // Retryable: the network, a 5xx, a rate limit. The count is kept so a
          // caller can see a write that keeps failing, but nothing drops it —
          // a write discarded after three attempts is discarded silently, and
          // the user is never told.
          await mutateOfflineState(userId, (s) => {
            const w = s.pending.find((x) => x.id === write.id);
            if (w) w.retries += 1;
          });
        }
      }
      this.onSyncComplete?.();
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Sends one queued write, returning the revision the record now carries.
   *
   * The revision matters to whatever is queued behind this for the same record:
   * those were composed against this one's result and cannot know its revision
   * until the server assigns it.
   */
  private async executeWrite(write: QueuedWrite): Promise<number | undefined> {
    const token = await this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.publicKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const url =
      write.operation === 'insert'
        ? `${this.config.baseUrl}/v1/sdk/db/insert`
        : `${this.config.baseUrl}/v1/sdk/db/records/${write.recordId}`;

    let res: Response;
    if (write.operation === 'insert') {
      res = await fetch(url, {
        method: 'POST',
        headers,
        // The write's own id: generated at enqueue, identical on every retry.
        // Without it, an insert whose response was lost duplicated on replay —
        // the server had no way to recognise the repeat.
        body: JSON.stringify({
          collection: write.collection,
          data: write.data,
          idempotency_key: write.id,
        }),
      });
    } else if (write.operation === 'update') {
      res = await fetch(url, {
        method: 'PATCH',
        headers,
        // The revision the change was composed against. The server applies it
        // only if the record still carries that revision, so nothing can land
        // between the client deciding the write is safe and the server applying
        // it — which matters here most of all, since hours may have passed.
        body: JSON.stringify({
          data: write.data,
          ...(write.baseRevision !== undefined
            ? { expected_revision: write.baseRevision }
            : {}),
        }),
      });
    } else {
      const q =
        write.baseRevision !== undefined
          ? `?expected_revision=${write.baseRevision}`
          : '';
      res = await fetch(`${url}${q}`, { method: 'DELETE', headers });
    }

    if (res.status === 401) throw new KoolbaseUnauthenticatedError('unauthorized');

    if (res.status === 409) {
      const body = await res.json().catch(() => ({} as any));
      if (body?.code === 'revision_mismatch') {
        throw new RevisionMismatch(
          body?.details?.record,
          body?.details?.current_revision
        );
      }
    }

    if (!res.ok && res.status !== 204) {
      const body = await res.json().catch(() => ({} as any));
      const message = (body?.error as string) ?? `${write.operation} failed`;
      // A 404 on a delete means the record is already gone, which is what the
      // write was asking for. Satisfied, not failed.
      if (res.status === 404 && write.operation === 'delete') return undefined;
      if (isTerminal(res.status)) throw new TerminalRejection(message, res.status);
      throw new Error(`${write.operation} sync failed: ${res.status}`);
    }

    const text = await res.text().catch(() => '');
    if (!text) return undefined;
    try {
      return JSON.parse(text)?.$revision;
    } catch {
      return undefined;
    }
  }
}
