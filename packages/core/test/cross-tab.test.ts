import { KoolbaseDatabase } from '../src/database';
import { getPlatform, setPlatform, type PlatformAdapter, type PlatformLocks } from '../src/platform';
import { testPlatform } from './platform';

// Two tabs, one store.
//
// Each KoolbaseDatabase builds its own SyncEngine, so two of them over one
// platform is exactly two tabs of the same app: separate in-process state,
// shared durable storage. What stops them replaying the same queued write is
// the flush lease, and these prove it does.
//
// The memory platform's locks just run the function — correct for one
// process, useless for this test — so the fixture installs contended locks
// that behave like Web Locks: exclusive() waits, tryExclusive() refuses.

function contendedLocks(): PlatformLocks {
  const held = new Set<string>();
  const waiters = new Map<string, Array<() => void>>();

  return {
    async exclusive<T>(name: string, fn: () => Promise<T>): Promise<T> {
      while (held.has(name)) {
        await new Promise<void>((resolve) => {
          const q = waiters.get(name) ?? [];
          q.push(resolve);
          waiters.set(name, q);
        });
      }
      held.add(name);
      try {
        return await fn();
      } finally {
        held.delete(name);
        waiters.get(name)?.shift()?.();
      }
    },
    async tryExclusive(name: string, fn: () => Promise<void>): Promise<{ ran: boolean }> {
      if (held.has(name)) return { ran: false };
      held.add(name);
      try {
        await fn();
        return { ran: true };
      } finally {
        held.delete(name);
        waiters.get(name)?.shift()?.();
      }
    },
  };
}

async function installContendedPlatform(): Promise<void> {
  const base: PlatformAdapter = await testPlatform();
  setPlatform({ ...base, locks: contendedLocks() });
}

const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as never;
const user = 'u1';
const db = () => new KoolbaseDatabase(config, () => user, async () => 'token');

describe('two tabs over one offline queue', () => {
  beforeEach(async () => {
    await installContendedPlatform();
    jest.useRealTimers();
  });

  it('replays a queued write once, not once per tab', async () => {
    // Queue offline: the network refuses, so the write is stored rather than
    // sent, and both tabs will find it.
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed')) as never;
    const rec = await db().insert('expenses', { amount: 10 });
    expect((await db().pendingWrites()).length).toBe(1);

    // Both tabs come back online at the same moment and both flush. Count
    // what actually reaches the server — a consistent final state would also
    // be true if the write were sent twice and the second reply ignored.
    const sent: string[] = [];
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      sent.push(String(url));
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ $id: rec.id, $revision: 1 }),
        json: async () => ({ $id: rec.id, $revision: 1 }),
      };
    }) as never;

    const tabA = db();
    const tabB = db();
    await Promise.all([tabA.syncPendingWrites(), tabB.syncPendingWrites()]);

    const writes = sent.filter((u) => !u.includes('/health'));
    expect(writes.length).toBe(1);
    expect((await db().pendingWrites()).length).toBe(0);
  });

  it('a write queued while another tab is flushing is not stranded', async () => {
    // The race the lease creates: tab A takes it, reads the queue, and tab B
    // enqueues immediately after. B's flush is refused. Nothing may leave
    // that write sitting until an unrelated reconnect.
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed')) as never;
    await db().insert('expenses', { amount: 1 });

    let releaseA: () => void = () => {};
    const aInFlight = new Promise<void>((r) => { releaseA = r; });

    const sent: string[] = [];
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      sent.push(String(url));
      await aInFlight;            // hold tab A inside its pass
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ $id: 'x', $revision: 1 }),
        json: async () => ({ $id: 'x', $revision: 1 }),
      };
    }) as never;

    const tabA = db();
    const a = tabA.syncPendingWrites();

    // Tab B tries while A holds the lease, and is refused.
    const tabB = db();
    await tabB.syncPendingWrites();

    releaseA();
    await a;

    // Whatever was queued must end up sent, by A's pass or by B's recheck.
    // The recheck is on a timer, so allow for it rather than asserting
    // immediately.
    await new Promise((r) => setTimeout(r, 2000));
    expect(await db().pendingWrites()).toEqual([]);
  }, 10000);

  it('state mutations from two tabs do not lose each other', async () => {
    // The other lock: a read-modify-write of the whole state object. Without
    // it, two tabs enqueueing at once means one reads, the other reads, and
    // the second write overwrites the first.
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed')) as never;

    await Promise.all([
      db().insert('expenses', { amount: 1 }),
      db().insert('expenses', { amount: 2 }),
      db().insert('expenses', { amount: 3 }),
    ]);

    const pending = await db().pendingWrites();
    expect(pending.length).toBe(3);
  });
});
