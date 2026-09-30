// Live queries refreshed after a write -- the Flutter SDK's _refreshers and
// refreshCollectionStreams, mirrored. A query refreshes ITSELF: a key carries
// the collection and filters but not the ordering, limit or paging, so a
// refresh rebuilt from a key alone would be a different query.

const refreshers = new Map<string, () => Promise<void>>();
let next = 0;

/** Registers one live query's refresher; returns the unregister. */
export function registerQueryRefresher(collection: string, refresh: () => Promise<void>): () => void {
  const key = `${collection}:${++next}`;
  refreshers.set(key, refresh);
  return () => {
    refreshers.delete(key);
  };
}

/**
 * Re-runs every live query on a collection, after a write -- or every live
 * query when the collection is not known (a delete of a record never read on
 * this device). One after another; a failure in one never stops the others.
 */
export async function refreshCollectionQueries(collection?: string): Promise<void> {
  const prefix = collection === undefined ? null : `${collection}:`;
  const due = [...refreshers.entries()].filter(([k]) => prefix === null || k.startsWith(prefix)).map(([, f]) => f);
  for (const refresh of due) {
    try {
      await refresh();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[Koolbase] A live query failed to refresh after a write:', e);
    }
  }
}

/** Tests only. */
export function clearQueryRefreshers(): void {
  refreshers.clear();
}
