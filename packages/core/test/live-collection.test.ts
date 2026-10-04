import { KoolbaseDatabase } from '../src/database';
import { KoolbaseCollectionController, collectionQueryKey } from '../src/collection-controller';
import { setLiveSource } from '../src/live-source';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

const config = { baseUrl: 'https://api.test', publicKey: 'pk_test' } as any;
const db = () => new KoolbaseDatabase(config, () => 'user-1', async () => 'token');

const row = (id: string, title: string) => ({
  $id: id,
  $collection: 'songs',
  $createdAt: '2026-09-26T00:00:00Z',
  $updatedAt: '2026-09-26T00:00:00Z',
  title,
});

/** Answers every request with the current page; returns the request bodies seen. */
function serve(page: () => { records: Record<string, unknown>[]; total: number }): any[] {
  const bodies: any[] = [];
  global.fetch = jest.fn(async (_input: unknown, init?: { body?: unknown }) => {
    bodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : {});
    return new Response(JSON.stringify(page()), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return bodies;
}

async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}
const pastDebounce = () => new Promise((resolve) => setTimeout(resolve, 300));

/** A stand-in for KoolbaseRealtime: records subscriptions, emits on demand. */
function fakeRealtime() {
  const subs = new Map<string, Set<() => void>>();
  const unsubscribed: string[] = [];
  setLiveSource({
    subscribe(collection, callback) {
      const cb = callback as unknown as () => void;
      if (!subs.has(collection)) subs.set(collection, new Set());
      subs.get(collection)!.add(cb);
      return () => { subs.get(collection)?.delete(cb); unsubscribed.push(collection); };
    },
  });
  return {
    emit: (collection: string) => subs.get(collection)?.forEach((cb) => cb()),
    count: (collection: string) => subs.get(collection)?.size ?? 0,
    unsubscribed,
  };
}

const titles = (c: KoolbaseCollectionController) => c.getState().records.map((r) => r.data.title);

describe('live lists', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });
  afterEach(() => setLiveSource(null));

  it('re-reads page one silently when realtime reports a change in the collection', async () => {
    const rt = fakeRealtime();
    let records = [row('1', 'a')];
    serve(() => ({ records, total: records.length }));
    const c = new KoolbaseCollectionController(db(), 'songs', { live: true });
    const refreshingSeen: boolean[] = [];
    c.subscribe(() => refreshingSeen.push(c.getState().refreshing));
    await c.load();
    await settle();
    expect(rt.count('songs')).toBe(1);

    records = [row('1', 'a'), row('2', 'b')];
    rt.emit('songs');
    await pastDebounce();
    await settle();

    expect(titles(c)).toEqual(['a', 'b']);
    expect(refreshingSeen).not.toContain(true); // silent: not the pull-to-refresh state
  });

  it('reads once for a burst of changes', async () => {
    const rt = fakeRealtime();
    const bodies = serve(() => ({ records: [row('1', 'a')], total: 1 }));
    const c = new KoolbaseCollectionController(db(), 'songs', { live: true });
    await c.load();
    await settle();
    const before = bodies.length;

    rt.emit('songs'); rt.emit('songs'); rt.emit('songs');
    await pastDebounce();
    await settle();

    expect(bodies.length).toBe(before + 1);
  });

  it('a list that is not live does not subscribe', async () => {
    const rt = fakeRealtime();
    serve(() => ({ records: [row('1', 'a')], total: 1 }));
    const c = new KoolbaseCollectionController(db(), 'songs');
    await c.load();
    expect(rt.count('songs')).toBe(0);
  });

  it('dispose unsubscribes and cancels a pending re-read', async () => {
    const rt = fakeRealtime();
    const bodies = serve(() => ({ records: [row('1', 'a')], total: 1 }));
    const c = new KoolbaseCollectionController(db(), 'songs', { live: true });
    await c.load();
    await settle();
    const before = bodies.length;

    rt.emit('songs');
    c.dispose();
    await pastDebounce();
    await settle();

    expect(rt.unsubscribed).toEqual(['songs']);
    expect(bodies.length).toBe(before);
  });

  it('without a realtime client, a live list is simply a list', async () => {
    setLiveSource(null);
    serve(() => ({ records: [row('1', 'a')], total: 1 }));
    const c = new KoolbaseCollectionController(db(), 'songs', { live: true });
    await c.load();
    expect(titles(c)).toEqual(['a']);
  });

  it('the query key changes only for a live query', () => {
    expect(collectionQueryKey('songs', { live: false })).toBe(collectionQueryKey('songs'));
    expect(collectionQueryKey('songs', { live: true })).not.toBe(collectionQueryKey('songs'));
  });
});
