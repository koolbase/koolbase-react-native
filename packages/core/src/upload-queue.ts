// Several uploads in a queue, framework-free (storage S4).
//
// Files added together go a few at a time (three unless set), each its own
// SDK upload task -- so a large one still goes in parts, and a bucket's
// file lists still reload as each lands. Every file has its own state and
// progress, and can be cancelled or tried again on its own. No React here,
// so it is tested in this package; useUploadQueue in @koolbase/react-native
// and @koolbase/js/react is a thin wrapper. Mirrors the Flutter SDK's
// KoolbaseUploadQueue.
//
//  - queued -> uploading -> verifying -> done, or failed / cancelled
//  - a queued file cancelled never starts; one uploading stops (once the
//    server is verifying it, it lands or fails on its own)
//  - a failed or cancelled file can be tried again: it queues once more,
//    from the start, under the same path
//  - a file that fails never stops the others
//  - progress is the files' average, a cancelled one not counted

import { KoolbaseUploadCancelledError } from './storage-errors.js';
import type { KoolbaseUploadTask } from './storage-transfer.js';
import type { UploadOptions } from './types.js';

export type QueuedUploadStatus = 'queued' | 'uploading' | 'verifying' | 'done' | 'failed' | 'cancelled';

/** One file in the queue. */
export interface QueuedUpload {
  /** The queue's own id for it: what cancel and retry take. */
  readonly id: string;
  readonly bucket: string;
  /** Where it goes in the bucket. */
  readonly path: string;
  /** What a person calls it: the name given, else the path's last part. */
  readonly name: string;
  readonly status: QueuedUploadStatus;
  /** 0 to 1: the share of its bytes sent; 1 once verifying. */
  readonly progress: number;
  /** Why it failed, while status is 'failed'. */
  readonly error: unknown;
}

export interface UploadQueueState {
  readonly items: readonly QueuedUpload[];
  /** 0 to 1: the files' average progress, a cancelled one not counted. */
  readonly progress: number;
  /** Whether any file is still queued, uploading or verifying. */
  readonly running: boolean;
  /** How many have landed, and how many failed. */
  readonly done: number;
  readonly failed: number;
}

export const initialUploadQueueState: UploadQueueState = Object.freeze<UploadQueueState>({
  items: Object.freeze([]),
  progress: 0,
  running: false,
  done: 0,
  failed: 0,
});

/** A file to add: where it goes, and the bytes as startUpload takes them. */
export interface QueueFile {
  bucket: string;
  path: string;
  file: UploadOptions['file'];
  /** Shown for it; the path's last part unless set. */
  name?: string;
  overwrite?: boolean;
  metadata?: UploadOptions['metadata'];
}

// Only the task's public half: a structural type, so a storage built from
// the package's other module format (esm or cjs) still fits.
type QueueTask = Pick<KoolbaseUploadTask, 'onProgress' | 'cancel' | 'result'>;

/** What the queue needs from storage: startUpload. */
export type KoolbaseUploader = { startUpload(options: UploadOptions): QueueTask };

interface Entry {
  item: QueuedUpload;
  source: QueueFile;
  task: QueueTask | null;
  /** Each start's number: a task a retry replaced reports nothing. */
  run: number;
}

export class KoolbaseUploadQueue {
  readonly concurrency: number;
  private readonly storage: KoolbaseUploader;
  private entries: Entry[] = [];
  private state: UploadQueueState = initialUploadQueueState;
  private readonly listeners = new Set<() => void>();
  private idleWaiters: (() => void)[] = [];
  private nextId = 0;
  private disposed = false;

  constructor(storage: KoolbaseUploader, options: { concurrency?: number } = {}) {
    this.storage = storage;
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 3));
  }

  getState(): UploadQueueState {
    return this.state;
  }

  /** Called on every change. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Adds files to the end of the queue and starts as many as may run. Returns their ids. */
  add(files: readonly QueueFile[]): string[] {
    if (this.disposed) return [];
    const ids: string[] = [];
    for (const source of files) {
      const id = `u${++this.nextId}`;
      ids.push(id);
      this.entries.push({
        item: { id, bucket: source.bucket, path: source.path, name: source.name || source.path.split('/').pop() || source.path, status: 'queued', progress: 0, error: null },
        source,
        task: null,
        run: 0,
      });
    }
    this.pump();
    this.publish();
    return ids;
  }

  /** Stops one file: a queued one never starts; one uploading stops. Returns whether it was stopped. */
  cancel(id: string): boolean {
    const e = this.entries.find((x) => x.item.id === id);
    if (!e) return false;
    if (e.item.status === 'queued') {
      this.patch(e, { status: 'cancelled', progress: 0 });
      this.publish();
      return true;
    }
    if (e.item.status === 'uploading') return e.task?.cancel() ?? false;
    return false;
  }

  /** Stops every file that can still be stopped. */
  cancelAll(): void {
    for (const e of [...this.entries]) this.cancel(e.item.id);
  }

  /** Tries a failed or cancelled file again, from the start. Returns whether it was queued. */
  retry(id: string): boolean {
    const e = this.entries.find((x) => x.item.id === id);
    if (!e || (e.item.status !== 'failed' && e.item.status !== 'cancelled') || this.disposed) return false;
    e.task = null;
    this.patch(e, { status: 'queued', progress: 0, error: null });
    this.pump();
    this.publish();
    return true;
  }

  /** Removes the files that have finished: landed, failed or cancelled. */
  clearFinished(): void {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.item.status === 'queued' || e.item.status === 'uploading' || e.item.status === 'verifying');
    if (this.entries.length !== before) this.publish();
  }

  /** Resolves once nothing is queued, uploading or verifying. */
  whenIdle(): Promise<void> {
    if (!this.state.running) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Stops reporting. Uploads already running finish on their own. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  private active(): number {
    return this.entries.filter((e) => e.item.status === 'uploading' || e.item.status === 'verifying').length;
  }

  private pump(): void {
    if (this.disposed) return;
    let free = this.concurrency - this.active();
    for (const e of this.entries) {
      if (free <= 0) break;
      if (e.item.status !== 'queued') continue;
      free--;
      this.start(e);
    }
  }

  private start(e: Entry): void {
    const run = ++e.run;
    this.patch(e, { status: 'uploading', progress: 0, error: null });
    let task: QueueTask;
    try {
      task = this.storage.startUpload({ bucket: e.source.bucket, path: e.source.path, file: e.source.file, overwrite: e.source.overwrite, metadata: e.source.metadata });
    } catch (err) {
      this.finish(e, run, 'failed', err);
      return;
    }
    e.task = task;
    task.onProgress((p) => {
      if (e.run !== run || e.item.status === 'cancelled' || p.isDone) return;
      const status: QueuedUploadStatus = p.state === 'verifying' ? 'verifying' : 'uploading';
      if (status === e.item.status && p.fraction === e.item.progress) return;
      this.patch(e, { status, progress: p.fraction });
      this.publish();
    });
    task.result.then(
      () => this.finish(e, run, 'done', null),
      (err: unknown) => this.finish(e, run, err instanceof KoolbaseUploadCancelledError ? 'cancelled' : 'failed', err),
    );
  }

  private finish(e: Entry, run: number, status: 'done' | 'failed' | 'cancelled', err: unknown): void {
    if (e.run !== run) return;
    e.task = null;
    this.patch(e, { status, progress: status === 'done' ? 1 : status === 'cancelled' ? 0 : e.item.progress, error: status === 'failed' ? err : null });
    this.pump();
    this.publish();
  }

  private patch(e: Entry, change: Partial<QueuedUpload>): void {
    e.item = Object.freeze({ ...e.item, ...change });
  }

  private publish(): void {
    const items = Object.freeze(this.entries.map((e) => e.item));
    const counted = items.filter((i) => i.status !== 'cancelled');
    const running = items.some((i) => i.status === 'queued' || i.status === 'uploading' || i.status === 'verifying');
    this.state = Object.freeze({
      items,
      progress: counted.length ? counted.reduce((s, i) => s + i.progress, 0) / counted.length : 0,
      running,
      done: items.filter((i) => i.status === 'done').length,
      failed: items.filter((i) => i.status === 'failed').length,
    });
    if (!running && this.idleWaiters.length) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) w();
    }
    if (this.disposed) return;
    for (const l of [...this.listeners]) l();
  }
}
