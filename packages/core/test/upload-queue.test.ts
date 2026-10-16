// S4: several uploads in a queue. Over a fake uploader whose tasks the test
// drives: three at a time; each file its own state and progress; a failure
// never stopping the others; cancel before and during, and not once the
// server is verifying; retry from the start, a replaced task's late report
// ignored; the average progress; whenIdle and clearFinished.

import { KoolbaseUploadQueue, type QueuedUpload } from '../src/upload-queue';
import { KoolbaseUploadCancelledError } from '../src/storage-errors';
import type { KoolbaseUploadProgress, KoolbaseUploadTask } from '../src/storage-transfer';
import type { UploadOptions } from '../src/types';

/** A task the test drives: progress, then done, failed or cancelled. */
class FakeTask {
  listeners = new Set<(p: KoolbaseUploadProgress) => void>();
  current: KoolbaseUploadProgress = { state: 'pending', bytesSent: 0, bytesTotal: 100, fraction: 0, isDone: false };
  resolve!: () => void;
  reject!: (e: Error) => void;
  result = new Promise<unknown>((res, rej) => { this.resolve = () => res({}); this.reject = rej; });
  constructor(public options: UploadOptions) { this.result.catch(() => undefined); }
  onProgress(l: (p: KoolbaseUploadProgress) => void) { this.listeners.add(l); l(this.current); return () => this.listeners.delete(l); }
  emit(state: KoolbaseUploadProgress['state'], sent: number) {
    this.current = { state, bytesSent: sent, bytesTotal: 100, fraction: state === 'verifying' || state === 'completed' ? 1 : sent / 100, isDone: state === 'completed' || state === 'failed' || state === 'cancelled' };
    for (const l of [...this.listeners]) l(this.current);
  }
  cancel() {
    if (this.current.isDone || this.current.state === 'verifying') return false;
    this.emit('cancelled', this.current.bytesSent);
    this.reject(new KoolbaseUploadCancelledError());
    return true;
  }
  succeed() { this.emit('completed', 100); this.resolve(); }
  fail(message = 'refused') { this.emit('failed', this.current.bytesSent); this.reject(new Error(message)); }
}

function uploader() {
  const tasks: FakeTask[] = [];
  return {
    tasks,
    of: (path: string) => tasks.filter((t) => t.options.path === path).pop()!,
    startUpload: (o: UploadOptions) => { const t = new FakeTask(o); tasks.push(t); return t as unknown as KoolbaseUploadTask; },
  };
}

const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const files = (...names: string[]) => names.map((n) => ({ bucket: 'photos', path: `trips/${n}`, file: new Blob([n]) }));
const statuses = (q: KoolbaseUploadQueue) => q.getState().items.map((i: QueuedUpload) => `${i.name}:${i.status}`);

describe('KoolbaseUploadQueue', () => {
  it('runs three at a time, in order, each with its own state; the next starts as one lands', async () => {
    const up = uploader();
    const q = new KoolbaseUploadQueue(up);
    const ids = q.add(files('a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'));
    expect(ids).toEqual(['u1', 'u2', 'u3', 'u4', 'u5']);
    expect(statuses(q)).toEqual(['a.jpg:uploading', 'b.jpg:uploading', 'c.jpg:uploading', 'd.jpg:queued', 'e.jpg:queued']);
    expect(up.tasks.map((t) => t.options.path)).toEqual(['trips/a.jpg', 'trips/b.jpg', 'trips/c.jpg']);
    expect(q.getState()).toMatchObject({ running: true, done: 0, failed: 0 });
    up.of('trips/b.jpg').emit('uploading', 50);
    expect(q.getState().items[1]).toMatchObject({ status: 'uploading', progress: 0.5 });
    up.of('trips/b.jpg').emit('verifying', 100);
    expect(q.getState().items[1].status).toBe('verifying');
    up.of('trips/b.jpg').succeed();
    await settle();
    expect(statuses(q)).toEqual(['a.jpg:uploading', 'b.jpg:done', 'c.jpg:uploading', 'd.jpg:uploading', 'e.jpg:queued']);
    for (const p of ['trips/a.jpg', 'trips/c.jpg', 'trips/d.jpg']) up.of(p).succeed();
    await settle();
    up.of('trips/e.jpg').succeed();
    await settle();
    expect(q.getState()).toMatchObject({ running: false, done: 5, failed: 0, progress: 1 });
  });

  it('a file that fails never stops the others; it can be tried again, from the start', async () => {
    const up = uploader();
    const q = new KoolbaseUploadQueue(up, { concurrency: 2 });
    const [a, b] = q.add(files('a.jpg', 'b.jpg', 'c.jpg'));
    up.of('trips/a.jpg').fail('too big');
    await settle();
    expect(statuses(q)).toEqual(['a.jpg:failed', 'b.jpg:uploading', 'c.jpg:uploading']);
    expect((q.getState().items[0].error as Error).message).toBe('too big');
    expect(q.getState().failed).toBe(1);
    expect(q.retry(b)).toBe(false);
    expect(q.retry(a)).toBe(true);
    expect(q.getState().items[0]).toMatchObject({ status: 'queued', progress: 0, error: null });
    up.of('trips/b.jpg').succeed();
    await settle();
    expect(up.tasks.filter((t) => t.options.path === 'trips/a.jpg')).toHaveLength(2);
    expect(q.getState().items[0].status).toBe('uploading');
  });

  it('cancel: a queued file never starts; one uploading stops; not once verifying', async () => {
    const up = uploader();
    const q = new KoolbaseUploadQueue(up, { concurrency: 1 });
    const [a, b, c] = q.add(files('a.jpg', 'b.jpg', 'c.jpg'));
    expect(q.cancel(b)).toBe(true);
    expect(statuses(q)).toEqual(['a.jpg:uploading', 'b.jpg:cancelled', 'c.jpg:queued']);
    up.of('trips/a.jpg').emit('uploading', 40);
    expect(q.cancel(a)).toBe(true);
    await settle();
    expect(statuses(q)).toEqual(['a.jpg:cancelled', 'b.jpg:cancelled', 'c.jpg:uploading']);
    expect(up.tasks.map((t) => t.options.path)).toEqual(['trips/a.jpg', 'trips/c.jpg']);
    up.of('trips/c.jpg').emit('verifying', 100);
    expect(q.cancel(c)).toBe(false);
    // A cancelled file is not counted in the average.
    expect(q.getState().progress).toBe(1);
    up.of('trips/c.jpg').succeed();
    await settle();
    expect(q.getState()).toMatchObject({ running: false, done: 1 });
  });

  it("a retried file's old task reporting late is ignored", async () => {
    const up = uploader();
    const q = new KoolbaseUploadQueue(up);
    const [a] = q.add(files('a.jpg'));
    const first = up.of('trips/a.jpg');
    first.fail();
    await settle();
    q.retry(a);
    const second = up.of('trips/a.jpg');
    expect(second).not.toBe(first);
    first.emit('uploading', 90);
    expect(q.getState().items[0].progress).toBe(0);
    second.emit('uploading', 30);
    expect(q.getState().items[0].progress).toBe(0.3);
  });

  it('cancelAll, whenIdle and clearFinished', async () => {
    const up = uploader();
    const q = new KoolbaseUploadQueue(up, { concurrency: 1 });
    q.add(files('a.jpg', 'b.jpg', 'c.jpg'));
    let idle = false;
    void q.whenIdle().then(() => { idle = true; });
    up.of('trips/a.jpg').succeed();
    await settle();
    expect(idle).toBe(false);
    q.cancelAll();
    await settle();
    expect(statuses(q)).toEqual(['a.jpg:done', 'b.jpg:cancelled', 'c.jpg:cancelled']);
    expect(idle).toBe(true);
    q.clearFinished();
    expect(q.getState().items).toEqual([]);
    await expect(q.whenIdle()).resolves.toBeUndefined();
  });

  it('notifies on every change; nothing after dispose', async () => {
    const up = uploader();
    const q = new KoolbaseUploadQueue(up);
    const seen: number[] = [];
    q.subscribe(() => seen.push(q.getState().items.length));
    q.add(files('a.jpg'));
    expect(seen.length).toBeGreaterThan(0);
    q.dispose();
    const n = seen.length;
    up.of('trips/a.jpg').succeed();
    await settle();
    expect(seen.length).toBe(n);
    expect(q.add(files('b.jpg'))).toEqual([]);
  });
});
