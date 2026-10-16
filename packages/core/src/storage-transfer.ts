// An upload's lifecycle, as an app watches it (S1).
//
// pending -> uploading (bytes sent of total) -> verifying -> completed, or
// failed / cancelled. Verifying is its own phase: the bytes have arrived and
// the server is checking them (size, type, the bucket's rules and cap) and
// putting them in place. Only completed means the file can be referenced
// from a record.

import { KoolbaseNetworkError } from './network.js';
import { KoolbaseStorageError, KoolbaseUploadCancelledError } from './storage-errors.js';
import type { UploadResult } from './types.js';

/** Where an upload is. */
export type KoolbaseUploadState =
  /** Not started: asking the server for an upload link. */
  | 'pending'
  /** Sending the file's bytes; see `bytesSent`. */
  | 'uploading'
  /** The bytes have arrived; the server is checking them and putting the file in place. It can no longer be cancelled. */
  | 'verifying'
  /** Done: the file is in the bucket. */
  | 'completed'
  /** It failed; `error` says why. */
  | 'failed'
  /** Cancelled before the server began checking it. Nothing was stored. */
  | 'cancelled';

/** One moment of an upload. */
export interface KoolbaseUploadProgress {
  state: KoolbaseUploadState;
  /** Bytes sent so far. */
  bytesSent: number;
  bytesTotal: number;
  /** 0 to 1: the share of bytes sent; 1 once verifying. */
  fraction: number;
  /** Whether the upload has ended, one way or another. */
  isDone: boolean;
  /** Why it failed, when `state` is `'failed'`. */
  error?: Error;
}

function progressOf(state: KoolbaseUploadState, bytesSent: number, bytesTotal: number, error?: Error): KoolbaseUploadProgress {
  let fraction: number;
  if (state === 'verifying' || state === 'completed') fraction = 1;
  else if (bytesTotal <= 0) fraction = 0;
  else fraction = Math.min(1, Math.max(0, bytesSent / bytesTotal));
  return {
    state,
    bytesSent,
    bytesTotal,
    fraction,
    isDone: state === 'completed' || state === 'failed' || state === 'cancelled',
    ...(error ? { error } : {}),
  };
}

/** A running upload: watch it with `onProgress`, `cancel` it, await `result`. */
export class KoolbaseUploadTask {
  private _current: KoolbaseUploadProgress;
  private listeners = new Set<(p: KoolbaseUploadProgress) => void>();
  private cancelRequested = false;
  private abortTransfer: (() => void) | null = null;
  private total = 0;

  /**
   * The uploaded file. Rejects with `KoolbaseUploadCancelledError` if it was
   * cancelled, or the error that made it fail.
   */
  readonly result: Promise<UploadResult>;
  private resolve!: (r: UploadResult) => void;
  private reject!: (e: Error) => void;

  /** @internal */
  constructor() {
    this._current = progressOf('pending', 0, 0);
    this.result = new Promise<UploadResult>((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
    // An app that only listens to progress is not left with an unhandled
    // rejection; awaiting `result` still sees the error.
    this.result.catch(() => undefined);
  }

  /** Where the upload is now. */
  get current(): KoolbaseUploadProgress {
    return this._current;
  }

  /**
   * Calls `listener` on every change of state and every chunk sent, starting
   * with where the upload is now. Returns a function that stops it.
   */
  onProgress(listener: (p: KoolbaseUploadProgress) => void): () => void {
    this.listeners.add(listener);
    listener(this._current);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Stops the upload, if the server has not begun checking it yet. Returns
   * whether it was stopped: false once verifying (the file will land, or
   * fail on its own) or done.
   */
  cancel(): boolean {
    if (this._current.isDone || this._current.state === 'verifying') return false;
    this.cancelRequested = true;
    this.abortTransfer?.();
    return true;
  }

  /** @internal */
  get cancelled(): boolean {
    return this.cancelRequested;
  }

  /** @internal Throws if the upload was cancelled, between steps. */
  checkCancelled(): void {
    if (this.cancelRequested) throw new KoolbaseUploadCancelledError();
  }

  /** @internal */
  setTotal(total: number): void {
    this.total = total;
  }

  /** @internal */
  setAbort(abort: (() => void) | null): void {
    this.abortTransfer = abort;
  }

  /** @internal */
  emit(state: KoolbaseUploadState, sent?: number, error?: Error): void {
    if (this._current.isDone) return;
    this._current = progressOf(state, sent ?? this._current.bytesSent, this.total, error);
    for (const l of [...this.listeners]) {
      try {
        l(this._current);
      } catch {
        // A listener's own failure is not the upload's.
      }
    }
  }

  /** @internal Marks the bytes sent: from here the upload cannot be cancelled. */
  verifying(): void {
    this.checkCancelled();
    this.emit('verifying', this.total);
  }

  /** @internal */
  finish(result: UploadResult): void {
    this.emit('completed', this.total);
    this.listeners.clear();
    this.resolve(result);
  }

  /** @internal */
  fail(error: unknown): void {
    if (this.cancelRequested) {
      const e = new KoolbaseUploadCancelledError();
      this.emit('cancelled');
      this.reject(e);
    } else {
      const e =
        error instanceof Error ? error : new KoolbaseStorageError(String(error));
      this.emit('failed', undefined, e);
      this.reject(e);
    }
    this.listeners.clear();
  }
}

/** Runs `body` as the task's upload, starting on the next turn so a caller can listen to every event. */
export function runUploadTask(body: (task: KoolbaseUploadTask) => Promise<UploadResult>): KoolbaseUploadTask {
  const task = new KoolbaseUploadTask();
  Promise.resolve().then(async () => {
    try {
      task.finish(await body(task));
    } catch (e) {
      task.fail(e);
    }
  });
  return task;
}

interface PutResult {
  status: number;
  etag: string;
}

/**
 * Sends `body` to a presigned `url` with PUT, reporting bytes as they are
 * sent. XMLHttpRequest where the host has it (browsers and React Native,
 * both report upload progress); fetch elsewhere, where progress jumps from
 * 0 to the total. A cancel aborts it.
 */
export function putWithProgress(
  task: KoolbaseUploadTask,
  url: string,
  body: Blob,
  contentType: string,
): Promise<PutResult> {
  task.checkCancelled();
  const total = body.size;
  const report = (sent: number) => {
    if (!task.cancelled) task.emit('uploading', Math.min(sent, total));
  };
  report(0);

  const XHR = (globalThis as { XMLHttpRequest?: new () => XMLHttpRequest }).XMLHttpRequest;
  if (XHR) {
    return new Promise<PutResult>((resolve, reject) => {
      const xhr = new XHR();
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        task.setAbort(null);
        fn();
      };
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', contentType);
      if (xhr.upload) {
        xhr.upload.onprogress = (ev: ProgressEvent) => report(ev.loaded);
      }
      xhr.onload = () =>
        done(() => {
          if (task.cancelled) return reject(new KoolbaseUploadCancelledError());
          resolve({ status: xhr.status, etag: xhr.getResponseHeader('etag') ?? '' });
        });
      xhr.onerror = () => done(() => reject(task.cancelled ? new KoolbaseUploadCancelledError() : new KoolbaseNetworkError(url, new Error('the upload did not complete'))));
      xhr.onabort = () => done(() => reject(new KoolbaseUploadCancelledError()));
      task.setAbort(() => {
        xhr.abort();
        // Some hosts do not fire onabort for an aborted send.
        done(() => reject(new KoolbaseUploadCancelledError()));
      });
      xhr.send(body);
    });
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  task.setAbort(() => controller?.abort());
  return fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
    signal: controller?.signal,
  })
    .then((res) => {
      task.checkCancelled();
      return { status: res.status, etag: res.headers.get('etag') ?? '' };
    })
    .catch((e) => {
      if (task.cancelled || (e as { name?: string } | null)?.name === 'AbortError') {
        throw new KoolbaseUploadCancelledError();
      }
      if (e instanceof KoolbaseStorageError) throw e;
      throw new KoolbaseNetworkError(url, e);
    })
    .finally(() => task.setAbort(null));
}
