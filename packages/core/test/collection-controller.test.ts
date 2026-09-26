import { KoolbaseDatabase } from '../src/database';
import { KoolbaseCollectionController, collectionQueryKey } from '../src/collection-controller';
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

type Page = { records: Record<string, unknown>[]; total: number };
type Answer = (body: any) => Page | 'offline' | Promise<Page | 'offline'>;

/** Answers every request with answer(body); returns the request bodies seen. */
function serve(answer: Answer): any[] {
  const bodies: any[] = [];
  global.fetch = jest.fn(async (_input: unknown, init?: { body?: unknown }) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    bodies.push(body);
    const page = await answer(body);
    if (page === 'offline') throw new TypeError('Network request failed');
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return bodies;
}

/** A response held back until open() is called. */
function gate() {
  let release: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, open: () => release() };
}

/** Lets background work (cache writes, refreshes) finish. */
async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const titles = (c: KoolbaseCollectionController) => c.getState().records.map((r) => r.data.title);

describe('KoolbaseCollectionController', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('loads, then reports loaded with an exact hasMore', async () => {
    serve(() => ({ records: [row('1', 'a'), row('2', 'b')], total: 3 }));
    const c = new KoolbaseCollectionController(db(), 'songs');
    expect(c.getState().status).toBe('loading');

    await c.load();

    expect(c.getState().status).toBe('loaded');
    expect(titles(c)).toEqual(['a', 'b']);
    expect(c.getState().isFromCache).toBe(false);
    expect(c.getState().hasMore).toBe(true);
  });

  it('sends where as equality filters', async () => {
    const bodies = serve(() => ({ records: [], total: 0 }));
    const c = new KoolbaseCollectionController(db(), 'songs', {
      where: { year: 1999, title: 'x' },
      orderBy: 'title',
      limit: 5,
    });

    await c.load();

    expect(bodies[0]).toMatchObject({
      collection: 'songs',
      filters: { title: 'x', year: 1999 },
      order_by: 'title',
      limit: 5,
      offset: 0,
    });
    expect(c.getState().status).toBe('loaded');
    expect(c.getState().hasMore).toBe(false);
  });

  it('is the error state only when the first load fails with nothing to show', async () => {
    serve(() => 'offline');
    const c = new KoolbaseCollectionController(db(), 'songs');

    await c.load();

    expect(c.getState().status).toBe('error');
    expect(c.getState().error).toBeTruthy();
  });

  it('shows the cached result first, then the server result when it lands', async () => {
    serve(() => ({ records: [row('1', 'old')], total: 1 }));
    await new KoolbaseCollectionController(db(), 'songs').load(); // fills the cache

    const g = gate();
    serve(async () => {
      await g.opened;
      return { records: [row('1', 'new'), row('2', 'added')], total: 2 };
    });
    const c = new KoolbaseCollectionController(db(), 'songs');
    await c.load();
    expect(titles(c)).toEqual(['old']);
    expect(c.getState().isFromCache).toBe(true);

    g.open();
    await settle();

    expect(titles(c)).toEqual(['new', 'added']);
    expect(c.getState().isFromCache).toBe(false);
  });

  it('ignores a background refresh that lands after dispose', async () => {
    serve(() => ({ records: [row('1', 'old')], total: 1 }));
    await new KoolbaseCollectionController(db(), 'songs').load();

    const g = gate();
    serve(async () => {
      await g.opened;
      return { records: [row('1', 'new')], total: 1 };
    });
    const c = new KoolbaseCollectionController(db(), 'songs');
    await c.load();
    const listener = jest.fn();
    c.subscribe(listener);

    c.dispose();
    g.open();
    await settle();

    expect(listener).not.toHaveBeenCalled();
    expect(titles(c)).toEqual(['old']);
  });

  it('keeps the records when a refresh fails, and stops refreshing', async () => {
    serve(() => ({ records: [row('1', 'a')], total: 1 }));
    const c = new KoolbaseCollectionController(db(), 'songs');
    await c.load();

    serve(() => 'offline');
    const refreshing = c.refresh();
    expect(c.getState().refreshing).toBe(true);
    await refreshing;

    expect(c.getState().refreshing).toBe(false);
    expect(c.getState().status).toBe('loaded');
    expect(titles(c)).toEqual(['a']);
  });

  it('refresh waits for the server, not the cache', async () => {
    serve(() => ({ records: [row('1', 'a')], total: 1 }));
    const c = new KoolbaseCollectionController(db(), 'songs');
    await c.load();

    serve(() => ({ records: [row('1', 'b')], total: 1 }));
    await c.refresh();

    expect(titles(c)).toEqual(['b']);
    expect(c.getState().isFromCache).toBe(false);
  });

  it('loadMore appends the next page from where the list ends', async () => {
    const all = [row('1', 'a'), row('2', 'b'), row('3', 'c')];
    const bodies = serve((b) => ({ records: all.slice(b.offset, b.offset + b.limit), total: all.length }));
    const c = new KoolbaseCollectionController(db(), 'songs', { limit: 2 });
    await c.load();
    expect(c.getState().hasMore).toBe(true);

    await c.loadMore();

    expect(bodies[1]).toMatchObject({ offset: 2, limit: 2 });
    expect(titles(c)).toEqual(['a', 'b', 'c']);
    expect(c.getState().hasMore).toBe(false);
    expect(c.getState().loadingMore).toBe(false);
  });

  it('drops a page that a refresh superseded', async () => {
    const all = [row('1', 'a'), row('2', 'b'), row('3', 'c')];
    const g = gate();
    serve(async (b) => {
      if (b.offset > 0) await g.opened;
      return { records: all.slice(b.offset, b.offset + b.limit), total: all.length };
    });
    const c = new KoolbaseCollectionController(db(), 'songs', { limit: 2 });
    await c.load();

    const more = c.loadMore();
    await c.refresh();
    g.open();
    await more;

    expect(titles(c)).toEqual(['a', 'b']);
    expect(c.getState().loadingMore).toBe(false);
  });

  it('gives equal queries one key, whatever the order of where', () => {
    expect(collectionQueryKey('songs', { where: { a: 1, b: 2 } })).toBe(
      collectionQueryKey('songs', { where: { b: 2, a: 1 } }),
    );
    expect(collectionQueryKey('songs', { where: { a: 1 } })).not.toBe(
      collectionQueryKey('songs', { where: { a: 2 } }),
    );
  });
});

describe('KoolbaseCollectionController when the server moves between pages', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('never shows a row twice when a refreshed page one overlaps a later page', async () => {
    let phase = 'before';
    const g = gate();
    serve(async (b) => {
      if (phase === 'before') return { records: [row('a', 'a'), row('b', 'b')], total: 4 };
      if (b.offset === 0) {
        await g.opened;
        return { records: [row('x', 'x'), row('a', 'a')], total: 5 };
      }
      return { records: [row('b', 'b'), row('c', 'c')], total: 5 };
    });
    await new KoolbaseCollectionController(db(), 'songs', { limit: 2 }).load(); // cache holds a, b

    phase = 'after'; // x was added at the top
    const c = new KoolbaseCollectionController(db(), 'songs', { limit: 2 });
    await c.load(); // a, b from cache; the server's page one is held back
    await c.loadMore(); // b, c: b is already shown
    expect(titles(c)).toEqual(['a', 'b', 'c']);

    g.open();
    await settle();

    expect(titles(c)).toEqual(['x', 'a', 'b', 'c']);
  });

  it('moves on past a page of rows it already shows', async () => {
    const bodies = serve((b) => {
      if (b.offset === 0) return { records: [row('a', 'a'), row('b', 'b')], total: 6 };
      if (b.offset === 2) return { records: [row('a', 'a'), row('b', 'b')], total: 6 }; // shifted by two
      return { records: [row('c', 'c'), row('d', 'd')], total: 6 };
    });
    const c = new KoolbaseCollectionController(db(), 'songs', { limit: 2 });
    await c.load();
    await c.loadMore();
    expect(titles(c)).toEqual(['a', 'b']);
    expect(c.getState().hasMore).toBe(true);

    await c.loadMore();

    expect(bodies[2].offset).toBe(4); // not offset 2 again, forever
    expect(titles(c)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('treats an empty page as the end', async () => {
    serve((b) =>
      b.offset === 0 ? { records: [row('a', 'a'), row('b', 'b')], total: 5 } : { records: [], total: 5 },
    );
    const c = new KoolbaseCollectionController(db(), 'songs', { limit: 2 });
    await c.load();

    await c.loadMore();

    expect(titles(c)).toEqual(['a', 'b']);
    expect(c.getState().hasMore).toBe(false);
  });
});

describe('query onRefresh', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('is not called on a cache miss', async () => {
    serve(() => ({ records: [row('1', 'a')], total: 1 }));
    const onRefresh = jest.fn();

    const result = await db().query('songs', { onRefresh });
    await settle();

    expect(result.isFromCache).toBe(false);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('is not part of the query identity, and delivers the fresh result once', async () => {
    serve(() => ({ records: [row('1', 'old')], total: 1 }));
    await db().query('songs', {}); // cached without a callback

    serve(() => ({ records: [row('1', 'new')], total: 1 }));
    const onRefresh = jest.fn();
    const result = await db().query('songs', { onRefresh });
    expect(result.isFromCache).toBe(true); // same cache entry despite the callback

    await settle();

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh.mock.calls[0][0].records[0].data.title).toBe('new');
    expect(onRefresh.mock.calls[0][0].isFromCache).toBe(false);
  });
});

describe('query cache identity', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('is the same whatever the order of the filters', async () => {
    serve(() => ({ records: [row('1', 'a')], total: 1 }));
    await db().query('songs', { filters: { genre: 'jazz', year: 1999 } });

    const again = await db().query('songs', { filters: { year: 1999, genre: 'jazz' } });

    expect(again.isFromCache).toBe(true);
  });
});
