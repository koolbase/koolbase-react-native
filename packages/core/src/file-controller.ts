// One file's details, by path, framework-free (storage S4).
//
// The data half of a file detail screen: loading, loaded, not found or
// error, and refresh. No React here, so it is tested in this package; useFile
// in @koolbase/react-native and @koolbase/js/react is a thin wrapper.
// Mirrors the Flutter SDK's KoolbaseFileController, with the record view's
// rules:
//
//  - an empty path is not found, with no request
//  - not found is not an error: the API answers a file you may not view as
//    not found too, so a detail screen says "not available"
//  - stale beats blank: a failed refresh keeps the file shown
//  - a change made through this SDK in the bucket (an upload, a delete, a
//    move, a metadata change, a restore) reads it again silently: deleted or
//    moved away, the file is not found; replaced, it shows its new size
//  - a result a later load superseded, or one landing after dispose(), is
//    dropped

import { registerFilesRefresher } from './files-refresh.js';
import { KoolbaseStorageNotFoundError } from './storage-errors.js';
import type { KoolbaseFileInfo } from './storage-files.js';

export type FileStatus = 'loading' | 'loaded' | 'notFound' | 'error';

export interface FileState {
  readonly status: FileStatus;
  /** The file's details, while status is 'loaded'. */
  readonly file: KoolbaseFileInfo | null;
  /** Why the first load failed, while status is 'error'. */
  readonly error: unknown;
  /** True while refresh() runs. */
  readonly refreshing: boolean;
}

export const initialFileState: FileState = Object.freeze<FileState>({
  status: 'loading',
  file: null,
  error: null,
  refreshing: false,
});

type FileReader = { getFileInfo(bucket: string, path: string): Promise<KoolbaseFileInfo> };

/** Whether [e] says there is no such file (or none this caller may view). */
function isNotFound(e: unknown): boolean {
  return e instanceof KoolbaseStorageNotFoundError || (e as { code?: unknown } | null)?.code === 'not_found';
}

export class KoolbaseFileController {
  readonly bucket: string;
  readonly path: string;
  private readonly storage: FileReader;
  private state: FileState = initialFileState;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private disposed = false;
  private unregister: (() => void) | null = null;

  constructor(storage: FileReader, bucket: string, path: string) {
    this.storage = storage;
    this.bucket = bucket;
    this.path = path;
  }

  getState(): FileState {
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
    if (this.path) this.unregister ??= registerFilesRefresher(this.bucket, () => this.run());
    await this.run();
  }

  /** Read it again. The file stays shown while it runs, and stays if it fails. */
  async refresh(): Promise<void> {
    if (this.disposed) return;
    this.set({ refreshing: true });
    await this.run();
  }

  /** Stops all updates. Results still in flight are dropped when they land. */
  dispose(): void {
    this.disposed = true;
    this.unregister?.();
    this.unregister = null;
    this.listeners.clear();
  }

  private async run(): Promise<void> {
    if (this.disposed) return;
    const gen = ++this.generation;
    if (!this.path) {
      this.set({ status: 'notFound', file: null, error: null, refreshing: false });
      return;
    }
    try {
      const file = await this.storage.getFileInfo(this.bucket, this.path);
      if (this.isStale(gen)) return;
      this.set({ status: 'loaded', file, error: null, refreshing: false });
    } catch (e) {
      if (this.isStale(gen)) return;
      if (isNotFound(e)) this.set({ status: 'notFound', file: null, error: null, refreshing: false });
      // Only a first load with nothing to show is the error state.
      else if (this.state.file === null) this.set({ status: 'error', file: null, error: e, refreshing: false });
      else this.set({ refreshing: false });
    }
  }

  private isStale(gen: number): boolean {
    return this.disposed || gen !== this.generation;
  }

  private set(change: Partial<FileState>): void {
    if (this.disposed) return;
    this.state = Object.freeze({ ...this.state, ...change });
    for (const l of [...this.listeners]) l();
  }
}
