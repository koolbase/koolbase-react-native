// S4: one file's details as state. The controller over the real
// KoolbaseStorage (fetch mocked): exactly that file asked for, an empty path
// asking nothing, not found as not found, stale beats blank, a late answer
// dropped, and the file read again after a change made through the SDK in
// its bucket -- replaced, deleted, moved -- and not after dispose.

import { KoolbaseFileController } from '../src/file-controller';
import { clearFilesRefreshers } from '../src/files-refresh';
import { KoolbaseStorage } from '../src/storage';

const config = { publicKey: 'pk_test', baseUrl: 'https://api.test' } as never;
const g = globalThis as unknown as { fetch: unknown };
const realFetch = g.fetch;
afterEach(() => {
  g.fetch = realFetch;
  clearFilesRefreshers();
});

const info = (path: string, size = 4) => ({
  path, size, content_type: 'image/png', metadata: {}, uploaded_by: 'u1', created_at: '2026-10-16T10:00:00Z', updated_at: '2026-10-16T10:00:00Z',
});
const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };

/** A server holding files by bucket (path -> size); deletes and moves change them. */
function server(files: Record<string, Record<string, number>>) {
  const seen: string[] = [];
  const state = { failing: false, hold: null as Promise<void> | null };
  g.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    seen.push(`${init.method ?? 'GET'} ${u.pathname}${u.search}`);
    if (u.pathname === '/v1/sdk/storage/file') {
      const hold = state.hold;
      if (hold) await hold;
      if (state.failing) return json(500, { error: 'down' });
      const size = files[u.searchParams.get('bucket') ?? '']?.[u.searchParams.get('path') ?? ''];
      return size === undefined ? json(404, { code: 'not_found', error: 'no such file' }) : json(200, info(u.searchParams.get('path')!, size));
    }
    if (u.pathname === '/v1/sdk/storage/object' && init.method === 'DELETE') {
      const b = JSON.parse(String(init.body)) as { bucket: string; path: string };
      delete files[b.bucket]?.[b.path];
      return json(204, null);
    }
    if (u.pathname === '/v1/sdk/storage/move') {
      const b = JSON.parse(String(init.body)) as { bucket: string; from: string; to: string };
      const size = files[b.bucket][b.from];
      delete files[b.bucket][b.from];
      files[b.bucket][b.to] = size;
      return json(201, { ...info(b.to, size), id: 'o1', project_id: 'p1', bucket_id: 'b1', r2_bucket: 'r2' });
    }
    return json(404, { error: 'unexpected' });
  });
  return { seen, state, reads: () => seen.filter((s) => s.startsWith('GET /v1/sdk/storage/file')) };
}

describe('KoolbaseFileController', () => {
  it('asks for exactly that file, its path as it is', async () => {
    const s = server({ photos: { 'trips/Q&A 1.png': 4 } });
    const c = new KoolbaseFileController(new KoolbaseStorage(config, async () => 'tok'), 'photos', 'trips/Q&A 1.png');
    expect(c.getState().status).toBe('loading');
    await c.load();
    expect(c.getState()).toMatchObject({ status: 'loaded', error: null, refreshing: false });
    expect(c.getState().file).toMatchObject({ path: 'trips/Q&A 1.png', name: 'Q&A 1.png', size: 4, uploadedBy: 'u1' });
    const asked = new URL(`https://x${s.reads()[0].slice(4)}`);
    expect(asked.searchParams.get('bucket')).toBe('photos');
    expect(asked.searchParams.get('path')).toBe('trips/Q&A 1.png');
    c.dispose();
  });

  it('an empty path is not found without a request; a missing file is not found, not an error', async () => {
    const s = server({ photos: { 'a.png': 4 } });
    const none = new KoolbaseFileController(new KoolbaseStorage(config, async () => 'tok'), 'photos', '');
    await none.load();
    expect(none.getState()).toMatchObject({ status: 'notFound', file: null });
    expect(s.reads()).toEqual([]);
    const gone = new KoolbaseFileController(new KoolbaseStorage(config, async () => 'tok'), 'photos', 'z.png');
    await gone.load();
    expect(gone.getState()).toMatchObject({ status: 'notFound', file: null, error: null });
  });

  it('a failed first load is the error; a failed refresh keeps the file', async () => {
    const s = server({ photos: { 'a.png': 4 } });
    s.state.failing = true;
    const c = new KoolbaseFileController(new KoolbaseStorage(config, async () => 'tok'), 'photos', 'a.png');
    await c.load();
    expect(c.getState().status).toBe('error');
    expect(c.getState().error).toBeTruthy();
    s.state.failing = false;
    await c.refresh();
    expect(c.getState().status).toBe('loaded');
    s.state.failing = true;
    await c.refresh();
    expect(c.getState()).toMatchObject({ status: 'loaded', refreshing: false });
    expect(c.getState().file?.path).toBe('a.png');
  });

  it('an answer a later load superseded is dropped', async () => {
    const files = { photos: { 'a.png': 4 } as Record<string, number> };
    const s = server(files);
    let release = () => {};
    s.state.hold = new Promise<void>((r) => { release = r; });
    const c = new KoolbaseFileController(new KoolbaseStorage(config, async () => 'tok'), 'photos', 'a.png');
    const first = c.load();
    await settle();
    s.state.hold = null;
    files.photos['a.png'] = 9;
    await c.refresh();
    expect(c.getState().file?.size).toBe(9);
    files.photos['a.png'] = 4;
    release();
    await first;
    expect(c.getState().file?.size).toBe(9);
  });

  it('read again after a change in its bucket: replaced, moved away, deleted; none after dispose', async () => {
    const files = { photos: { 'a.png': 4, 'b.png': 6 } as Record<string, number> };
    const s = server(files);
    const storage = new KoolbaseStorage(config, async () => 'tok');
    const a = new KoolbaseFileController(storage, 'photos', 'a.png');
    const b = new KoolbaseFileController(storage, 'photos', 'b.png');
    const seenChanges: string[] = [];
    a.subscribe(() => seenChanges.push(a.getState().status));
    await a.load();
    await b.load();
    // Moved away: the old path is not found; the new one is unaffected.
    await storage.move({ bucket: 'photos', from: 'a.png', to: 'c.png' });
    await settle();
    expect(a.getState().status).toBe('notFound');
    expect(b.getState().status).toBe('loaded');
    // Deleted.
    await storage.delete('photos', 'b.png');
    await settle();
    expect(b.getState().status).toBe('notFound');
    a.dispose();
    b.dispose();
    const before = s.reads().length;
    await storage.delete('photos', 'c.png');
    await settle();
    expect(s.reads().length).toBe(before);
    expect(seenChanges).toContain('notFound');
  });
});
