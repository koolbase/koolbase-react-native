// R125 (A5): a shown record follows the app's own writes to its collection,
// as a list does -- online, the server's answer; offline, the device's saved
// copy, which holds the queued change. Before, it kept its old values until
// the screen was opened again.
import { KoolbaseDatabase } from '../src/database';
import { KoolbaseRecordController } from '../src/record-controller';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

const config = { baseUrl: 'https://api.test', publicKey: 'pk_test' } as any;

const wire = (title: string, revision: number) => ({
  $id: 'r1',
  $collection: 'notes',
  $createdAt: '2026-09-26T00:00:00Z',
  $updatedAt: '2026-09-26T00:00:00Z',
  $revision: revision,
  title,
});

type Reply = { status: number; body: unknown } | 'offline';

function serve(reply: (url: string, init?: RequestInit) => Reply): string[] {
  const calls: string[] = [];
  global.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(input)}`);
    const r = reply(String(input), init);
    if (r === 'offline') throw new TypeError('Network request failed');
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return calls;
}

async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const titleOf = (c: KoolbaseRecordController) => (c.getState().record?.data as { title?: string } | undefined)?.title;

describe('a shown record after the app writes (R125)', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('online: shows the server\'s answer, with no refresh asked for', async () => {
    let server = wire('Water plants', 1);
    serve((url, init) => {
      if (init?.method === 'PATCH') {
        server = wire('Water the garden', 2);
        return { status: 200, body: server };
      }
      return { status: 200, body: server };
    });
    const db = new KoolbaseDatabase(config, () => 'user-1', async () => 'token');
    const c = new KoolbaseRecordController(db, 'notes', 'r1');
    await c.load();
    expect(titleOf(c)).toBe('Water plants');
    await db.update('r1', { title: 'Water the garden' });
    await settle();
    expect(titleOf(c)).toBe('Water the garden');
    expect(c.getState().refreshing).toBe(false);
    c.dispose();
  });

  it('offline: shows the queued change from the saved copy', async () => {
    let offline = false;
    serve(() => (offline ? 'offline' : { status: 200, body: wire('Water plants', 1) }));
    const db = new KoolbaseDatabase(config, () => 'user-1', async () => 'token');
    const c = new KoolbaseRecordController(db, 'notes', 'r1');
    await c.load();
    expect(titleOf(c)).toBe('Water plants');
    offline = true;
    await db.update('r1', { title: 'Water the garden' });
    await settle();
    expect(titleOf(c)).toBe('Water the garden');
    expect(c.getState().isSaved).toBe(true);
    c.dispose();
  });

  it('a disposed record hears nothing', async () => {
    serve(() => ({ status: 200, body: wire('Water plants', 1) }));
    const db = new KoolbaseDatabase(config, () => 'user-1', async () => 'token');
    const c = new KoolbaseRecordController(db, 'notes', 'r1');
    await c.load();
    c.dispose();
    await db.update('r1', { title: 'x' });
    await settle();
    expect(c.getState().status).toBe('loaded');
  });
});
