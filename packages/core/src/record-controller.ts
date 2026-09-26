// One record, read by id, framework-free: the detail-screen counterpart of
// KoolbaseCollectionController. @koolbase/react-native's useRecord wraps it.
//
//  - loading, loaded, notFound or error. notFound is its own state because
//    the API answers a denied read as "not found" too (it does not reveal
//    whether a record exists): a detail screen says "not available", not
//    "something went wrong".
//  - an empty id is notFound with no request: a screen opened without one.
//  - a record from a different collection is notFound: the API names each
//    record's collection, and a mistyped or crafted id must not put another
//    collection's record on this screen.
//  - refresh() keeps the record shown while it runs, and if it fails.
//  - every fetch has a generation: a result superseded by a later refresh,
//    or landing after dispose(), is dropped.
// Not yet: an offline fallback from the record cache, which keeps data and
// revision but not createdAt or createdBy.

import type { KoolbaseDatabase } from './database.js';
import { KoolbaseNotFoundError } from './database-errors.js';
import type { KoolbaseRecord } from './types.js';

export type RecordStatus = 'loading' | 'loaded' | 'notFound' | 'error';

export interface RecordState {
  readonly status: RecordStatus;
  readonly record: KoolbaseRecord | null;
  /** Why the first load failed, while status is 'error'. */
  readonly error: unknown;
  /** True while refresh() runs. */
  readonly refreshing: boolean;
}

export const initialRecordState: RecordState = Object.freeze<RecordState>({
  status: 'loading',
  record: null,
  error: null,
  refreshing: false,
});

type RecordReader = Pick<KoolbaseDatabase, 'get'>;

export class KoolbaseRecordController {
  readonly collection: string;
  readonly id: string;
  private readonly db: RecordReader;
  private state: RecordState = initialRecordState;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private disposed = false;

  constructor(db: RecordReader, collection: string, id: string) {
    this.db = db;
    this.collection = collection;
    this.id = id;
  }

  getState(): RecordState {
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
    await this.fetch();
  }

  /** The record again, from the server. What is shown stays while it runs, and stays if it fails. */
  async refresh(): Promise<void> {
    if (this.disposed) return;
    this.set({ refreshing: true });
    const gen = await this.fetch();
    if (!this.isStale(gen)) this.set({ refreshing: false });
  }

  /** Stops all updates. A result still in flight is dropped when it lands. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  private async fetch(): Promise<number> {
    const gen = ++this.generation;
    if (!this.id) {
      this.set({ status: 'notFound', record: null, error: null });
      return gen;
    }
    try {
      const record = await this.db.get(this.id);
      if (this.isStale(gen)) return gen;
      if (record.collection !== undefined && record.collection !== this.collection) {
        this.set({ status: 'notFound', record: null, error: null });
      } else {
        this.set({ status: 'loaded', record, error: null });
      }
    } catch (error) {
      if (this.isStale(gen)) return gen;
      if (error instanceof KoolbaseNotFoundError) {
        this.set({ status: 'notFound', record: null, error: null });
      } else if (this.state.record === null) {
        this.set({ status: 'error', error });
      }
      // Otherwise keep the record shown: stale beats blank.
    }
    return gen;
  }

  private isStale(gen: number): boolean {
    return this.disposed || gen !== this.generation;
  }

  private set(patch: Partial<RecordState>): void {
    if (this.disposed) return;
    this.state = Object.freeze({ ...this.state, ...patch });
    for (const listener of [...this.listeners]) listener();
  }
}
