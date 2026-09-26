import { KoolbaseDatabase } from '../src/database';
import { KoolbaseRecordController } from '../src/record-controller';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

const config = { baseUrl: 'https://api.test', publicKey: 'pk_test' } as any;
const db = () => new KoolbaseDatabase(config, () => 'user-1', async () => 'token');

const wire = (id: string, collection: string, title: string) => ({
  $id: id,
  $collection: collection,
  $createdAt: '2026-09-26T00:00:00Z',
  $updatedAt: '2026-09-26T00:00:00Z',
  title,
});

type Reply = { status: number; body: unknown } | 'offline';

/** Answers every request with reply(url); returns the URLs requested. */
function serve(reply: (url: string) => Reply | Promise<Reply>): string[] {
  const urls: string[] = [];
  global.fetch = jest.fn(async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    const r = await reply(url);
    if (r === 'offline') throw new TypeError('Network request failed');
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return urls;
}

function gate() {
  let release: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, open: () => release() };
}

async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const notFound = { status: 404, body: { error: 'record not found', code: 'record_not_found' } };

describe('KoolbaseRecordController', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('loads one record by id', async () => {
    const urls = serve(() => ({ status: 200, body: wire('r1', 'songs', 'Harmattan Blues') }));
    const c = new KoolbaseRecordController(db(), 'songs', 'r1');
    expect(c.getState().status).toBe('loading');

    await c.load();

    expect(c.getState().status).toBe('loaded');
    expect(c.getState().record?.data.title).toBe('Harmattan Blues');
    expect(urls[0]).toMatch(/\/v1\/sdk\/db\/records\/r1$/);
  });

  it('is notFound, not an error, when the API says not found (missing or not allowed)', async () => {
    serve(() => notFound);
    const c = new KoolbaseRecordController(db(), 'songs', 'gone');
    await c.load();
    expect(c.getState().status).toBe('notFound');
    expect(c.getState().error).toBeNull();
  });

  it('is notFound with no request when there is no id', async () => {
    const urls = serve(() => ({ status: 200, body: wire('r1', 'songs', 'x') }));
    const c = new KoolbaseRecordController(db(), 'songs', '');
    await c.load();
    expect(c.getState().status).toBe('notFound');
    expect(urls).toHaveLength(0);
  });

  it('is notFound when the id belongs to another collection', async () => {
    serve(() => ({ status: 200, body: wire('u1', 'users', 'secret') }));
    const c = new KoolbaseRecordController(db(), 'songs', 'u1');
    await c.load();
    expect(c.getState().status).toBe('notFound');
    expect(c.getState().record).toBeNull();
  });

  it('is the error state when the first load fails', async () => {
    serve(() => 'offline');
    const c = new KoolbaseRecordController(db(), 'songs', 'r1');
    await c.load();
    expect(c.getState().status).toBe('error');
    expect(c.getState().error).toBeTruthy();
  });

  it('keeps the record when a refresh fails, and stops refreshing', async () => {
    serve(() => ({ status: 200, body: wire('r1', 'songs', 'Harmattan Blues') }));
    const c = new KoolbaseRecordController(db(), 'songs', 'r1');
    await c.load();

    serve(() => 'offline');
    const refreshing = c.refresh();
    expect(c.getState().refreshing).toBe(true);
    await refreshing;

    expect(c.getState().refreshing).toBe(false);
    expect(c.getState().status).toBe('loaded');
    expect(c.getState().record?.data.title).toBe('Harmattan Blues');
  });

  it('is notFound when a refresh finds the record deleted', async () => {
    serve(() => ({ status: 200, body: wire('r1', 'songs', 'Harmattan Blues') }));
    const c = new KoolbaseRecordController(db(), 'songs', 'r1');
    await c.load();

    serve(() => notFound);
    await c.refresh();

    expect(c.getState().status).toBe('notFound');
    expect(c.getState().record).toBeNull();
  });

  it('ignores a result that lands after dispose', async () => {
    const g = gate();
    serve(async () => {
      await g.opened;
      return { status: 200, body: wire('r1', 'songs', 'late') };
    });
    const c = new KoolbaseRecordController(db(), 'songs', 'r1');
    const listener = jest.fn();
    c.subscribe(listener);
    const loading = c.load();

    c.dispose();
    g.open();
    await loading;
    await settle();

    expect(listener).not.toHaveBeenCalled();
    expect(c.getState().status).toBe('loading');
  });
});
