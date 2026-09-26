// A collection read as a list, framework-free.
//
// The data half of a list screen: loading, loaded or error, refresh, and
// paging. No React here, so it is tested in this package and any host can
// drive it; @koolbase/react-native's useCollection is a thin wrapper.
//
// Mirrors the Flutter SDK's KoolbaseCollectionController:
//  - the first load is cache-first, and when the cache answered, the
//    server's answer replaces it as soon as it lands (query's onRefresh)
//  - only a first load with nothing to show is the error state; a failed
//    refresh or loadMore keeps what is shown (stale beats blank)
//  - loadMore appends the next page while there is more
// Deliberate differences:
//  - refresh() waits for the server (network-only), so `refreshing` ends
//    when fresh records are in, not when the cache answered
//  - a background refresh replaces page one only; pages loadMore appended
//    after it stay, merged by record id so no row is shown twice
//  - every fetch belongs to a generation: a result from a fetch a later
//    refresh superseded, or one landing after dispose(), is dropped
//
// Known limit: if rows are added or removed on the server between pages,
// the pages shift and a row can be skipped until refresh(), which reloads
// from page one. Duplicates are removed; a skipped row cannot be detected.

import type { KoolbaseDatabase } from './database.js';
import type { KoolbaseRecord, QueryOptions, QueryResult } from './types.js';

export type CollectionStatus = 'loading' | 'loaded' | 'error';

/** What to read. Equality only: each `where` entry is field = literal value. */
export interface CollectionQuery {
  where?: Record<string, unknown>;
  orderBy?: string;
  orderDesc?: boolean;
  /** Page size; the server's default (20) when absent. */
  limit?: number;
}

export interface CollectionState {
  readonly status: CollectionStatus;
  readonly records: readonly KoolbaseRecord[];
  /** Why the first load failed, while status is 'error'. */
  readonly error: unknown;
  /** True while the records shown came from cache and the server has not answered yet. */
  readonly isFromCache: boolean;
  /** True while refresh() runs. */
  readonly refreshing: boolean;
  /** True while loadMore() runs. */
  readonly loadingMore: boolean;
  /** Whether the server has rows past the last page loaded. True before the first load. */
  readonly hasMore: boolean;
}

export const initialCollectionState: CollectionState = Object.freeze<CollectionState>({
  status: 'loading',
  records: Object.freeze([]),
  error: null,
  isFromCache: false,
  refreshing: false,
  loadingMore: false,
  hasMore: true,
});

function sortedWhere(where?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(where ?? {}).sort()) out[key] = (where as Record<string, unknown>)[key];
  return out;
}

/** One string per distinct query, whatever the order of its `where` keys. */
export function collectionQueryKey(collection: string, query: CollectionQuery = {}): string {
  return JSON.stringify([
    collection,
    sortedWhere(query.where),
    query.orderBy ?? null,
    query.orderDesc === true,
    query.limit ?? null,
  ]);
}

/** Page one, then the later pages without any record already shown. */
function mergeById(first: readonly KoolbaseRecord[], rest: readonly KoolbaseRecord[]): KoolbaseRecord[] {
  const seen = new Set(first.map((r) => r.id));
  const out = [...first];
  for (const record of rest) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    out.push(record);
  }
  return out;
}

type QueryReader = Pick<KoolbaseDatabase, 'query'>;

export class KoolbaseCollectionController {
  readonly collection: string;
  private readonly db: QueryReader;
  private readonly spec: CollectionQuery;
  private state: CollectionState = initialCollectionState;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private disposed = false;
  private pageOne: readonly KoolbaseRecord[] = [];
  private laterPages: readonly KoolbaseRecord[] = [];
  // Where the next page starts on the server. Not records.length: once rows
  // are de-duplicated, a shifted page could otherwise be requested forever.
  private nextOffset = 0;

  constructor(db: QueryReader, collection: string, query: CollectionQuery = {}) {
    this.db = db;
    this.collection = collection;
    this.spec = query;
  }

  getState(): CollectionState {
    return this.state;
  }

  /** Called on every change. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The first load. Call once; refresh() for later loads. */
  async load(): Promise<void> {
    if (this.disposed) return;
    await this.firstPage('default');
  }

  /** Page one again, from the server. What is shown stays while it runs, and stays if it fails. */
  async refresh(): Promise<void> {
    if (this.disposed) return;
    this.set({ refreshing: true });
    const gen = await this.firstPage('network-only');
    if (!this.isStale(gen)) this.set({ refreshing: false });
  }

  /**
   * The next page, appended. Does nothing unless loaded with more to load.
   * If rows are added or removed on the server between pages, one can be
   * skipped until refresh(); none is ever shown twice.
   */
  async loadMore(): Promise<void> {
    const s = this.state;
    if (this.disposed || s.loadingMore || !s.hasMore || s.status !== 'loaded') return;
    const gen = this.generation;
    const offset = this.nextOffset;
    this.set({ loadingMore: true });
    try {
      const result = await this.db.query(this.collection, this.options(offset, 'default'));
      if (this.isStale(gen)) return;
      this.laterPages = [...this.laterPages, ...result.records];
      this.nextOffset = offset + result.records.length;
      // An empty page is the end, whatever total says: rows were removed.
      const total = result.records.length === 0 ? this.nextOffset : result.total;
      this.publish({}, total);
    } catch {
      // Keep what is shown; the caller can try again.
    } finally {
      if (!this.isStale(gen)) this.set({ loadingMore: false });
    }
  }

  /** Stops all updates. Results still in flight are dropped when they land. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  private async firstPage(cache: 'default' | 'network-only'): Promise<number> {
    const gen = ++this.generation;
    // A loadMore still in flight now belongs to an older generation and
    // will not clear its own flag.
    if (this.state.loadingMore) this.set({ loadingMore: false });
    try {
      const result = await this.db.query(
        this.collection,
        this.options(0, cache, (fresh) => {
          if (!this.isStale(gen)) this.showPageOne(fresh, false, true);
        }),
      );
      if (!this.isStale(gen)) this.showPageOne(result, result.isFromCache === true, false);
    } catch (error) {
      if (!this.isStale(gen) && this.state.records.length === 0) {
        this.set({ status: 'error', error });
      }
    }
    return gen;
  }

  private showPageOne(result: QueryResult, isFromCache: boolean, keepLaterPages: boolean): void {
    this.pageOne = result.records;
    if (keepLaterPages && this.laterPages.length > 0) {
      this.nextOffset = Math.max(this.nextOffset, result.records.length);
    } else {
      this.laterPages = [];
      this.nextOffset = result.records.length;
    }
    this.publish({ status: 'loaded', error: null, isFromCache }, result.total);
  }

  private publish(patch: Partial<CollectionState>, total: number): void {
    this.set({
      ...patch,
      records: mergeById(this.pageOne, this.laterPages),
      hasMore: this.nextOffset < total,
    });
  }

  // Key order does not matter: the SDK's cache key sorts keys (hashQuery).
  private options(
    offset: number,
    cache: 'default' | 'network-only',
    onRefresh?: (result: QueryResult) => void,
  ): QueryOptions {
    return {
      filters: this.spec.where ?? {},
      limit: this.spec.limit,
      offset,
      orderBy: this.spec.orderBy,
      orderDesc: this.spec.orderDesc,
      cache,
      onRefresh,
    };
  }

  private isStale(gen: number): boolean {
    return this.disposed || gen !== this.generation;
  }

  private set(patch: Partial<CollectionState>): void {
    if (this.disposed) return;
    this.state = Object.freeze({ ...this.state, ...patch });
    for (const listener of [...this.listeners]) listener();
  }
}
