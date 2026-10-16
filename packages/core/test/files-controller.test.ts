// S4: a bucket's files as list state. The controller over the real
// KoolbaseStorage (fetch mocked): page one, the next page by cursor, a file
// never shown twice, stale beats blank, a late answer dropped, and a list
// reloaded after an upload, delete, move or copy made through the SDK.

import { KoolbaseFilesController } from '../src/files-controller';
import { clearFilesRefreshers } from '../src/files-refresh';
import { KoolbaseStorage } from '../src/storage';

const config = { publicKey: 'pk_test', baseUrl: 'https://api.test' } as never;
const g = globalThis as unknown as { fetch: unknown };
const realFetch = g.fetch;
afterEach(() => {
  g.fetch = realFetch;
  clearFilesRefreshers();
});

const file = (path: string) => ({
  path, size: 4, content_type: 'image/png', metadata: {}, created_at: '2026-10-16T10:00:00Z', updated_at: '2026-10-16T10:00:00Z',
});
const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A server whose listing answers from `pages` by cursor; every request seen. */
function server(pages: Record<string, { files: string[]; next?: string }>, other: (url: string, init: RequestInit) => Response | undefined = () => undefined) {
  const seen: string[] = [];
  const state = { failing: false };
  g.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    seen.push(`${init.method ?? 'GET'} ${url}`);
    const u = new URL(url);
    if (u.pathname === '/v1/sdk/storage/files') {
      if (state.failing) return json(500, { error: 'down' });
      const p = pages[u.searchParams.get('cursor') ?? ''];
      return json(200, { files: p.files.map(file), next_cursor: p.next ?? null });
    }
    return other(url, init) ?? json(404, { error: 'unexpected' });
  });
  return { seen, state, listings: () => seen.filter((s) => s.includes('/storage/files')) };
}

const paths = (c: KoolbaseFilesController) => c.getState().files.map((f) => f.path);
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('KoolbaseFilesController', () => {
  it('loads page one with the listing asked for, then the next page by cursor, never a file twice', async () => {
    const s = server({ '': { files: ['a.png', 'b.png'], next: 'c1' }, c1: { files: ['b.png', 'c.png'] } });
    const c = new KoolbaseFilesController(new KoolbaseStorage(config, async () => 'tok'), 'photos', { prefix: 'trips/', sort: 'createdAt', descending: true, limit: 2 });
    expect(c.getState().status).toBe('loading');
    await c.load();
    expect(c.getState()).toMatchObject({ status: 'loaded', hasMore: true });
    expect(paths(c)).toEqual(['a.png', 'b.png']);
    const first = new URL(s.listings()[0].slice(4));
    expect(Object.fromEntries(first.searchParams)).toEqual({ bucket: 'photos', prefix: 'trips/', limit: '2', sort: 'created_at', order: 'desc' });
    await c.loadMore();
    expect(new URL(s.listings()[1].slice(4)).searchParams.get('cursor')).toBe('c1');
    expect(paths(c)).toEqual(['a.png', 'b.png', 'c.png']);
    expect(c.getState()).toMatchObject({ hasMore: false, loadingMore: false });
    await c.loadMore();
    expect(s.listings()).toHaveLength(2);
  });

  it('a first load that fails is the error state; a failed refresh keeps what is shown', async () => {
    const s = server({ '': { files: ['a.png'] } });
    s.state.failing = true;
    const c = new KoolbaseFilesController(new KoolbaseStorage(config, async () => 'tok'), 'photos');
    await c.load();
    expect(c.getState().status).toBe('error');
    s.state.failing = false;
    await c.refresh();
    expect(c.getState()).toMatchObject({ status: 'loaded', error: null, refreshing: false });
    s.state.failing = true;
    await c.refresh();
    expect(c.getState()).toMatchObject({ status: 'loaded', refreshing: false });
    expect(paths(c)).toEqual(['a.png']);
  });

  it('an answer a later load superseded is dropped, and nothing changes after dispose', async () => {
    const answers: Array<(files: string[]) => void> = [];
    const storage = {
      listFiles: () => new Promise<{ files: never[]; nextCursor: null; hasMore: false }>((resolve) => {
        answers.push((files) => resolve({ files: files.map((p) => ({ path: p })) as never[], nextCursor: null, hasMore: false }));
      }),
    };
    const c = new KoolbaseFilesController(storage as never, 'photos');
    void c.load();
    void c.refresh();
    answers[1](['new.png']);
    await tick();
    answers[0](['old.png']);
    await tick();
    expect(paths(c)).toEqual(['new.png']);
    expect(c.getState().refreshing).toBe(false);
    void c.refresh();
    c.dispose();
    answers[2](['late.png']);
    await tick();
    expect(paths(c)).toEqual(['new.png']);
  });

  it('an upload, a delete, a move and a copy through the SDK reload the lists on their buckets', async () => {
    let files = ['a.png'];
    const s = server({}, (url, init) => {
      const u = new URL(url);
      if (u.pathname === '/v1/sdk/storage/object' && init.method === 'DELETE') {
        files = files.filter((f) => f !== 'a.png');
        return json(204, null);
      }
      if (u.pathname === '/v1/sdk/storage/move' || u.pathname === '/v1/sdk/storage/copy') {
        return json(201, { id: 'o', project_id: 'p', bucket_id: 'b', path: 'x.png', size: 1, content_type: 'image/png', metadata: {}, created_at: '2026-10-16T10:00:00Z', updated_at: '2026-10-16T10:00:00Z' });
      }
      return undefined;
    });
    const storage = new KoolbaseStorage(config, async () => 'tok');
    const photos = new KoolbaseFilesController(storage, 'photos');
    const other = new KoolbaseFilesController(storage, 'docs');
    const listing = jest.fn(async (o: { bucket: string }) => ({ files: (o.bucket === 'photos' ? files : ['d.pdf']).map((p) => ({ path: p })) as never[], nextCursor: null, hasMore: false }));
    (photos as unknown as { storage: unknown }).storage = { listFiles: listing };
    (other as unknown as { storage: unknown }).storage = { listFiles: listing };
    await photos.load();
    await other.load();
    expect(paths(photos)).toEqual(['a.png']);
    listing.mockClear();

    await storage.delete('photos', 'a.png');
    await tick();
    expect(paths(photos)).toEqual([]);
    expect(listing.mock.calls.map((c) => c[0].bucket)).toEqual(['photos']);

    listing.mockClear();
    await storage.move({ bucket: 'photos', from: 'x.png', to: 'y.png', toBucket: 'docs' });
    await tick();
    expect(listing.mock.calls.map((c) => c[0].bucket).sort()).toEqual(['docs', 'photos']);

    listing.mockClear();
    await storage.copy({ bucket: 'docs', from: 'd.pdf', to: 'e.pdf' });
    await tick();
    expect(listing.mock.calls.map((c) => c[0].bucket)).toEqual(['docs']);

    listing.mockClear();
    other.dispose();
    await storage.copy({ bucket: 'docs', from: 'd.pdf', to: 'f.pdf' });
    await tick();
    expect(listing).not.toHaveBeenCalled();
    expect(s.seen.some((x) => x.startsWith('DELETE'))).toBe(true);
  });

  it('a finished upload reloads its bucket; a failed one does not', async () => {
    const storage = new KoolbaseStorage(config, async () => 'tok');
    const listing = jest.fn(async () => ({ files: [] as never[], nextCursor: null, hasMore: false }));
    const c = new KoolbaseFilesController({ listFiles: listing } as never, 'photos');
    await c.load();
    listing.mockClear();
    const runs = [() => Promise.resolve({}), () => Promise.reject(new Error('x'))];
    (storage as unknown as { runUpload: unknown }).runUpload = () => runs.shift()!();
    await storage.startUpload({ bucket: 'photos', path: 'n.png', file: new Blob(['x']) as never }).result;
    await tick();
    expect(listing).toHaveBeenCalledTimes(1);
    await expect(storage.startUpload({ bucket: 'photos', path: 'm.png', file: new Blob(['y']) as never }).result).rejects.toThrow('x');
    await tick();
    expect(listing).toHaveBeenCalledTimes(1);
  });
});
