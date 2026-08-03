import { KoolbaseDatabase } from '../src/database';

/**
 * Tonight's chain break, pinned. Offline: insert → update → update, one
 * record. The insert replayed and the server minted its own id because the
 * queued payload carried none — every follow-up update then addressed an id
 * the server had never heard of: terminal rejection, chain dead, record
 * frozen at birth state. Device-proven twice (rejections on local_aghw...,
 * then on a UUID the payload failed to carry).
 *
 * The fix is identity, not remapping: record ids are UUID v4 from birth and
 * travel inside the queued data, so the server honors them and before-sync
 * and after-sync are the same string. These tests keep that true — the mock
 * server below honors data.id exactly like the real one, and mints its own
 * when absent, which is what makes breaking generateRecordId fail loudly.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('offline chain identity', () => {
  const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as any;
  let user: string | null;
  const db = () => new KoolbaseDatabase(config, () => user, async () => 'token');

  beforeEach(async () => {
    user = 'u1';
    const store = await import('./mocks/async-storage');
    (store.default as any).__reset();
  });

  it('an offline insert queues a UUID id inside its payload', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    const rec = await db().insert('expenses', { amount: 10 });

    expect(rec.id).toMatch(UUID_RE);

    const pending = await db().pendingWrites();
    expect(pending).toHaveLength(1);
    expect((pending[0].data as any)?.id).toBe(rec.id);
  });

  it('a chained update addresses the same id the insert will land under', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    const client = db();
    const rec = await client.insert('expenses', { amount: 10 });
    await client.update(rec.id, { amount: 93 });

    const pending = await client.pendingWrites();
    expect(pending).toHaveLength(2);
    expect(pending[1].recordId).toBe(rec.id);
    expect((pending[0].data as any)?.id).toBe(rec.id);
  });

  it('the chain replays whole: server honors the id, updates land on it', async () => {
    const netinfo = require('@react-native-community/netinfo').default as any;

    // Offline phase — pinned: the engine must not flush while we stage.
    netinfo.fetch = async () => ({ isConnected: false, isInternetReachable: false });
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    const client = db();
    const rec = await client.insert('expenses', { amount: 10 });
    await client.update(rec.id, { amount: 44 });
    await client.update(rec.id, { amount: 93 });

    // Reconnect: connectivity restored, and a server that honors data.id —
    // minting its own when absent, exactly like production. Updates PATCH
    // /v1/sdk/db/records/<id> and 404 unless the id exists.
    netinfo.fetch = async () => ({ isConnected: true, isInternetReachable: true });
    const rows = new Map<string, any>();
    const reply = (status: number, body: any) => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
      json: async () => body,
    });
    (global.fetch as jest.Mock).mockImplementation(async (url: string, init: any) => {
      const u = String(url);
      if (u.endsWith('/v1/sdk/db/insert')) {
        const body = JSON.parse(init.body);
        const suppliedId = body.data?.id;
        const id = (typeof suppliedId === 'string' && UUID_RE.test(suppliedId))
          ? suppliedId
          : `server-minted-${rows.size}`;
        rows.set(id, { ...body.data, $id: id, $revision: 1 });
        return reply(201, rows.get(id));
      }
      const m = u.match(/\/v1\/sdk\/db\/records\/([^/?]+)/);
      const id = m?.[1] ?? '';
      if (!rows.has(id)) {
        return reply(404, { code: 'record_not_found', error: 'no such record' });
      }
      const row = rows.get(id);
      const body = JSON.parse(init.body);
      const next = { ...row, ...body.data, $revision: row.$revision + 1 };
      rows.set(id, next);
      return reply(200, next);
    });

    await client.syncPendingWrites();

    expect(await client.pendingWrites()).toHaveLength(0);
    expect(await client.conflicts()).toHaveLength(0);
    const landed = rows.get(rec.id);
    expect(landed).toBeDefined();
    expect(landed.amount).toBe(93);
    expect(landed.$revision).toBe(3);
  });

  it('a replayed delete evicts the cache — no ghost served after sync', async () => {
    const netinfo = require('@react-native-community/netinfo').default as any;

    // Online phase: insert + query so the record enters the query cache.
    netinfo.fetch = async () => ({ isConnected: true, isInternetReachable: true });
    const rows = new Map<string, any>();
    const reply = (status: number, body: any) => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => (body === null ? '' : JSON.stringify(body)),
      json: async () => body,
    });
    const serverMock = async (url: string, init: any) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      if (u.endsWith('/v1/sdk/db/insert')) {
        const body = JSON.parse(init.body);
        const id = body.data?.id ?? `srv-${rows.size}`;
        rows.set(id, { ...body.data, $id: id, $revision: 1 });
        return reply(201, rows.get(id));
      }
      if (u.endsWith('/v1/sdk/db/query')) {
        return reply(200, { records: [...rows.values()], total: rows.size });
      }
      const m = u.match(/\/v1\/sdk\/db\/records\/([^/?]+)/);
      const id = m?.[1] ?? '';
      if (method === 'DELETE') {
        rows.delete(id);
        return reply(204, null);
      }
      return reply(404, { code: 'record_not_found', error: 'no such record' });
    };
    global.fetch = jest.fn().mockImplementation(serverMock);

    const client = db();
    const rec = await client.insert('expenses', { amount: 10 });
    await client.query('expenses', {});          // cache now holds the record

    // Offline: queue the delete.
    netinfo.fetch = async () => ({ isConnected: false, isInternetReachable: false });
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));
    await client.delete(rec.id);

    // Reconnect and replay.
    netinfo.fetch = async () => ({ isConnected: true, isInternetReachable: true });
    (global.fetch as jest.Mock).mockImplementation(serverMock);
    await client.syncPendingWrites();

    // The verdict: a query after the replayed delete must not serve the ghost.
    // (SWR may serve cache first — the eviction means the cache no longer
    // holds the record, so even the cached answer is ghost-free.)
    const res = await client.query('expenses', {});
    expect(res.records.map((r: any) => r.id ?? r.$id)).not.toContain(rec.id);
  });
});
