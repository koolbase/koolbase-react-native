// S1: an upload you can follow and cancel, and a bucket's files listed.
//
// The server is a scripted fetch: the presign answers with an upload_id and
// the confirm must name it. The bytes go to storage through a stand-in
// XMLHttpRequest that takes them a chunk at a time, as a connection does --
// the browser and React Native both send uploads through XMLHttpRequest.

import { KoolbaseStorage } from '../src/storage';
import * as errors from '../src/storage-errors';
import { KoolbaseNetworkError } from '../src/network';
import { KoolbaseUnauthenticatedError } from '../src/errors';
import type { KoolbaseUploadProgress } from '../src/storage-transfer';

const BASE = 'https://api.test';
const config = { publicKey: 'pk_test', baseUrl: BASE } as never;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const object = (path: string, size: number) => ({
  id: 'o1',
  project_id: 'p1',
  bucket_id: 'b1',
  r2_bucket: 'koolbase-storage',
  path,
  size,
  content_type: 'image/png',
  metadata: {},
  created_at: '2026-10-15T10:00:00Z',
  updated_at: '2026-10-15T10:00:00Z',
});

type Call = { method: string; url: string; body?: Record<string, unknown> };

/** The API: presign, confirm, download link. Storage PUTs go through fetch only when there is no XMLHttpRequest. */
function server(calls: Call[]) {
  return jest.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    if (url.endsWith('/upload-url')) return json({ upload_url: 'https://r2.test/stage/x', file_key: 'k', upload_id: 'up-1' });
    if (url.startsWith('https://r2.test/')) return new Response(null, { status: 200, headers: { etag: '"e1"' } });
    if (url.endsWith('/confirm')) return json(object(body.path, body.size), 201);
    if (url.includes('/download-url')) return json({ url: 'https://r2.test/signed' });
    return json({ error: 'unexpected' }, 500);
  });
}

/** A stand-in XMLHttpRequest: takes the body 64KB at a time, one turn per chunk. */
class FakeXHR {
  static instances: FakeXHR[] = [];
  static fail = false;
  static onChunk: ((loaded: number) => void) | null = null;
  upload: { onprogress: ((ev: { loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  aborted = false;
  sent = 0;
  constructor() {
    FakeXHR.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  getResponseHeader(k: string) {
    return k.toLowerCase() === 'etag' ? '"e1"' : null;
  }
  abort() {
    if (this.aborted) return;
    this.aborted = true;
    setTimeout(() => this.onabort?.(), 0);
  }
  send(body: Blob) {
    const total = body.size;
    const step = () => {
      if (this.aborted) return;
      if (FakeXHR.fail && this.sent > 0) {
        this.onerror?.();
        return;
      }
      if (this.sent < total) {
        this.sent = Math.min(total, this.sent + 64 * 1024);
        this.upload.onprogress?.({ loaded: this.sent, total });
        FakeXHR.onChunk?.(this.sent);
        setTimeout(step, 0);
        return;
      }
      this.status = 200;
      this.onload?.();
    };
    setTimeout(step, 0);
  }
}

const g = globalThis as unknown as { fetch: unknown; XMLHttpRequest?: unknown };
const realFetch = g.fetch;

beforeEach(() => {
  FakeXHR.instances = [];
  FakeXHR.fail = false;
  FakeXHR.onChunk = null;
  g.XMLHttpRequest = FakeXHR;
});

afterEach(() => {
  g.fetch = realFetch;
  delete g.XMLHttpRequest;
});

const png = (size: number) => new Blob([new Uint8Array(size).fill(7)], { type: 'image/png' });

describe('uploads you can follow', () => {
  it('reports pending, the bytes as they go, verifying, then completed; the confirm names its upload', async () => {
    const calls: Call[] = [];
    g.fetch = server(calls);
    const s = new KoolbaseStorage(config, async () => 'tok');
    const seen: KoolbaseUploadProgress[] = [];
    const percents: number[] = [];
    const res = await s.upload({
      bucket: 'posters',
      path: 'gig.png',
      file: png(200 * 1024),
      onProgress: (pct, p) => {
        percents.push(pct);
        seen.push(p);
      },
    });
    expect(res.object.path).toBe('gig.png');
    expect(res.downloadUrl).toBe('https://r2.test/signed');

    const states = seen.map((p) => p.state);
    expect(states[0]).toBe('pending');
    expect(states).toEqual(expect.arrayContaining(['uploading', 'verifying', 'completed']));
    expect(states.indexOf('verifying')).toBeGreaterThan(states.lastIndexOf('uploading'));
    const sent = seen.filter((p) => p.state === 'uploading').map((p) => p.bytesSent);
    expect(sent.length).toBeGreaterThan(2); // a chunk at a time
    for (let i = 1; i < sent.length; i++) expect(sent[i]).toBeGreaterThanOrEqual(sent[i - 1]);
    expect(sent[sent.length - 1]).toBe(200 * 1024);
    expect(seen[seen.length - 1]).toMatchObject({ state: 'completed', fraction: 1, isDone: true });
    expect(percents[percents.length - 1]).toBe(100);

    // The bytes went to storage with their type; the confirm names the upload.
    expect(FakeXHR.instances).toHaveLength(1);
    expect(FakeXHR.instances[0]).toMatchObject({ method: 'PUT', url: 'https://r2.test/stage/x' });
    expect(FakeXHR.instances[0].headers['Content-Type']).toBe('image/png');
    const confirm = calls.find((c) => c.url.endsWith('/confirm'))!;
    expect(confirm.body).toMatchObject({ upload_id: 'up-1', etag: '"e1"', size: 200 * 1024, path: 'gig.png' });
  });

  it('cancelled while sending: the transfer stops and nothing is confirmed', async () => {
    const calls: Call[] = [];
    g.fetch = server(calls);
    const s = new KoolbaseStorage(config, async () => 'tok');
    const task = s.startUpload({ bucket: 'posters', path: 'gig.png', file: png(512 * 1024) });
    FakeXHR.onChunk = (loaded) => {
      if (loaded >= 128 * 1024) task.cancel();
    };
    await expect(task.result).rejects.toBeInstanceOf(errors.KoolbaseUploadCancelledError);
    expect(task.current.state).toBe('cancelled');
    expect(FakeXHR.instances[0].aborted).toBe(true);
    expect(FakeXHR.instances[0].sent).toBeLessThan(512 * 1024);
    expect(calls.filter((c) => c.url.endsWith('/confirm'))).toHaveLength(0);
    expect(task.cancel()).toBe(false); // already over
  });

  it('cancelled before the bytes: nothing is sent', async () => {
    const calls: Call[] = [];
    g.fetch = server(calls);
    const s = new KoolbaseStorage(config, async () => 'tok');
    const task = s.startUpload({ bucket: 'posters', path: 'gig.png', file: png(1024) });
    expect(task.cancel()).toBe(true);
    await expect(task.result).rejects.toBeInstanceOf(errors.KoolbaseUploadCancelledError);
    expect(FakeXHR.instances).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("an AbortSignal cancels upload(), and the error says so", async () => {
    const calls: Call[] = [];
    g.fetch = server(calls);
    const s = new KoolbaseStorage(config, async () => 'tok');
    const ctl = new AbortController();
    FakeXHR.onChunk = () => ctl.abort();
    await expect(s.upload({ bucket: 'posters', path: 'gig.png', file: png(300 * 1024), signal: ctl.signal })).rejects.toMatchObject({
      code: 'upload_cancelled',
    });
    expect(calls.filter((c) => c.url.endsWith('/confirm'))).toHaveLength(0);
  });

  it('once verifying it can no longer be cancelled, and completes', async () => {
    const calls: Call[] = [];
    const base = server(calls);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    g.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/confirm')) await held;
      return base(url, init);
    });
    const s = new KoolbaseStorage(config, async () => 'tok');
    const task = s.startUpload({ bucket: 'posters', path: 'gig.png', file: png(1024) });
    await new Promise<void>((r) => {
      const stop = task.onProgress((p) => {
        if (p.state === 'verifying') {
          r();
          setTimeout(() => stop(), 0);
        }
      });
    });
    expect(task.cancel()).toBe(false);
    release();
    await expect(task.result).resolves.toMatchObject({ object: { path: 'gig.png' } });
    expect(task.current.state).toBe('completed');
  });

  it('a dropped connection fails the upload with a network error', async () => {
    const calls: Call[] = [];
    g.fetch = server(calls);
    FakeXHR.fail = true;
    const s = new KoolbaseStorage(config, async () => 'tok');
    const task = s.startUpload({ bucket: 'posters', path: 'gig.png', file: png(256 * 1024) });
    await expect(task.result).rejects.toBeInstanceOf(KoolbaseNetworkError);
    expect(task.current.state).toBe('failed');
    expect(task.current.error).toBeInstanceOf(KoolbaseNetworkError);
    expect(calls.filter((c) => c.url.endsWith('/confirm'))).toHaveLength(0);
  });

  it('without XMLHttpRequest the bytes go by fetch, and still confirm by upload_id', async () => {
    delete g.XMLHttpRequest;
    const calls: Call[] = [];
    g.fetch = server(calls);
    const s = new KoolbaseStorage(config, async () => 'tok');
    const seen: KoolbaseUploadProgress[] = [];
    const task = s.startUpload({ bucket: 'posters', path: 'gig.png', file: png(4096) });
    task.onProgress((p) => seen.push(p));
    await task.result;
    expect(calls.some((c) => c.method === 'PUT' && c.url === 'https://r2.test/stage/x')).toBe(true);
    expect(calls.find((c) => c.url.endsWith('/confirm'))!.body).toMatchObject({ upload_id: 'up-1', etag: '"e1"' });
    expect(seen.map((p) => p.state)).toEqual(expect.arrayContaining(['uploading', 'verifying', 'completed']));
  });

  it('React Native: a file URI is read, then sent with progress', async () => {
    const calls: Call[] = [];
    const base = server(calls);
    g.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('file://')) return new Response(png(100 * 1024));
      return base(url, init);
    });
    const s = new KoolbaseStorage(config, async () => 'tok');
    const res = await s.upload({ bucket: 'posters', path: 'gig.png', file: { uri: 'file:///tmp/gig.png', name: 'gig.png', type: 'image/png' } });
    expect(res.object.size).toBe(100 * 1024);
    expect(FakeXHR.instances[0].headers['Content-Type']).toBe('image/png');
    expect(FakeXHR.instances[0].sent).toBe(100 * 1024);
  });
});

describe("a bucket's files", () => {
  it('asks for a page with its options and reads it', async () => {
    const asked: string[] = [];
    g.fetch = jest.fn(async (url: string) => {
      asked.push(url);
      return json({
        files: [
          {
            path: 'events/a.png',
            size: 3,
            content_type: 'image/png',
            metadata: { shared: 'yes' },
            uploaded_by: 'u1',
            created_at: '2026-10-15T10:00:00Z',
            updated_at: '2026-10-15T10:00:00Z',
            public_url: 'https://cdn.test/a.png',
          },
        ],
        next_cursor: 'abc',
      });
    });
    const s = new KoolbaseStorage(config, async () => 'tok');
    const page = await s.listFiles({ bucket: 'posters', prefix: 'events/', limit: 2, sort: 'createdAt', descending: true });
    const u = new URL(asked[0]);
    expect(u.pathname).toBe('/v1/sdk/storage/files');
    expect(Object.fromEntries(u.searchParams)).toEqual({ bucket: 'posters', prefix: 'events/', limit: '2', sort: 'created_at', order: 'desc' });
    expect(page.files[0]).toMatchObject({ name: 'a.png', metadata: { shared: 'yes' }, uploadedBy: 'u1', publicUrl: 'https://cdn.test/a.png', versionId: null });
    expect(page).toMatchObject({ nextCursor: 'abc', hasMore: true });

    g.fetch = jest.fn(async (url: string) => {
      asked.push(url);
      return json({ files: [] });
    });
    const last = await s.listFiles({ bucket: 'posters', cursor: 'abc' });
    expect(new URL(asked[1]).searchParams.get('cursor')).toBe('abc');
    expect(last).toMatchObject({ files: [], nextCursor: null, hasMore: false });
  });

  it("one file's details", async () => {
    let asked = '';
    g.fetch = jest.fn(async (url: string) => {
      asked = url;
      return json({ path: 'a b/c.png', size: 9, created_at: 'x', updated_at: 'y', metadata: {} });
    });
    const s = new KoolbaseStorage(config, async () => 'tok');
    const info = await s.getFileInfo('posters', 'a b/c.png');
    expect(new URL(asked).searchParams.get('path')).toBe('a b/c.png');
    expect(info).toMatchObject({ path: 'a b/c.png', name: 'c.png', size: 9, publicUrl: null });
  });
});

describe('errors arrive typed', () => {
  const failWith = async (status: number, code?: string) => {
    let expired = 0;
    g.fetch = jest.fn(async () => json({ error: 'no', ...(code ? { code } : {}) }, status));
    const s = new KoolbaseStorage(config, async () => null, async () => {
      expired += 1;
    });
    try {
      await s.getFileInfo('posters', 'x.png');
    } catch (e) {
      return { e, expired };
    }
    throw new Error('expected a failure');
  };

  it.each([
    [503, 'bucket_busy', errors.KoolbaseStorageBusyError],
    [400, 'invalid_cursor', errors.KoolbaseStorageInvalidCursorError],
    [404, 'upload_not_found', errors.KoolbaseUploadNotFoundError],
    [403, 'not_allowed', errors.KoolbaseStoragePermissionError],
  ])('%s %s', async (status, code, Expected) => {
    const { e } = await failWith(status, code);
    expect(e).toBeInstanceOf(Expected);
  });

  it('nobody signed in is not a session that ended', async () => {
    const r = await failWith(401, 'sign_in_required');
    expect(r.e).toBeInstanceOf(errors.KoolbaseStorageSignInRequiredError);
    expect(r.expired).toBe(0);
    const plain = await failWith(401);
    expect(plain.e).toBeInstanceOf(KoolbaseUnauthenticatedError);
    expect(plain.expired).toBe(1);
  });
});
