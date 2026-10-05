import { KoolbaseDatabase } from '../src/database';
import { KoolbaseConnectivity } from '../src/connectivity';
import { KoolbaseRecordController } from '../src/record-controller';
import { cacheRecord } from '../src/cache-store';
import { setPlatform, getPlatform } from '../src/platform';
import { testPlatform } from './platform';

/** Offline observability (12.14.0): connectivity, live offline state, saved-first. */

const reply = (status: number, body: any) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (body === null ? '' : JSON.stringify(body)),
  json: async () => body,
});
const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
};
const offline = () => jest.fn().mockRejectedValue(new TypeError('Network request failed'));

describe('connectivity', () => {
  let emit: (online: boolean) => void;
  let answer: (v: boolean | null) => void;

  beforeEach(async () => {
    const base = await testPlatform();
    setPlatform({
      ...base,
      network: {
        onChange: (cb) => { emit = cb; return () => {}; },
        current: () => new Promise<boolean | null>((resolve) => { answer = resolve; }),
      },
    });
  });

  it('is unknown until the platform answers, then follows it', async () => {
    const c = new KoolbaseConnectivity();
    let changes = 0;
    c.subscribe(() => { changes += 1; });
    c.start();
    expect(c.getState()).toBe('unknown');
    answer(false);
    await settle();
    expect(c.getState()).toBe('offline');
    emit(true);
    expect(c.getState()).toBe('online');
    expect(changes).toBe(2);
  });

  it('a platform that cannot tell leaves it unknown', async () => {
    const c = new KoolbaseConnectivity();
    c.start();
    answer(null);
    await settle();
    expect(c.getState()).toBe('unknown');
  });

  it('a change event beats a late first answer', async () => {
    const c = new KoolbaseConnectivity();
    c.start();
    emit(true);
    answer(false);
    await settle();
    expect(c.getState()).toBe('online');
  });
});

describe('live offline state', () => {
  const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as any;
  let user: string | null;
  const db = () => new KoolbaseDatabase(config, () => user, async () => 'token');

  beforeEach(async () => {
    user = 'u1';
    setPlatform(await testPlatform());
  });

  it('pending writes: the list at once, again on every change; null signed out', async () => {
    const client = db();
    const seen: (number | null)[] = [];
    const off = client.watchPendingWrites((w) => seen.push(w === null ? null : w.length));
    await settle();
    expect(seen).toEqual([0]);

    global.fetch = offline();
    await client.insert('notes', { text: 'a' });
    await settle();
    expect(seen[seen.length - 1]).toBe(1);

    user = null;
    client.sessionChanged();
    await settle();
    expect(seen[seen.length - 1]).toBeNull();
    off();
  });

  it('another tab changing the state is heard (broadcast)', async () => {
    const posted: string[] = [];
    let deliver: (m: string) => void = () => {};
    setPlatform({
      ...getPlatform(),
      broadcast: {
        post: (m) => posted.push(m),
        on: (cb) => { deliver = cb; return () => {}; },
      },
    });
    const client = db();
    let calls = 0;
    const off = client.watchPendingWrites(() => { calls += 1; });
    await settle();
    expect(calls).toBe(1);

    deliver('koolbase:offline-state:u1');
    await settle();
    expect(calls).toBe(2);

    global.fetch = offline();
    await client.insert('notes', { text: 'a' });
    expect(posted).toContain('koolbase:offline-state:u1');
    off();
  });

  it('conflicts are watched the same way', async () => {
    const client = db();
    const seen: (number | null)[] = [];
    const off = client.watchConflicts((c) => seen.push(c === null ? null : c.length));
    await settle();
    expect(seen).toEqual([0]);
    off();
  });
});

describe('saved-first records and saved lists', () => {
  const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as any;
  const db = () => new KoolbaseDatabase(config, () => 'u1', async () => 'token');

  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('getSaved: the saved copy, with offline changes applied; never the network', async () => {
    await cacheRecord('u1', 'songs', 'r1', { title: 'Accra Nights', plays: 1 }, 3);
    global.fetch = offline();
    const client = db();
    expect((await client.getSaved('r1'))?.data).toEqual({ title: 'Accra Nights', plays: 1 });
    await client.update('r1', { plays: 2 });
    const before = (global.fetch as jest.Mock).mock.calls.length;
    const saved = await client.getSaved('r1');
    expect(saved?.data).toEqual({ title: 'Accra Nights', plays: 2 });
    expect(saved?.collection).toBe('songs');
    expect(await client.getSaved('never-seen')).toBeNull();
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(before); // never the network
  });

  it('offline: the saved copy shows, isSaved stays true', async () => {
    await cacheRecord('u1', 'songs', 'r1', { title: 'Accra Nights' }, 3);
    global.fetch = offline();
    const c = new KoolbaseRecordController(db(), 'songs', 'r1');
    await c.load();
    expect(c.getState().status).toBe('loaded');
    expect(c.getState().isSaved).toBe(true);
    expect(c.getState().record?.data).toEqual({ title: 'Accra Nights' });
  });

  it('online: the server answer replaces the saved copy, isSaved false', async () => {
    await cacheRecord('u1', 'songs', 'r1', { title: 'Old' }, 3);
    const states: boolean[] = [];
    global.fetch = jest.fn().mockResolvedValue(reply(200, { $id: 'r1', $revision: 4, title: 'New' }));
    const c = new KoolbaseRecordController(db(), 'songs', 'r1');
    c.subscribe(() => states.push(c.getState().isSaved));
    await c.load();
    expect(states[0]).toBe(true); // the saved copy, first
    expect(c.getState().status).toBe('loaded');
    expect(c.getState().isSaved).toBe(false);
  });

  it('no saved copy and no network: the ordinary error state, not isSaved', async () => {
    global.fetch = offline();
    const c = new KoolbaseRecordController(db(), 'songs', 'r1');
    await c.load();
    expect(c.getState().status).toBe('error');
    expect(c.getState().isSaved).toBe(false);
  });

  it('a saved copy the server says is gone becomes notFound', async () => {
    await cacheRecord('u1', 'songs', 'r1', { title: 'Old' }, 3);
    global.fetch = jest.fn().mockResolvedValue(reply(404, { code: 'record_not_found', error: 'no such record' }));
    const c = new KoolbaseRecordController(db(), 'songs', 'r1');
    await c.load();
    expect(c.getState().status).toBe('notFound');
    expect(c.getState().isSaved).toBe(false);
  });

  it('an offline edit shows in the saved list; an offline delete leaves it', async () => {
    global.fetch = jest.fn().mockResolvedValue(reply(200, {
      records: [
        { $id: 'r1', $revision: 1, title: 'a' },
        { $id: 'r2', $revision: 1, title: 'b' },
      ],
      total: 2,
    }));
    const client = db();
    await client.query('songs', {});
    await cacheRecord('u1', 'songs', 'r1', { title: 'a' }, 1);
    await cacheRecord('u1', 'songs', 'r2', { title: 'b' }, 1);

    global.fetch = offline();
    await client.update('r1', { title: 'a2' });
    await client.delete('r2');

    const res = await client.query('songs', {});
    expect(res.isFromCache).toBe(true);
    expect(res.records.map((r: any) => r.id)).toEqual(['r1']);
    expect((res.records[0] as any).data.title).toBe('a2');
    expect(res.total).toBe(1);
  });
});
