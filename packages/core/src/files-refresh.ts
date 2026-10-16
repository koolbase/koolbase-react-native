// File lists reloaded after a change made through this SDK (storage S4): an
// upload, a delete, a move or copy, a metadata change, a restore. Keyed by
// bucket; each list reloads ITSELF, with its own prefix and order.

const refreshers = new Map<string, () => Promise<void>>();
let next = 0;

/** Registers one file list's reload; returns the unregister. */
export function registerFilesRefresher(bucket: string, refresh: () => Promise<void>): () => void {
  const key = `${bucket}\u0000${++next}`;
  refreshers.set(key, refresh);
  return () => {
    refreshers.delete(key);
  };
}

/**
 * Reloads every file list on [buckets]. One after another; a failure in one
 * never stops the others, and never reaches the change that caused it.
 */
export async function refreshBucketFiles(...buckets: string[]): Promise<void> {
  const prefixes = buckets.map((b) => `${b}\u0000`);
  const due = [...refreshers.entries()].filter(([k]) => prefixes.some((p) => k.startsWith(p))).map(([, f]) => f);
  for (const refresh of due) {
    try {
      await refresh();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[Koolbase] A file list failed to reload after a change:', e);
    }
  }
}

/** Tests only. */
export function clearFilesRefreshers(): void {
  refreshers.clear();
}
