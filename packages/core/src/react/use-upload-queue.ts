// useUploadQueue: several uploads as React state (storage S4).
//
// A thin wrapper. Everything about the queue lives in @koolbase/core's
// KoolbaseUploadQueue, which is tested there; this file only gives a
// component one queue for its lifetime. Uploads still running when the
// component goes finish on their own.

import { useCallback, useRef, useSyncExternalStore } from 'react';
import { KoolbaseUploadQueue, type KoolbaseUploader, type QueueFile, type UploadQueueState } from '../index.js';

export interface UseUploadQueueResult extends UploadQueueState {
  /** Adds files and starts as many as may run; returns their ids. */
  add: (files: readonly QueueFile[]) => string[];
  /** Stops one file. */
  cancel: (id: string) => boolean;
  /** Stops every file that can still be stopped. */
  cancelAll: () => void;
  /** Tries a failed or cancelled file again. */
  retry: (id: string) => boolean;
  /** Removes the files that have finished. */
  clearFinished: () => void;
  /** Resolves once nothing is running. */
  whenIdle: () => Promise<void>;
}

export function createUseUploadQueue(getStorage: () => KoolbaseUploader) {
  return function useUploadQueue(options: { concurrency?: number } = {}): UseUploadQueueResult {
    const ref = useRef<KoolbaseUploadQueue | null>(null);
    if (ref.current === null) ref.current = new KoolbaseUploadQueue(getStorage(), options);
    const queue = ref.current;
    const subscribe = useCallback((onChange: () => void) => queue.subscribe(onChange), [queue]);
    const getSnapshot = useCallback(() => queue.getState(), [queue]);
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return {
      ...state,
      add: useCallback((files: readonly QueueFile[]) => queue.add(files), [queue]),
      cancel: useCallback((id: string) => queue.cancel(id), [queue]),
      cancelAll: useCallback(() => queue.cancelAll(), [queue]),
      retry: useCallback((id: string) => queue.retry(id), [queue]),
      clearFinished: useCallback(() => queue.clearFinished(), [queue]),
      whenIdle: useCallback(() => queue.whenIdle(), [queue]),
    };
  };
}
