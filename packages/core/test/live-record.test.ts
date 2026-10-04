import { KoolbaseDatabase } from '../src/database';
import { KoolbaseRecordController } from '../src/record-controller';
import { setLiveSource } from '../src/live-source';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

const config = { baseUrl: 'https://api.test', publicKey: 'pk_test' } as any;
const db = () => new KoolbaseDatabase(config, () => 'user-1', async () => 'token');
const wire = (id: string, title: string) => ({
  $id: id,
  $collection: 'songs',
  $createdAt: '2026-10-01T00:00:00Z',
  $updatedAt: '2026-10-01T00:00:00Z',
  title,
});

/** Answers every record read with the current title; returns the URLs read. */
function serve(title: () => string): string[] {
  const urls: string[] = [];
  global.fetch = jest.fn(async (input: unknown) => {
    urls.push(String(input));
    return new Response(JSON.stringify(wire('r1', title())), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return urls;
}

/** A stand-in for KoolbaseRealtime: records subscriptions, emits events on demand. */
function fakeRealtime() {
  const subs = new Map<string, Set<(event: unknown) => void>>();
  const unsubscribed: string[] = [];
  setLiveSource({
    subscribe(collection, callback) {
      if (!subs.has(collection)) subs.set(collection, new Set());
      subs.get(collection)!.add(callback);
      return () => { subs.get(collection)?.delete(callback); unsubscribed.push(collection); };
    },
  });
  return {
    emit: (event: { collection: string }) => subs.get(event.collection)?.forEach((cb) => cb(event)),
    count: (collection: string) => subs.get(collection)?.size ?? 0,
    unsubscribed,
  };
}
const updated = (id: string) => ({ type: 'updated', collection: 'songs', record: { id, collection: 'songs', data: {} } });
const deleted = (id: string) => ({ type: 'deleted', collection: 'songs', recordId: id });

async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}
const pastDebounce = () => new Promise((resolve) => setTimeout(resolve, 300));
const titleOf = (c: KoolbaseRecordController) => (c.getState().record?.data as { title?: string } | undefined)?.title;

describe('live record', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });
  afterEach(() => setLiveSource(null));

  it('re-reads this record silently when realtime reports it changed', async () => {
    const rt = fakeRealtime();
    let title = 'Accra Nights';
    serve(() => title);
    const c = new KoolbaseRecordController(db(), 'songs', 'r1', { live: true });
    const refreshingSeen: boolean[] = [];
    c.subscribe(() => refreshingSeen.push(c.getState().refreshing));
    await c.load();
    expect(rt.count('songs')).toBe(1);

    title = 'Morning Light';
    rt.emit(updated('r1'));
    await pastDebounce();
    await settle();

    expect(titleOf(c)).toBe('Morning Light');
    expect(refreshingSeen).not.toContain(true); // silent: not the pull-to-refresh state
  });

  it('ignores changes to other records', async () => {
    const rt = fakeRealtime();
    const urls = serve(() => 'a');
    const c = new KoolbaseRecordController(db(), 'songs', 'r1', { live: true });
    await c.load();
    const before = urls.length;

    rt.emit(updated('r2'));
    rt.emit(deleted('r2'));
    await pastDebounce();
    await settle();

    expect(urls.length).toBe(before);
    expect(c.getState().status).toBe('loaded');
  });

  it('reads once for a burst of changes', async () => {
    const rt = fakeRealtime();
    const urls = serve(() => 'a');
    const c = new KoolbaseRecordController(db(), 'songs', 'r1', { live: true });
    await c.load();
    const before = urls.length;

    rt.emit(updated('r1')); rt.emit(updated('r1')); rt.emit(updated('r1'));
    await pastDebounce();
    await settle();

    expect(urls.length).toBe(before + 1);
  });

  it('a delete is notFound at once, without a read', async () => {
    const rt = fakeRealtime();
    const urls = serve(() => 'a');
    const c = new KoolbaseRecordController(db(), 'songs', 'r1', { live: true });
    await c.load();
    const before = urls.length;

    rt.emit(deleted('r1'));

    expect(c.getState().status).toBe('notFound');
    expect(c.getState().record).toBeNull();
    await pastDebounce();
    await settle();
    expect(urls.length).toBe(before);
  });

  it('a delete drops a re-read still pending', async () => {
    const rt = fakeRealtime();
    const urls = serve(() => 'a');
    const c = new KoolbaseRecordController(db(), 'songs', 'r1', { live: true });
    await c.load();
    const before = urls.length;

    rt.emit(updated('r1'));
    rt.emit(deleted('r1'));
    await pastDebounce();
    await settle();

    expect(c.getState().status).toBe('notFound');
    expect(urls.length).toBe(before);
  });

  it('a record view that is not live does not subscribe', async () => {
    const rt = fakeRealtime();
    serve(() => 'a');
    const c = new KoolbaseRecordController(db(), 'songs', 'r1');
    await c.load();
    expect(rt.count('songs')).toBe(0);
  });

  it('no id: nothing to follow, so no subscription', async () => {
    const rt = fakeRealtime();
    serve(() => 'a');
    const c = new KoolbaseRecordController(db(), 'songs', '', { live: true });
    await c.load();
    expect(c.getState().status).toBe('notFound');
    expect(rt.count('songs')).toBe(0);
  });

  it('dispose unsubscribes and cancels a pending re-read', async () => {
    const rt = fakeRealtime();
    const urls = serve(() => 'a');
    const c = new KoolbaseRecordController(db(), 'songs', 'r1', { live: true });
    await c.load();
    const before = urls.length;

    rt.emit(updated('r1'));
    c.dispose();
    await pastDebounce();
    await settle();

    expect(rt.unsubscribed).toEqual(['songs']);
    expect(urls.length).toBe(before);
  });

  it('without a realtime client, a live record view is simply a record view', async () => {
    setLiveSource(null);
    serve(() => 'a');
    const c = new KoolbaseRecordController(db(), 'songs', 'r1', { live: true });
    await c.load();
    expect(titleOf(c)).toBe('a');
  });
});
