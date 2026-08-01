import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The offline system's correctness-critical state: writes waiting to be sent,
 * and writes the server refused because the record moved underneath them.
 *
 * Both live under one key so moving between them is a single write. A conflict
 * recorded without removing the pending write would replay and be refused
 * forever; a pending write removed without recording the conflict would lose a
 * change the user believes is saved. Two keys admit both outcomes.
 *
 * Records are cached separately, per record. Putting them here would let a
 * growing cache push this value past a storage ceiling and make the queue
 * unreadable — losing the correctness-critical state to something incidental.
 */

const VERSION = 'v1';

function stateKey(userId: string): string {
  return `koolbase:${VERSION}:${userId}:offline-state`;
}

export function recordKey(userId: string, collection: string, recordId: string): string {
  return `koolbase:${VERSION}:${userId}:record:${collection}:${recordId}`;
}

/** A write waiting to be sent. */
export interface QueuedWrite {
  id: string;
  operation: 'insert' | 'update' | 'delete';
  collection: string;
  recordId?: string;
  data?: Record<string, unknown>;

  /**
   * The record as the client last saw it, for update and delete.
   *
   * Copied in at enqueue time rather than looked up at replay: the record cache
   * can be evicted or invalidated in between, and a write whose baseline
   * depends on something else surviving is not durable. From here on the write
   * is self-contained.
   */
  baseline?: Record<string, unknown>;

  /** The revision that baseline carried, sent so the server can refuse atomically. */
  baseRevision?: number;

  retries: number;
  enqueuedAt: string;
}

/** A write the server would not apply, held until someone decides. */
export interface QueuedConflict {
  id: string;
  operation: 'update' | 'delete';
  collection: string;
  recordId: string;
  local?: Record<string, unknown>;
  baseline?: Record<string, unknown>;
  server?: Record<string, unknown>;
  baseRevision?: number;
  serverRevision?: number;
  createdAt: string;
}

export interface OfflineState {
  pending: QueuedWrite[];
  conflicts: QueuedConflict[];
}

const EMPTY: OfflineState = { pending: [], conflicts: [] };

/**
 * A conservative ceiling, below the lowest per-value limit any supported
 * AsyncStorage implementation imposes.
 *
 * Not a claim about a platform maximum — a boundary that leaves headroom for
 * rewriting and migration. A queue that cannot be written is a queue that
 * silently stops accepting work, so the limit is enforced with an error rather
 * than discovered.
 */
const MAX_STATE_BYTES = 1_000_000;

export class OfflineStateTooLargeError extends Error {
  constructor(bytes: number) {
    super(
      `Offline state is ${bytes} bytes, above the ${MAX_STATE_BYTES} byte limit. ` +
        'Sync or resolve what is queued before making more offline changes.'
    );
    this.name = 'OfflineStateTooLargeError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Serialises access per user.
 *
 * A single setItem is one storage operation, but read-modify-write is not: two
 * callers can both read, both modify, and the second write silently discards
 * the first. Two components queueing a write in the same tick is enough. The
 * lock is in-process — one JavaScript runtime is the assumption every React
 * Native app satisfies, and the SDK does not promise more.
 */
/** UTF-8 byte length, without depending on TextEncoder being present. */
function byteLength(s: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(s).length;
  }
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.codePointAt(i)!;
    if (c > 0xffff) i++; // surrogate pair, counted once
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return bytes;
}

const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(userId) ?? Promise.resolve();
  let release: () => void = () => {};
  const next = new Promise<void>((resolve) => { release = resolve; });
  locks.set(userId, previous.then(() => next));
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(userId) === next) locks.delete(userId);
  }
}

export async function readOfflineState(userId: string): Promise<OfflineState> {
  try {
    const raw = await AsyncStorage.getItem(stateKey(userId));
    if (!raw) return { ...EMPTY, pending: [], conflicts: [] };
    const parsed = JSON.parse(raw) as Partial<OfflineState>;
    return { pending: parsed.pending ?? [], conflicts: parsed.conflicts ?? [] };
  } catch {
    // Unreadable state is treated as empty rather than throwing: an app that
    // cannot start is worse than one that has lost a queue it could not read
    // anyway. The write path's size guard is what keeps this from happening.
    return { pending: [], conflicts: [] };
  }
}

/**
 * Reads, mutates, and writes the state under the user's lock.
 *
 * Every mutation goes through here. A caller that reads and writes separately
 * reintroduces the race this exists to prevent.
 */
export async function mutateOfflineState(
  userId: string,
  mutate: (state: OfflineState) => void
): Promise<void> {
  await withLock(userId, async () => {
    const state = await readOfflineState(userId);
    mutate(state);
    const serialised = JSON.stringify(state);
    // Bytes, not characters. String length undercounts anything outside ASCII —
    // an accented name, any non-Latin script — so a limit measured in
    // characters permits more than it claims, which is the wrong direction for
    // a safety boundary. TextEncoder is not guaranteed in every React Native
    // runtime, so fall back to a byte count computed directly.
    const bytes = byteLength(serialised);
    if (bytes > MAX_STATE_BYTES) {
      throw new OfflineStateTooLargeError(bytes);
    }
    await AsyncStorage.setItem(stateKey(userId), serialised);
  });
}
