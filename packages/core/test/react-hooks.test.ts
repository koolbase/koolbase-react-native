/**
 * @jest-environment jsdom
 */
// useCollection and useRecord, rendered: what the hooks add on top of the
// controllers (whose behaviour, HTTP included, is tested in their own suites).
// A hook ties one controller to a component's lifetime: it loads on mount,
// re-renders on every change, starts a fresh controller when its key (the
// collection and query, or the id) changes, never shows the previous key's
// result, and does not refetch for a query that is merely a new object.
// The database is a small fake through the factories' own seam, so no HTTP
// and no environment quirks: jsdom has no fetch, and needs none here.
// One implementation is tested here; @koolbase/react-native and
// @koolbase/js/react export these same factories bound to their Koolbase.
import { act, createElement } from 'react';
// React DOM's client, typed here for the two calls the tests make (react-dom's
// types are a separate package this repo does not need for anything else).
type Root = { render(node: unknown): void; unmount(): void };
const { createRoot } = require('react-dom/client') as { createRoot(container: Element): Root };
import { createUseCollection, createUseRecord, type UseCollectionResult, type UseRecordResult } from '../src/react';
import { KoolbaseNotFoundError } from '../src/database-errors';
import { setPlatform, memoryPlatform } from '../src/platform';
import type { KoolbaseDatabase, KoolbaseRecord, QueryOptions, QueryResult } from '../src/index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rec = (id: string, collection: string, title: string) =>
  ({ id, collection, data: { title } }) as unknown as KoolbaseRecord;
const titles = (r: { records: readonly KoolbaseRecord[] }) => r.records.map((x) => (x.data as { title: string }).title);

/** An answer held back until open() is called. */
function gate() {
  let release: () => void = () => {};
  const opened = new Promise<void>((resolve) => { release = resolve; });
  return { opened, open: () => release() };
}

/** Lets pending work (the controllers' promises) finish, inside act. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Renders a component calling hook(props); the latest result, a rerender with new props, unmount. */
function mount<P, T>(hook: (p: P) => T, props: P) {
  let latest!: T;
  function Probe(p: { args: P }) { latest = hook(p.args); return null; }
  const root: Root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Probe, { args: props })));
  return {
    current: () => latest,
    rerender: (next: P) => act(() => root.render(createElement(Probe, { args: next }))),
    unmount: () => act(() => root.unmount()),
  };
}

beforeEach(() => {
  setPlatform(memoryPlatform());
});

describe('useCollection', () => {
  type Query = (collection: string, options?: QueryOptions) => Promise<QueryResult>;
  const fakeDb = (query: Query) => {
    const fn = jest.fn(query);
    return { db: { query: fn } as unknown as Pick<KoolbaseDatabase, 'query'>, query: fn };
  };

  it('is loading, then loaded with the records; refresh asks again and keeps what is shown', async () => {
    const { db, query } = fakeDb(async () => ({ records: [rec('1', 'songs', 'a'), rec('2', 'songs', 'b')], total: 2 }));
    const useCollection = createUseCollection(() => db);
    const h = mount((p: { c: string }) => useCollection(p.c), { c: 'songs' });
    expect(h.current().status).toBe('loading');

    await settle();
    expect(h.current().status).toBe('loaded');
    expect(titles(h.current())).toEqual(['a', 'b']);

    await act(async () => { await h.current().refresh(); });
    await settle();
    expect(query.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(h.current().status).toBe('loaded');
    expect(titles(h.current())).toEqual(['a', 'b']);
    h.unmount();
  });

  it('reports an error when the first load fails', async () => {
    const boom = new Error('server down');
    const { db } = fakeDb(async () => { throw boom; });
    const useCollection = createUseCollection(() => db);
    const h = mount((p: { c: string }) => useCollection(p.c), { c: 'songs' });

    await settle();
    expect(h.current().status).toBe('error');
    expect(h.current().error).toBe(boom);
    h.unmount();
  });

  it('a query that is only a new object does not fetch again', async () => {
    const { db, query } = fakeDb(async () => ({ records: [rec('1', 'songs', 'a')], total: 1 }));
    const useCollection = createUseCollection(() => db);
    const h = mount((p: { genre: string }) => useCollection('songs', { where: { genre: p.genre } }), { genre: 'jazz' });
    await settle();
    const calls = query.mock.calls.length;

    h.rerender({ genre: 'jazz' }); // a new { where } object, the same query
    await settle();
    expect(query.mock.calls.length).toBe(calls);
    expect(titles(h.current())).toEqual(['a']);
    h.unmount();
  });

  it('a new key loads afresh, and the previous key\'s late answer is never shown', async () => {
    const first = gate();
    const { db } = fakeDb(async (_c, options) => {
      const o = options as { filters?: { genre?: string }; where?: { genre?: string } } | undefined;
      const genre = o?.filters?.genre ?? o?.where?.genre;
      if (genre === 'jazz') { await first.opened; return { records: [rec('1', 'songs', 'jazz song')], total: 1 }; }
      return { records: [rec('2', 'songs', 'rock song')], total: 1 };
    });
    const useCollection = createUseCollection(() => db);
    const h = mount((p: { genre: string }) => useCollection('songs', { where: { genre: p.genre } }), { genre: 'jazz' });
    expect(h.current().status).toBe('loading');

    h.rerender({ genre: 'rock' });
    expect(h.current().status).toBe('loading'); // never the previous key's state
    await settle();
    expect(titles(h.current())).toEqual(['rock song']);

    first.open(); // the jazz answer lands late
    await settle();
    expect(titles(h.current())).toEqual(['rock song']);
    h.unmount();
  });

  it('after unmount, a late answer changes nothing and does not throw', async () => {
    const late = gate();
    const { db } = fakeDb(async () => { await late.opened; return { records: [rec('1', 'songs', 'a')], total: 1 }; });
    const useCollection = createUseCollection(() => db);
    const h = mount((p: { c: string }) => useCollection(p.c), { c: 'songs' });
    h.unmount();
    late.open();
    await settle();
    expect(h.current().status).toBe('loading');
  });
});

describe('useRecord', () => {
  type Get = (id: string) => Promise<KoolbaseRecord>;
  const fakeDb = (get: Get) => {
    const fn = jest.fn(get);
    return { db: { get: fn } as unknown as Pick<KoolbaseDatabase, 'get'>, get: fn };
  };
  const notFound = () => Object.create(KoolbaseNotFoundError.prototype) as Error;

  it('is loading, then loaded with the record; refresh asks again', async () => {
    const { db, get } = fakeDb(async (id) => rec(id, 'songs', 'a'));
    const useRecord = createUseRecord(() => db);
    const h = mount((p: { id: string }) => useRecord('songs', p.id), { id: 's1' });
    expect(h.current().status).toBe('loading');

    await settle();
    expect(h.current().status).toBe('loaded');
    expect((h.current().record?.data as { title: string }).title).toBe('a');

    await act(async () => { await h.current().refresh(); });
    await settle();
    expect(get.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(h.current().status).toBe('loaded');
    h.unmount();
  });

  it('a record that does not exist is notFound', async () => {
    const { db } = fakeDb(async () => { throw notFound(); });
    const useRecord = createUseRecord(() => db);
    const h = mount((p: { id: string }) => useRecord('songs', p.id), { id: 'missing' });
    await settle();
    expect(h.current().status).toBe('notFound');
    expect(h.current().record).toBeNull();
    h.unmount();
  });

  it('no id is notFound, without asking the server', async () => {
    const { db, get } = fakeDb(async (id) => rec(id, 'songs', 'a'));
    const useRecord = createUseRecord(() => db);
    const h = mount((p: { id: string | null }) => useRecord('songs', p.id), { id: null });
    await settle();
    expect(h.current().status).toBe('notFound');
    expect(get).not.toHaveBeenCalled();
    h.unmount();
  });

  it('reports an error when the load fails', async () => {
    const boom = new Error('server down');
    const { db } = fakeDb(async () => { throw boom; });
    const useRecord = createUseRecord(() => db);
    const h = mount((p: { id: string }) => useRecord('songs', p.id), { id: 's1' });
    await settle();
    expect(h.current().status).toBe('error');
    expect(h.current().error).toBe(boom);
    h.unmount();
  });

  it('a new id loads afresh, and the previous id\'s late answer is never shown', async () => {
    const first = gate();
    const { db } = fakeDb(async (id) => {
      if (id === 's1') { await first.opened; return rec('s1', 'songs', 'first'); }
      return rec(id, 'songs', 'second');
    });
    const useRecord = createUseRecord(() => db);
    const h = mount((p: { id: string }) => useRecord('songs', p.id), { id: 's1' });
    h.rerender({ id: 's2' });
    expect(h.current().status).toBe('loading');
    await settle();
    expect((h.current().record?.data as { title: string }).title).toBe('second');
    first.open();
    await settle();
    expect((h.current().record?.data as { title: string }).title).toBe('second');
    h.unmount();
  });
});

// The types the packages export are the hooks' results.
const typed: [UseCollectionResult['status'], UseRecordResult['status']] = ['loading', 'notFound'];
void typed;
