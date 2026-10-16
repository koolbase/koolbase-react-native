// A bucket's files read as a list, framework-free (storage S4).
//
// The data half of a file gallery: loading, loaded or error, refresh, and
// the next page by cursor. No React here, so it is tested in this package;
// useFiles in @koolbase/react-native and @koolbase/js/react is a thin
// wrapper. Mirrors the Flutter SDK's KoolbaseFilesController.
//
//  - only a first load with nothing to show is the error state; a failed
//    refresh or loadMore keeps what is shown (stale beats blank)
//  - loadMore appends the next page while there is one; a file already
//    shown is never shown twice (matched by path)
//  - an upload, delete, move, copy, metadata change or restore made through
//    this SDK in the bucket reloads page one silently (files-refresh.ts)
//  - every fetch belongs to a generation: a result from a fetch a later
//    refresh superseded, or one landing after dispose(), is dropped

import { registerFilesRefresher } from './files-refresh.js';
import type { KoolbaseFileInfo, KoolbaseFilePage, KoolbaseFileSort, ListFilesOptions } from './storage-files.js';

export type FilesStatus = 'loading' | 'loaded' | 'error';

/** Which files, in what order. The bucket's view rule decides the rest. */
export interface FilesQuery {
  /** Only files whose path starts with this, taken literally. */
  prefix?: string;
  /** By path unless set. */
  sort?: KoolbaseFileSort;
  /** Z to A, newest first, largest first. */
  descending?: boolean;
  /** Files per page: 50 unless set, at most 100. */
  limit?: number;
}

export interface FilesState {
  readonly status: FilesStatus;
  readonly files: readonly KoolbaseFileInfo[];
  /** Why the first load failed, while status is 'error'. */
  readonly error: unknown;
  /** True while refresh() runs. */
  readonly refreshing: boolean;
  /** True while loadMore() runs. */
  readonly loadingMore: boolean;
  /** Whether there is a page past the last one loaded. True before the first load. */
  readonly hasMore: boolean;
}

export const initialFilesState: FilesState = Object.freeze<FilesState>({
  status: 'loading',
  files: Object.freeze([]),
  error: null,
  refreshing: false,
  loadingMore: false,
  hasMore: true,
});

/** One string per distinct listing. */
export function filesQueryKey(bucket: string, query: FilesQuery = {}): string {
  return JSON.stringify([bucket, query.prefix ?? '', query.sort ?? 'path', query.descending === true, query.limit ?? null]);
}

/** Page one, then the later pages without any file already shown. */
function mergeByPath(first: readonly KoolbaseFileInfo[], rest: readonly KoolbaseFileInfo[]): KoolbaseFileInfo[] {
  const seen = new Set(first.map((f) => f.path));
  const out = [...first];
  for (const f of rest) {
    if (seen.has(f.path)) continue;
    seen.add(f.path);
    out.push(f);
  }
  return out;
}

type FilesReader = { listFiles(options: ListFilesOptions): Promise<KoolbaseFilePage> };

export class KoolbaseFilesController {
  readonly bucket: string;
  private readonly storage: FilesReader;
  private readonly spec: FilesQuery;
  private state: FilesState = initialFilesState;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private disposed = false;
  private pageOne: readonly KoolbaseFileInfo[] = [];
  private laterPages: readonly KoolbaseFileInfo[] = [];
  private cursor: string | null = null;
  private unregister: (() => void) | null = null;

  constructor(storage: FilesReader, bucket: string, query: FilesQuery = {}) {
    this.storage = storage;
    this.bucket = bucket;
    this.spec = query;
  }

  getState(): FilesState {
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
    this.unregister ??= registerFilesRefresher(this.bucket, () => this.firstPage());
    await this.firstPage();
  }

  /** Page one again. What is shown stays while it runs, and stays if it fails. */
  async refresh(): Promise<void> {
    if (this.disposed) return;
    this.set({ refreshing: true });
    await this.firstPage();
  }

  /** The next page, appended. Does nothing unless loaded with a page to come. */
  async loadMore(): Promise<void> {
    const s = this.state;
    if (this.disposed || s.loadingMore || !s.hasMore || s.status !== 'loaded' || this.cursor === null) return;
    const gen = this.generation;
    this.set({ loadingMore: true });
    try {
      const page = await this.storage.listFiles(this.options(this.cursor));
      if (this.isStale(gen)) return;
      this.laterPages = [...this.laterPages, ...page.files];
      this.cursor = page.nextCursor;
      this.publish({});
    } catch {
      // Keep what is shown; the caller can try again.
    } finally {
      if (!this.isStale(gen)) this.set({ loadingMore: false });
    }
  }

  /** Stops all updates. Results still in flight are dropped when they land. */
  dispose(): void {
    this.disposed = true;
    this.unregister?.();
    this.unregister = null;
    this.listeners.clear();
  }

  private async firstPage(): Promise<void> {
    const gen = ++this.generation;
    if (this.state.loadingMore) this.set({ loadingMore: false });
    try {
      const page = await this.storage.listFiles(this.options(undefined));
      if (!this.isStale(gen)) {
        this.pageOne = page.files;
        this.laterPages = [];
        this.cursor = page.nextCursor;
        this.publish({ status: 'loaded', error: null, refreshing: false });
      }
    } catch (error) {
      // Only a first load with nothing to show is the error state. Whichever
      // fetch is newest ends a refresh, a silent one included.
      if (!this.isStale(gen)) {
        this.set(this.state.files.length === 0 ? { status: 'error', error, refreshing: false } : { refreshing: false });
      }
    }
  }

  private publish(patch: Partial<FilesState>): void {
    this.set({ ...patch, files: mergeByPath(this.pageOne, this.laterPages), hasMore: this.cursor !== null });
  }

  private options(cursor: string | undefined): ListFilesOptions {
    return {
      bucket: this.bucket,
      ...(this.spec.prefix ? { prefix: this.spec.prefix } : {}),
      ...(this.spec.limit != null ? { limit: this.spec.limit } : {}),
      ...(this.spec.sort ? { sort: this.spec.sort } : {}),
      ...(this.spec.descending ? { descending: true } : {}),
      ...(cursor ? { cursor } : {}),
    };
  }

  private isStale(gen: number): boolean {
    return this.disposed || gen !== this.generation;
  }

  private set(patch: Partial<FilesState>): void {
    if (this.disposed) return;
    this.state = Object.freeze({ ...this.state, ...patch });
    for (const listener of [...this.listeners]) listener();
  }
}
