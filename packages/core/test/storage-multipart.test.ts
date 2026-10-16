// S3: a large file's upload in parts, and a download you can follow.
//
// The server is a scripted fetch: it plans small parts, signs links, lists
// what arrived and completes. The parts go to storage through a stand-in
// XMLHttpRequest that can drop a connection or refuse an expired link.

import { KoolbaseStorage } from '../src/storage';
import * as errors from '../src/storage-errors';
import { KoolbaseNetworkError } from '../src/network';
import { partRetry } from '../src/storage-multipart';
import type { KoolbaseUploadProgress } from '../src/storage-transfer';

const BASE = 'https://api.test';
const config = { publicKey: 'pk_test', baseUrl: BASE } as never;
const PART = 4;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Call = { method: string; url: string; body?: Record<string, unknown> };

/** Storage and the API, as one stand-in. */
class World {
  parts = new Map<number, string>();
  calls: Call[] = [];
  failTimes = new Map<number, number>(); // part -> connection drops before it goes through
  expireOnce = new Set<number>(); // part -> its first link has expired
  linkVersion = new Map<number, number>();
  inFlight = 0;
  maxInFlight = 0;
  onPart: ((n: number) => void) | null = null;
  size = 0;

  fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    this.calls.push({ method, url, body });
    const u = new URL(url);
    if (u.pathname === '/v1/sdk/storage/uploads' && method === 'POST') {
      this.size = body.size;
      return json(this.plan(body.path, body.content_type), 201);
    }
    if (u.pathname === '/v1/sdk/storage/uploads' && method === 'GET') {
      return json({ ...this.plan('talks/keynote.mp4', 'video/mp4'), uploaded: [...this.parts.keys()].sort() });
    }
    if (u.pathname === '/v1/sdk/storage/uploads' && method === 'DELETE') return new Response(null, { status: 204 });
    if (u.pathname === '/v1/sdk/storage/uploads/parts') {
      const links: Record<string, string> = {};
      for (const n of body.parts as number[]) {
        const v = (this.linkVersion.get(n) ?? 0) + 1;
        this.linkVersion.set(n, v);
        links[String(n)] = `https://r2.test/part/${n}?v=${v}`;
      }
      return json({ links });
    }
    if (u.pathname === '/v1/sdk/storage/uploads/complete') {
      const whole = [...this.parts.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]).join('');
      return json({ id: 'o1', project_id: 'p1', bucket_id: 'b1', r2_bucket: 'koolbase-storage', path: 'talks/keynote.mp4', size: whole.length, content_type: 'video/mp4', metadata: {}, created_at: 'x', updated_at: 'y', whole }, 201);
    }
    if (u.pathname === '/v1/sdk/storage/download-url') return json({ url: 'https://r2.test/file' });
    if (u.pathname === '/v1/sdk/storage/upload-url') return json({ upload_url: 'https://r2.test/single', upload_id: 'up-1' });
    if (u.pathname === '/v1/sdk/storage/confirm') return json({ id: 'o1', project_id: 'p1', bucket_id: 'b1', path: body.path, size: body.size, metadata: {}, created_at: 'x', updated_at: 'y' }, 201);
    return json({ error: 'unexpected' }, 500);
  });

  plan(path: string, ct: string) {
    return { upload_id: 'mp-1', path, size: this.size, part_size: PART, part_count: Math.ceil(this.size / PART), content_type: ct };
  }
}

let world: World;

/** Storage's side of a part's PUT, and a download's GET. */
class FakeXHR {
  upload: { onprogress: ((ev: { loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onprogress: ((ev: { loaded: number; total: number; lengthComputable: boolean }) => void) | null = null;
  status = 0;
  method = '';
  url = '';
  responseType = '';
  response: unknown = null;
  aborted = false;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader() {}
  getResponseHeader() {
    return null;
  }
  abort() {
    if (this.aborted) return;
    this.aborted = true;
    world.inFlight--;
    setTimeout(() => this.onabort?.(), 0);
  }
  async send(body?: Blob) {
    if (this.method === 'GET') return this.download();
    const n = Number(/part\/(\d+)/.exec(this.url)?.[1]);
    const v = Number(/v=(\d+)/.exec(this.url)?.[1]);
    const text = await body!.text();
    world.inFlight++;
    world.maxInFlight = Math.max(world.maxInFlight, world.inFlight);
    world.onPart?.(n);
    setTimeout(() => {
      if (this.aborted) return;
      this.upload.onprogress?.({ loaded: Math.floor(text.length / 2), total: text.length });
      setTimeout(() => {
        if (this.aborted) return;
        world.inFlight--;
        const drops = world.failTimes.get(n) ?? 0;
        if (drops > 0) {
          world.failTimes.set(n, drops - 1);
          this.onerror?.();
          return;
        }
        if (world.expireOnce.has(n) && v === 1) {
          this.status = 403;
          this.onload?.();
          return;
        }
        this.upload.onprogress?.({ loaded: text.length, total: text.length });
        world.parts.set(n, text);
        this.status = 200;
        this.onload?.();
      }, 2);
    }, 1);
  }
  download() {
    const data = 'x'.repeat(30);
    let at = 0;
    const step = () => {
      if (this.aborted) return;
      at = Math.min(30, at + 10);
      this.onprogress?.({ loaded: at, total: 30, lengthComputable: true });
      if (at < 30) {
        setTimeout(step, 1);
        return;
      }
      this.status = 200;
      this.response = new Blob([data]);
      this.onload?.();
    };
    setTimeout(step, 1);
  }
}

const g = globalThis as unknown as { fetch: unknown; XMLHttpRequest?: unknown };
const realFetch = g.fetch;
const realThreshold = KoolbaseStorage.multipartThreshold;
const realDelay = partRetry.delayMs;

beforeEach(() => {
  world = new World();
  g.fetch = world.fetch;
  g.XMLHttpRequest = FakeXHR;
  KoolbaseStorage.multipartThreshold = 10;
  partRetry.delayMs = () => 1;
});
afterEach(() => {
  g.fetch = realFetch;
  delete g.XMLHttpRequest;
  KoolbaseStorage.multipartThreshold = realThreshold;
  partRetry.delayMs = realDelay;
});

const file = (s: string) => new Blob([s], { type: 'video/mp4' });
const CONTENT = 'abcdefghijklmnopqrstuvwxyz0123'; // 30 bytes: 8 parts of 4, the last of 2
const whole = () => [...world.parts.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]).join('');
const storage = () => new KoolbaseStorage(config, async () => 'tok');
const called = (path: string, method = 'POST') => world.calls.filter((c) => new URL(c.url).pathname === path && c.method === method);

describe('a large file goes up in parts', () => {
  it('every part, a few at a time, the bytes rising to the whole; then completed', async () => {
    const seen: KoolbaseUploadProgress[] = [];
    const task = storage().startUpload({ bucket: 'video', path: 'talks/keynote.mp4', file: file(CONTENT), metadata: { talk: 'keynote' } });
    task.onProgress((p) => seen.push(p));
    const res = await task.result;
    expect(whole()).toBe(CONTENT);
    expect(res.object.path).toBe('talks/keynote.mp4');
    expect(task.uploadId).toBe('mp-1');
    expect(called('/v1/sdk/storage/uploads')[0].body).toMatchObject({ bucket: 'video', path: 'talks/keynote.mp4', content_type: 'video/mp4', size: 30 });
    expect(called('/v1/sdk/storage/uploads/complete')[0].body).toEqual({ bucket: 'video', upload_id: 'mp-1', overwrite: false, metadata: { talk: 'keynote' } });
    expect(called('/v1/sdk/storage/upload-url')).toHaveLength(0);
    expect(world.maxInFlight).toBeGreaterThan(1);
    expect(world.maxInFlight).toBeLessThanOrEqual(3);
    const sent = seen.filter((p) => p.state === 'uploading').map((p) => p.bytesSent);
    expect(sent.length).toBeGreaterThan(8);
    expect(Math.max(...sent)).toBe(30);
    expect(seen.map((p) => p.state)).toEqual(expect.arrayContaining(['verifying', 'completed']));
  });

  it('a dropped part is sent again; an expired link is renewed', async () => {
    world.failTimes.set(2, 2);
    world.expireOnce.add(5);
    await storage().startUpload({ bucket: 'video', path: 'talks/keynote.mp4', file: file(CONTENT) }).result;
    expect([...world.parts.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(world.linkVersion.get(5)).toBe(2);
    expect(called('/v1/sdk/storage/uploads', 'DELETE')).toHaveLength(0);
  });

  it('a part that keeps failing fails the upload, which resumes later with only what is missing', async () => {
    world.failTimes.set(3, 99);
    const task = storage().startUpload({ bucket: 'video', path: 'talks/keynote.mp4', file: file(CONTENT) });
    await expect(task.result).rejects.toBeInstanceOf(KoolbaseNetworkError);
    expect(task.current.state).toBe('failed');
    expect(task.uploadId).toBe('mp-1');
    expect(called('/v1/sdk/storage/uploads', 'DELETE')).toHaveLength(0); // kept, to resume
    expect(world.parts.has(3)).toBe(false);

    world.failTimes.clear();
    const before = new Set(world.parts.keys());
    const sentAgain: number[] = [];
    world.onPart = (n) => sentAgain.push(n);
    const resumed = storage().resumeUpload({ bucket: 'video', uploadId: 'mp-1', file: file(CONTENT) });
    const res = await resumed.result;
    expect(whole()).toBe(CONTENT);
    expect(res.object.path).toBe('talks/keynote.mp4');
    for (const n of sentAgain) expect(before.has(n)).toBe(false);
    expect(sentAgain).toContain(3);
  });

  it('resuming with another file is refused', async () => {
    world.size = 30;
    await expect(storage().resumeUpload({ bucket: 'video', uploadId: 'mp-1', file: file('short') }).result).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('cancelled while sending: the parts in flight stop, and the upload is abandoned', async () => {
    const task = storage().startUpload({ bucket: 'video', path: 'talks/keynote.mp4', file: file(CONTENT) });
    world.onPart = (n) => {
      if (n === 2) task.cancel();
    };
    await expect(task.result).rejects.toBeInstanceOf(errors.KoolbaseUploadCancelledError);
    expect(task.current.state).toBe('cancelled');
    expect(called('/v1/sdk/storage/uploads', 'DELETE')[0].body).toEqual({ bucket: 'video', upload_id: 'mp-1' });
    expect(called('/v1/sdk/storage/uploads/complete')).toHaveLength(0);
  });

  it('a small file still goes in one piece', async () => {
    await storage().upload({ bucket: 'video', path: 'a.txt', file: file('tiny') });
    expect(called('/v1/sdk/storage/upload-url')).toHaveLength(1);
    expect(called('/v1/sdk/storage/uploads')).toHaveLength(0);
  });

  it('an incomplete upload is typed, with what is missing', () => {
    const e = errors.koolbaseStorageError(409, { code: 'upload_incomplete', error: 'x', details: { missing: [2, 5] } });
    expect(e).toBeInstanceOf(errors.KoolbaseUploadIncompleteError);
    expect((e as errors.KoolbaseUploadIncompleteError).missing).toEqual([2, 5]);
  });
});

describe('a download you can follow', () => {
  it('reports the bytes as they arrive', async () => {
    const seen: [number, number | null][] = [];
    const blob = await storage().download({ bucket: 'video', path: 'a.mp4', onProgress: (r, t) => seen.push([r, t]) });
    expect(blob.size).toBe(30);
    expect(seen[0]).toEqual([10, 30]);
    expect(seen[seen.length - 1]).toEqual([30, 30]);
  });

  it('a signal stops it', async () => {
    const ctl = new AbortController();
    const p = storage().download({ bucket: 'video', path: 'a.mp4', signal: ctl.signal, onProgress: () => ctl.abort() });
    await expect(p).rejects.toBeInstanceOf(errors.KoolbaseDownloadCancelledError);
  });

  it('without XMLHttpRequest, a streamed fetch', async () => {
    delete g.XMLHttpRequest;
    const base = world.fetch;
    g.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://r2.test/file') {
        const enc = new TextEncoder();
        const stream = new ReadableStream({
          start(c) {
            c.enqueue(enc.encode('12345'));
            c.enqueue(enc.encode('67890'));
            c.close();
          },
        });
        return new Response(stream, { headers: { 'content-length': '10' } });
      }
      return base(url, init);
    });
    const seen: number[] = [];
    const blob = await storage().download({ bucket: 'video', path: 'a.mp4', onProgress: (r) => seen.push(r) });
    expect(await blob.text()).toBe('1234567890');
    expect(seen).toEqual([0, 5, 10]);
  });
});
