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
import { liveSource } from './live-source.js';
import { registerQueryRefresher } from './query-refresh.js';
import { KoolbaseError } from './errors.js';
import type { FieldSearch, KoolbaseRecord, QueryOptions, QueryResult } from './types.js';

export type CollectionStatus = 'loading' | 'loaded' | 'error';

/** What to read. Equality only: each `where` entry is field = literal value. */
export interface CollectionQuery {
  where?: Record<string, unknown>;
  orderBy?: string;
  orderDesc?: boolean;
  /** Page size; the server's default (20) when absent. */
  limit?: number;
  /**
   * Re-read page one, silently, when Koolbase realtime reports a record
   * created, updated or deleted in this collection (debounced: a burst is one
   * read). Signed out, only a collection anyone can read (read rule
   * "public") is live; any other behaves as a normal list until a user signs
   * in, and goes live then.
   */
  live?: boolean;
  /**
   * A search over the fields it names, on the server (#160): the first load
   * is of its matches. Not part of the query's identity -- change it with
   * setSearch(), which keeps the controller and what it shows.
   */
  search?: FieldSearch | null;
  /** How long setSearch() waits for the typing to pause. 250 ms. */
  searchDelayMs?: number;
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
  /**
   * True from setSearch() until the server answers it (#160). The records
   * shown meanwhile are from before the search: what an app filters from
   * them is a preview, not the answer.
   */
  readonly searching: boolean;
  /** Why the server could not answer the latest search, or null. The records are not its answer. */
  readonly searchError: unknown;
  /**
   * True while the search is not run on the server, so the records are the
   * list unsearched and an app filters them itself: the server refused this
   * list's search (a field_search it will not take -- the collection's
   * fields changed since the app was built; it is not asked again while
   * this controller lives), or the search is wider than the server takes
   * (a Choice matching more than 100 values, text over 100 characters).
   */
  readonly searchLoadedOnly: boolean;
}

export const initialCollectionState: CollectionState = Object.freeze<CollectionState>({
  status: 'loading',
  records: Object.freeze([]),
  error: null,
  isFromCache: false,
  refreshing: false,
  loadingMore: false,
  hasMore: true,
  searching: false,
  searchError: null,
  searchLoadedOnly: false,
});

/** A search with text to search, or null: none. */
function normalizedSearch(search?: FieldSearch | null): FieldSearch | null {
  if (!search || search.text.trim() === '') return null;
  return {
    text: search.text.trim(),
    fields: [...(search.fields ?? [])],
    choices: (search.choices ?? []).map((c) => ({ field: c.field, values: [...c.values], listed: [...c.listed] })),
  };
}

/** The server's limits on a search (#160): past them it refuses it. */
const SEARCH_MAX_TEXT = 100;
const SEARCH_MAX_VALUES = 100;

/** A search the server takes, by its size: text and each Choice's matching values. */
function withinServerLimits(search: FieldSearch): boolean {
  return Array.from(search.text).length <= SEARCH_MAX_TEXT && (search.choices ?? []).every((c) => c.values.length <= SEARCH_MAX_VALUES);
}

/** The server refusing a field_search (400): this search, as sent, will never be answered. */
function isSearchRefusal(error: unknown): boolean {
  return error instanceof KoolbaseError && error.message.startsWith('field_search:');
}

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
    // Only when live: every other query keeps the key it always had.
    ...(query.live === true ? ['live'] : []),
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
  // A write to this collection re-runs this query (query-refresh.ts).
  private unregister: (() => void) | null = null;
  // A live list's realtime subscription, and its pending debounced re-read.
  private unlive: (() => void) | null = null;
  private liveTimer: ReturnType<typeof setTimeout> | null = null;
  // The search now (#160), and its pending debounced read.
  private search: FieldSearch | null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  // The server refused this list's search: it is not asked again.
  private searchRefused = false;
  // The server search page one answers (JSON; 'null' unsearched), or
  // undefined before any answer: what may be shown without reading again.
  private answered: string | undefined;
  // The latest refresh(): only it ends `refreshing`.
  private refreshToken = 0;

  constructor(db: QueryReader, collection: string, query: CollectionQuery = {}) {
    this.db = db;
    this.collection = collection;
    this.spec = query;
    this.search = normalizedSearch(query.search);
    this.state = Object.freeze({ ...this.state, searchLoadedOnly: this.loadedOnly() });
  }

  /** The search the server runs: none when it is refused or too wide. */
  private serverSearch(): FieldSearch | null {
    return this.search && !this.searchRefused && withinServerLimits(this.search) ? this.search : null;
  }

  private loadedOnly(): boolean {
    return this.search !== null && this.serverSearch() === null;
  }

  /**
   * Search on the server (#160), once the typing pauses (searchDelayMs): page
   * one of the matches replaces what is shown, never merged with it, and
   * paging continues inside the search. A newer search, or a refresh, drops
   * an older one's answer. Null or empty text: the list unsearched again.
   * Until the server answers, `searching` is true; if it cannot,
   * `searchError` says why and the records shown are not its answer.
   */
  setSearch(search?: FieldSearch | null): void {
    if (this.disposed) return;
    const next = normalizedSearch(search);
    if (JSON.stringify(next) === JSON.stringify(this.search)) return;
    this.search = next;
    // What is shown already answers the server's search (both not sent, say):
    // nothing to read again, and nothing still waiting is wanted.
    if (this.answered !== undefined && JSON.stringify(this.serverSearch()) === this.answered && this.state.status === 'loaded') {
      if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null; }
      this.generation++;
      this.set({ searching: false, searchError: null, loadingMore: false, searchLoadedOnly: this.loadedOnly() });
      return;
    }
    // Whatever is in flight was for the old search.
    this.generation++;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.set({ searching: true, searchError: null, loadingMore: false, searchLoadedOnly: this.loadedOnly() });
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      void this.runSearch();
    }, this.spec.searchDelayMs ?? 250);
    (this.searchTimer as unknown as { unref?: () => void }).unref?.();
  }

  private async runSearch(): Promise<void> {
    if (this.disposed) return;
    const gen = ++this.generation;
    if (this.state.loadingMore) this.set({ loadingMore: false });
    const asking = JSON.stringify(this.serverSearch());
    try {
      const result = await this.db.query(this.collection, this.options(0, 'network-only'));
      if (this.isStale(gen)) return;
      this.answered = asking;
      this.showPageOne(result, false, false);
      this.set({ searching: false, searchError: null });
    } catch (error) {
      if (this.isStale(gen)) return;
      if (this.refuse(error)) return;
      // Nothing loaded yet to show under it: the list's own error.
      this.set(this.state.status === 'loaded'
        ? { searching: false, searchError: error }
        : { searching: false, searchError: error, status: 'error', error });
    }
  }

  /**
   * After the server refused the search: it is not sent again while this
   * controller lives, and the list is read unsearched for the app to filter.
   */
  private refuse(error: unknown): boolean {
    if (!isSearchRefusal(error) || this.serverSearch() === null) return false;
    this.searchRefused = true;
    this.set({ searching: true, searchError: null, searchLoadedOnly: true });
    void this.runSearch();
    return true;
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
    this.unregister ??= registerQueryRefresher(this.collection, () => this.refreshAfterWrite());
    if (this.spec.live === true) {
      this.unlive ??= liveSource()?.subscribe(this.collection, () => this.scheduleLiveRefresh()) ?? null;
    }
    await this.firstPage('default');
  }

  /** Page one again, from the server. What is shown stays while it runs, and stays if it fails. */
  async refresh(): Promise<void> {
    if (this.disposed) return;
    const token = ++this.refreshToken;
    this.set({ refreshing: true });
    await this.firstPage('network-only');
    // Ended by the latest refresh, whatever superseded its read.
    if (token === this.refreshToken) this.set({ refreshing: false });
  }

  /**
   * After a write to this collection: page one again from the server,
   * SILENTLY -- no `refreshing`, which is the user's pull-to-refresh. What is
   * shown stays while it runs, and stays if it fails.
   */
  private async refreshAfterWrite(): Promise<void> {
    if (this.disposed) return;
    await this.firstPage('network-only');
  }

  /**
   * A change someone made, reported by realtime: page one again, silently, as
   * after a write -- once per burst (250 ms), not once per event.
   */
  private scheduleLiveRefresh(): void {
    if (this.disposed || this.liveTimer) return;
    this.liveTimer = setTimeout(() => {
      this.liveTimer = null;
      void this.refreshAfterWrite();
    }, 250);
    // A pending re-read must not be what keeps a Node process alive.
    (this.liveTimer as unknown as { unref?: () => void }).unref?.();
  }

  /**
   * The next page, appended. Does nothing unless loaded with more to load.
   * If rows are added or removed on the server between pages, one can be
   * skipped until refresh(); none is ever shown twice.
   */
  async loadMore(): Promise<void> {
    const s = this.state;
    // Not while a search waits for its answer (#160): the next page of the
    // records shown is not the next page of the search.
    if (this.disposed || s.loadingMore || s.searching || !s.hasMore || s.status !== 'loaded') return;
    const gen = this.generation;
    const offset = this.nextOffset;
    this.set({ loadingMore: true });
    try {
      const result = await this.db.query(this.collection, this.options(offset, this.serverSearch() ? 'network-only' : 'default'));
      if (this.isStale(gen)) return;
      this.laterPages = [...this.laterPages, ...result.records];
      this.nextOffset = offset + result.records.length;
      // An empty page is the end, whatever total says: rows were removed.
      const total = result.records.length === 0 ? this.nextOffset : result.total;
      this.publish({}, total);
    } catch (error) {
      // Refused (the schema changed since): the list unsearched. Otherwise
      // keep what is shown; the caller can try again.
      if (!this.isStale(gen)) this.refuse(error);
    } finally {
      if (!this.isStale(gen)) this.set({ loadingMore: false });
    }
  }

  /** Stops all updates. Results still in flight are dropped when they land. */
  dispose(): void {
    this.disposed = true;
    this.unregister?.();
    this.unregister = null;
    this.unlive?.();
    this.unlive = null;
    if (this.liveTimer) { clearTimeout(this.liveTimer); this.liveTimer = null; }
    if (this.searchTimer) { clearTimeout(this.searchTimer); this.searchTimer = null; }
    this.listeners.clear();
  }

  private async firstPage(cache: 'default' | 'network-only'): Promise<number> {
    const gen = ++this.generation;
    // A loadMore still in flight now belongs to an older generation and
    // will not clear its own flag.
    if (this.state.loadingMore) this.set({ loadingMore: false });
    const asking = JSON.stringify(this.serverSearch());
    try {
      const result = await this.db.query(
        this.collection,
        // A search's answer is the server's, never a cached one (#160).
        this.options(0, this.serverSearch() ? 'network-only' : cache, (fresh) => {
          if (!this.isStale(gen)) { this.answered = asking; this.showPageOne(fresh, false, true); }
        }),
      );
      if (!this.isStale(gen)) {
        this.answered = asking;
        this.showPageOne(result, result.isFromCache === true, false);
        // A search this fetch superseded is answered by it -- unless a newer
        // one is still waiting for the typing to pause.
        if (!this.searchTimer && (this.state.searching || this.state.searchError !== null)) {
          this.set({ searching: false, searchError: null });
        }
      }
    } catch (error) {
      // The server refused the search: read unsearched, at once -- the
      // generation this returns is that read's, so refresh() ends with it.
      if (!this.isStale(gen) && isSearchRefusal(error) && this.serverSearch() !== null) {
        this.searchRefused = true;
        this.set({ searchError: null, searchLoadedOnly: true });
        return this.firstPage(cache);
      }
      if (!this.isStale(gen) && this.state.searching && !this.searchTimer) {
        this.set({ searching: false, searchError: error });
      }
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
      ...(this.serverSearch() ? { fieldSearch: this.serverSearch()! } : {}),
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
