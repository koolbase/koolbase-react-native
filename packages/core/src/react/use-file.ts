// useFile: one file's details as React state (storage S4).
//
// A thin wrapper. Everything about getting the file right lives in
// @koolbase/core's KoolbaseFileController, which is tested there; this file
// only ties one controller's lifetime to a component's.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { KoolbaseFileController, initialFileState, type FileState, type KoolbaseStorage } from '../index.js';

export interface UseFileResult extends FileState {
  /** Read it again. The file stays shown while it runs, and stays if it fails. */
  refresh: () => Promise<void>;
}

const noop = () => {};
const done = () => Promise.resolve();

export function createUseFile(getStorage: () => Pick<KoolbaseStorage, 'getFileInfo'>) {
  return function useFile(bucket: string, path: string | null | undefined): UseFileResult {
    const p = path ?? '';
    const key = JSON.stringify([bucket, p]);
    const [current, setCurrent] = useState<{ key: string; controller: KoolbaseFileController } | null>(null);

    useEffect(() => {
      // Created here, not during render, so React strict mode's second run
      // never keeps a disposed controller.
      const controller = new KoolbaseFileController(getStorage(), bucket, p);
      setCurrent({ key, controller });
      void controller.load();
      return () => controller.dispose();
    }, [key]);

    // A controller from the previous file reads as a fresh load, never as
    // the previous file.
    const controller = current?.key === key ? current.controller : null;
    const subscribe = useCallback(
      (onChange: () => void) => (controller ? controller.subscribe(onChange) : noop),
      [controller],
    );
    const getSnapshot = useCallback(
      () => (controller ? controller.getState() : initialFileState),
      [controller],
    );
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const refresh = useCallback(() => (controller ? controller.refresh() : done()), [controller]);
    return { ...state, refresh };
  };
}
