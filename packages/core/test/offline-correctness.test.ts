import { KoolbaseDatabase } from '../src/database';
import { setPlatform } from '../src/platform';
import { mutateOfflineState, readOfflineState } from '../src/offline-state';
import { cacheRecord } from '../src/cache-store';
import { testPlatform } from './platform';

/**
 * Offline correctness (12.13.1). Each case fails on 12.13.0.
 *
 *  - A refused offline add is removed from the saved copies. The earlier test
 *    of this passed by timing: a background refresh happened to replace the
 *    cached list. Here the server never answers a query, so only the SDK's own
 *    removal can make the list right.
 *  - Writes held behind a conflict stay held on later passes.
 *  - Deciding a conflict rebases the writes held behind it.
 */

const reply = (status: number, body: any) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (body === null ? '' : JSON.stringify(body)),
  json: async () => body,
});
const now = () => new Date().toISOString();

describe('offline correctness', () => {
  const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as any;
  const db = () => new KoolbaseDatabase(config, () => 'u1', async () => 'token');

  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('a refused offline add leaves the saved list, with no refresh to hide it', async () => {
    global.fetch = jest.fn().mockImplementation(async (url: string) =>
      String(url).endsWith('/v1/sdk/db/query') ? reply(200, { records: [], total: 0 }) : reply(404, {}),
    );
    const client = db();
    await client.query('expenses', {});

    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));
    const rec = await client.insert('expenses', { amount: 10, title: 'COLLIDE' });

    // From here the server refuses the add and never answers a query.
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/v1/sdk/db/insert')) return reply(409, { code: 'unique_violation', error: 'title must be unique' });
      return reply(503, { error: 'unavailable' });
    });
    await client.syncPendingWrites();
    expect(await client.conflicts()).toHaveLength(1);

    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));
    const res = await client.query('expenses', {});
    expect(res.isFromCache).toBe(true);
    expect(res.records.map((r: any) => r.id)).not.toContain(rec.id);
    expect(res.total).toBe(0);
  });

  const seedConflictWithHeldWrite = () =>
    mutateOfflineState('u1', (s) => {
      s.conflicts.push({
        id: 'c1',
        reason: 'concurrent_modification',
        operation: 'update',
        collection: 'expenses',
        recordId: 'r1',
        local: { amount: 2 },
        baseline: { amount: 1 },
        server: { $id: 'r1', $revision: 5, amount: 5, note: 'server' },
        baseRevision: 3,
        serverRevision: 5,
        createdAt: now(),
      });
      s.pending.push({
        id: 'w2',
        operation: 'update',
        collection: 'expenses',
        recordId: 'r1',
        data: { amount: 3 },
        baseline: { amount: 2 },
        baseRevision: 3,
        retries: 0,
        enqueuedAt: now(),
      });
    });

  it('a write held behind a conflict stays held on a later pass', async () => {
    await seedConflictWithHeldWrite();
    const urls: string[] = [];
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      urls.push(String(url));
      return reply(200, { $id: 'r1', $revision: 9 });
    });
    await db().syncPendingWrites();
    expect(urls.filter((u) => u.includes('/records/r1'))).toHaveLength(0);
    expect((await readOfflineState('u1')).pending.map((w) => w.id)).toEqual(['w2']);
  });

  it('keep theirs rebases the held write onto the server version, and releases it', async () => {
    await seedConflictWithHeldWrite();
    const client = db();
    const [c] = await client.conflicts();
    await c.resolveWithServer();

    const state = await readOfflineState('u1');
    expect(state.conflicts).toHaveLength(0);
    expect(state.pending[0].baseRevision).toBe(5);
    expect(state.pending[0].baseline).toEqual({ amount: 5, note: 'server' });

    const bodies: any[] = [];
    global.fetch = jest.fn().mockImplementation(async (url: string, init: any) => {
      if (String(url).includes('/records/r1')) bodies.push(JSON.parse(init.body));
      return reply(200, { $id: 'r1', $revision: 6, amount: 3 });
    });
    await client.syncPendingWrites();
    expect(bodies).toEqual([{ data: { amount: 3 }, expected_revision: 5 }].map((b) => expect.objectContaining(b)));
    expect((await readOfflineState('u1')).pending).toHaveLength(0);
  });

  it('two offline edits keep the fields neither touched', async () => {
    const client = db();
    await cacheRecord('u1', 'songs', 'r9', { title: 'Accra Nights', plays: 1 }, 3);

    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await client.update('r9', { plays: 2 });
    const second = await client.update('r9', { plays: 3 });

    expect(second.data).toEqual({ title: 'Accra Nights', plays: 3 });
    const state = await readOfflineState('u1');
    expect(state.pending[1].baseline).toEqual({ title: 'Accra Nights', plays: 2 });
    expect((await client.getSaved('r9'))?.data).toEqual({ title: 'Accra Nights', plays: 3 });
  });

  it('abandon rebases like keep theirs', async () => {
    await seedConflictWithHeldWrite();
    const [c] = await db().conflicts();
    await c.abandon();
    const state = await readOfflineState('u1');
    expect(state.conflicts).toHaveLength(0);
    expect(state.pending[0].baseRevision).toBe(5);
  });

  it('keep mine rebases the held write onto what landed', async () => {
    await seedConflictWithHeldWrite();
    global.fetch = jest.fn().mockImplementation(async (url: string) =>
      String(url).includes('/records/r1')
        ? reply(200, { $id: 'r1', $revision: 6, amount: 2, note: 'server' })
        : reply(404, {}),
    );
    const [c] = await db().conflicts();
    await c.resolveWithLocal();
    const state = await readOfflineState('u1');
    expect(state.conflicts).toHaveLength(0);
    expect(state.pending[0].baseRevision).toBe(6);
    expect(state.pending[0].baseline).toEqual({ amount: 2, note: 'server' });
  });
});
