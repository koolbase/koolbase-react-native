import AsyncStorage from '@react-native-async-storage/async-storage';
import { KoolbaseRecord, PendingWrite, QueryResult } from './types';

const CACHE_VERSION = 'v1';

function cacheKey(userId: string, collection: string, queryHash: string): string {
  return `koolbase:${CACHE_VERSION}:${userId}:${collection}:${queryHash}`;
}

function writeQueueKey(userId: string): string {
  return `koolbase:${CACHE_VERSION}:${userId}:write_queue`;
}

export function hashQuery(collection: string, options: Record<string, unknown>): string {
  return `${collection}:${JSON.stringify(options)}`;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

export async function getCached(
  userId: string,
  collection: string,
  queryHash: string
): Promise<QueryResult | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(userId, collection, queryHash));
    if (!raw) return null;
    return JSON.parse(raw) as QueryResult;
  } catch {
    return null;
  }
}

export async function setCached(
  userId: string,
  collection: string,
  queryHash: string,
  result: QueryResult
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      cacheKey(userId, collection, queryHash),
      JSON.stringify(result)
    );
  } catch {
    // ignore storage errors
  }
}

export async function invalidateCache(
  userId: string,
  collection: string
): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const prefix = `koolbase:${CACHE_VERSION}:${userId}:${collection}:`;
    const toDelete = keys.filter(k => k.startsWith(prefix));
    for (const key of toDelete) {
      await AsyncStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

/**
 * Drops everything cached for a user.
 *
 * Deliberately spares the write queue. The prefix covers every key for this
 * user, and the queue lives under one of them — so clearing the cache used to
 * delete offline writes the user believes are saved, silently and
 * irrecoverably. A cache is what can be refetched; queued writes are not that.
 */
export async function clearUserCache(userId: string): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const prefix = `koolbase:${CACHE_VERSION}:${userId}:`;
    const queueKey = writeQueueKey(userId);
    const toDelete = keys.filter(k => k.startsWith(prefix) && k !== queueKey);
    for (const key of toDelete) {
      await AsyncStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

// ─── Records ────────────────────────────────────────────────────────────────

/**
 * A record as the SDK last saw it, with the revision it was read at.
 *
 * Separate from the query cache, which answers "what did this query return".
 * This answers "what is the latest copy of this record" — and an offline
 * mutation composes against the second. Scanning query blobs for one would mean
 * the same record appearing in several snapshots at different revisions, with no
 * principled way to choose.
 *
 * Keyed with `record` where a collection name would sit, so invalidateCache —
 * which scopes to a collection and runs after every write — cannot reach these.
 * A user's own edit must not remove the baseline they need for the next one.
 */
export interface CachedRecord {
  collection: string;
  data: Record<string, unknown>;
  revision?: number;
  cachedAt: string;
}

function recordCacheKey(userId: string, recordId: string): string {
  return `koolbase:${CACHE_VERSION}:${userId}:record:${recordId}`;
}

export async function getCachedRecord(
  userId: string,
  recordId: string
): Promise<CachedRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(recordCacheKey(userId, recordId));
    return raw ? (JSON.parse(raw) as CachedRecord) : null;
  } catch {
    return null;
  }
}

/**
 * Stores a record, refusing to move it backwards.
 *
 * Query responses can arrive out of order — a slow request from an earlier
 * screen resolving after a fresh one — and an older copy overwriting a newer
 * would compose the next mutation against a stale revision, producing a conflict
 * the user never caused. False conflicts teach people to force-overwrite, which
 * is worse than none.
 */
export async function cacheRecord(
  userId: string,
  collection: string,
  recordId: string,
  data: Record<string, unknown>,
  revision?: number
): Promise<void> {
  try {
    const existing = await getCachedRecord(userId, recordId);
    if (
      existing?.revision !== undefined &&
      revision !== undefined &&
      revision < existing.revision
    ) {
      return;
    }
    const entry: CachedRecord = {
      collection,
      data,
      revision,
      cachedAt: new Date().toISOString(),
    };
    await AsyncStorage.setItem(recordCacheKey(userId, recordId), JSON.stringify(entry));
  } catch {
    // ignore
  }
}

export async function removeCachedRecord(userId: string, recordId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(recordCacheKey(userId, recordId));
  } catch {
    // ignore
  }
}

// ─── Write Queue ────────────────────────────────────────────────────────────

export async function getWriteQueue(userId: string): Promise<PendingWrite[]> {
  try {
    const raw = await AsyncStorage.getItem(writeQueueKey(userId));
    if (!raw) return [];
    return JSON.parse(raw) as PendingWrite[];
  } catch {
    return [];
  }
}

export async function addToWriteQueue(
  userId: string,
  write: Omit<PendingWrite, 'retries' | 'createdAt'>
): Promise<void> {
  try {
    const queue = await getWriteQueue(userId);
    queue.push({ ...write, retries: 0, createdAt: new Date().toISOString() });
    await AsyncStorage.setItem(writeQueueKey(userId), JSON.stringify(queue));
  } catch {
    // ignore
  }
}

export async function removeFromWriteQueue(
  userId: string,
  writeId: string
): Promise<void> {
  try {
    const queue = await getWriteQueue(userId);
    const updated = queue.filter(w => w.id !== writeId);
    await AsyncStorage.setItem(writeQueueKey(userId), JSON.stringify(updated));
  } catch {
    // ignore
  }
}

export async function incrementWriteRetry(
  userId: string,
  writeId: string
): Promise<void> {
  try {
    const queue = await getWriteQueue(userId);
    const updated = queue.map(w =>
      w.id === writeId ? { ...w, retries: w.retries + 1 } : w
    );
    // Drop writes that have exceeded 3 retries
    const filtered = updated.filter(w => w.retries <= 3);
    await AsyncStorage.setItem(writeQueueKey(userId), JSON.stringify(filtered));
  } catch {
    // ignore
  }
}

// ─── Optimistic cache update ─────────────────────────────────────────────────

export async function optimisticallyInsert(
  userId: string,
  collection: string,
  record: KoolbaseRecord
): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const prefix = `koolbase:${CACHE_VERSION}:${userId}:${collection}:`;
    const collectionKeys = keys.filter(k => k.startsWith(prefix));

    for (const key of collectionKeys) {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) continue;
      const cached: QueryResult = JSON.parse(raw);
      cached.records = [record, ...cached.records];
      cached.total = cached.total + 1;
      await AsyncStorage.setItem(key, JSON.stringify(cached));
    }
  } catch {
    // ignore
  }
}
