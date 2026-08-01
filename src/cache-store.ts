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
