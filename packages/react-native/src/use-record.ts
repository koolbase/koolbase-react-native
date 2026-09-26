// useRecord: one Koolbase record, by id, as React state.
//
// A thin wrapper, like useCollection: everything about getting the record
// right lives in @koolbase/core's KoolbaseRecordController, tested there;
// this file only ties one controller's lifetime to a component's.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  KoolbaseRecordController,
  initialRecordState,
  type KoolbaseDatabase,
  type RecordState,
} from '@koolbase/core';

export interface UseRecordResult extends RecordState {
  /** The record again, from the server. What is shown stays while it runs, and stays if it fails. */
  refresh: () => Promise<void>;
}

const noop = () => {};
const done = () => Promise.resolve();

export function createUseRecord(getDb: () => Pick<KoolbaseDatabase, 'get'>) {
  return function useRecord(collection: string, id: string | null | undefined): UseRecordResult {
    const key = JSON.stringify([collection, id ?? '']);
    const [current, setCurrent] = useState<{ key: string; controller: KoolbaseRecordController } | null>(null);

    useEffect(() => {
      // Created here, not during render: under React strict mode an effect
      // runs, cleans up and runs again, and each run gets its own controller.
      const controller = new KoolbaseRecordController(getDb(), collection, id ?? '');
      setCurrent({ key, controller });
      void controller.load();
      return () => controller.dispose();
      // Depends on key alone: key is collection + id, as a value.
    }, [key]);

    // A controller from the previous key reads as a fresh load, never as the
    // previous record.
    const controller = current?.key === key ? current.controller : null;
    const subscribe = useCallback(
      (onChange: () => void) => (controller ? controller.subscribe(onChange) : noop),
      [controller],
    );
    const getSnapshot = useCallback(
      () => (controller ? controller.getState() : initialRecordState),
      [controller],
    );
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const refresh = useCallback(() => (controller ? controller.refresh() : done()), [controller]);
    return { ...state, refresh };
  };
}
