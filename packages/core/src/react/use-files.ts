// useFiles: a bucket's files as React state (storage S4).
//
// A thin wrapper. Everything about getting the files right lives in
// @koolbase/core's KoolbaseFilesController, which is tested there; this
// file only ties one controller's lifetime to a component's.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  KoolbaseFilesController,
  filesQueryKey,
  initialFilesState,
  type FilesQuery,
  type FilesState,
  type KoolbaseStorage,
} from '../index.js';

export interface UseFilesResult extends FilesState {
  /** Page one again. What is shown stays while it runs, and stays if it fails. */
  refresh: () => Promise<void>;
  /** The next page, appended, while hasMore. */
  loadMore: () => Promise<void>;
}

const noop = () => {};
const done = () => Promise.resolve();

export function createUseFiles(getStorage: () => Pick<KoolbaseStorage, 'listFiles'>) {
  return function useFiles(bucket: string, query: FilesQuery = {}): UseFilesResult {
    // The query as a value: an inline object is a new object every render,
    // and must not start a new fetch every render.
    const key = filesQueryKey(bucket, query);
    const [current, setCurrent] = useState<{ key: string; controller: KoolbaseFilesController } | null>(null);

    useEffect(() => {
      // Created here, not during render, so React strict mode's second run
      // never keeps a disposed controller.
      const controller = new KoolbaseFilesController(getStorage(), bucket, query);
      setCurrent({ key, controller });
      void controller.load();
      return () => controller.dispose();
    }, [key]);

    // A controller from the previous key reads as a fresh load, never as
    // the previous listing's files.
    const controller = current?.key === key ? current.controller : null;
    const subscribe = useCallback(
      (onChange: () => void) => (controller ? controller.subscribe(onChange) : noop),
      [controller],
    );
    const getSnapshot = useCallback(
      () => (controller ? controller.getState() : initialFilesState),
      [controller],
    );
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    const refresh = useCallback(() => (controller ? controller.refresh() : done()), [controller]);
    const loadMore = useCallback(() => (controller ? controller.loadMore() : done()), [controller]);
    return { ...state, refresh, loadMore };
  };
}
