// useCollection: a Koolbase collection as React state.
//
// A thin wrapper. Everything about getting the records right lives in
// @koolbase/core's KoolbaseCollectionController, which is tested there; this
// file only ties one controller's lifetime to a component's.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  KoolbaseCollectionController,
  collectionQueryKey,
  initialCollectionState,
  type CollectionQuery,
  type CollectionState,
  type KoolbaseDatabase,
} from '@koolbase/core';

export interface UseCollectionResult extends CollectionState {
  /** Page one again, from the server. What is shown stays while it runs, and stays if it fails. */
  refresh: () => Promise<void>;
  /**
   * The next page, appended, while hasMore. If rows are added or removed on
   * the server between pages, one can be skipped until refresh(); none is
   * ever shown twice.
   */
  loadMore: () => Promise<void>;
}

const noop = () => {};
const done = () => Promise.resolve();

export function createUseCollection(getDb: () => Pick<KoolbaseDatabase, 'query'>) {
  return function useCollection(collection: string, query: CollectionQuery = {}): UseCollectionResult {
    // The query as a value: an inline `where` object is a new object every
    // render, and must not start a new fetch every render.
    const key = collectionQueryKey(collection, query);
    const [current, setCurrent] = useState<{ key: string; controller: KoolbaseCollectionController } | null>(null);

    useEffect(() => {
      // Created here, not during render. Under React strict mode an effect
      // runs, cleans up and runs again; each run gets its own controller, so
      // the one left running is never one that was already disposed.
      const controller = new KoolbaseCollectionController(getDb(), collection, query);
      setCurrent({ key, controller });
      void controller.load();
      return () => controller.dispose();
      // Depends on key alone: key is collection + query, as a value.
    }, [key]);

    // A controller from the previous key reads as a fresh load, never as
    // the previous query's records.
    const controller = current?.key === key ? current.controller : null;
    const subscribe = useCallback(
      (onChange: () => void) => (controller ? controller.subscribe(onChange) : noop),
      [controller],
    );
    const getSnapshot = useCallback(
      () => (controller ? controller.getState() : initialCollectionState),
      [controller],
    );
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    const refresh = useCallback(() => (controller ? controller.refresh() : done()), [controller]);
    const loadMore = useCallback(() => (controller ? controller.loadMore() : done()), [controller]);
    return { ...state, refresh, loadMore };
  };
}
