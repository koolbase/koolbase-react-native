import { KoolbaseDatabase } from '../src/database';
import { mutateOfflineState, readOfflineState } from '../src/offline-state';

/**
 * A conflict is durable unresolved state, not an event. Held rather than
 * discarded, surviving restarts, until the application decides — because only
 * the application knows whether a later edit should win.
 */
describe('conflicts', () => {
  const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as any;
  const db = () =>
    new KoolbaseDatabase(config, () => 'user-1', async () => 'token');

  const seedConflict = () =>
    mutateOfflineState('user-1', (s) => {
      s.conflicts.push({
        id: 'c1',
        reason: 'concurrent_modification',
        operation: 'update',
        collection: 'things',
        recordId: 'rec-1',
        local: { label: 'mine' },
        baseline: { label: 'was' },
        server: { label: 'theirs' },
        baseRevision: 3,
        serverRevision: 5,
        createdAt: new Date().toISOString(),
      });
    });

  beforeEach(async () => {
    const store = await import('./mocks/async-storage');
    (store.default as any).__reset();
  });

  it('surfaces both versions and what disagrees', async () => {
    await seedConflict();
    const [c] = await db().conflicts();

    expect(c.local).toEqual({ label: 'mine' });
    expect(c.server).toEqual({ label: 'theirs' });
    expect(c.divergentFields).toEqual(['label']);
    expect(c.reason).toBe('concurrent_modification');
  });

  it('keeping the server version clears it without a write', async () => {
    await seedConflict();
    global.fetch = jest.fn(async () => {
      throw new Error('no request should be made');
    }) as unknown as typeof fetch;

    await (await db().conflicts())[0].resolveWithServer();
    expect((await readOfflineState('user-1')).conflicts).toHaveLength(0);
  });

  // Conditional on the revision the refusal reported: a record that moved again
  // while someone was deciding must not be overwritten unnoticed.
  it('reapplying the local change sends the revision it was refused at', async () => {
    await seedConflict();
    let sent: any = null;
    global.fetch = jest.fn(async (_url: any, init: any) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ $id: 'rec-1', $revision: 6 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await (await db().conflicts())[0].resolveWithLocal();

    expect(sent.data).toEqual({ label: 'mine' });
    expect(sent.expected_revision).toBe(5);
    expect((await readOfflineState('user-1')).conflicts).toHaveLength(0);
  });

  // Clearing before the server accepts would lose the change if the write failed.
  it('a failed resolution leaves the conflict standing', async () => {
    await seedConflict();
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ error: 'nope' }), { status: 403 })
    ) as unknown as typeof fetch;

    await expect(
      (await db().conflicts())[0].resolveWithLocal()
    ).rejects.toBeTruthy();

    expect((await readOfflineState('user-1')).conflicts).toHaveLength(1);
  });

  // An object handed to a UI can sit there while a sync pass resolves it.
  it('resolving something already resolved says so', async () => {
    await seedConflict();
    const [c] = await db().conflicts();
    await c.abandon();

    await expect(c.abandon()).rejects.toMatchObject({
      code: 'conflict_not_found',
    });
  });
});

/**
 * A write can fail three ways, and they need different answers:
 *
 *   the record moved       → held, resolvable against the server's version
 *   the server refused     → held, with what it said; retrying cannot change it
 *   the network is down    → stays pending, retried later
 *
 * Before this, the second and third were the same: retried indefinitely in one
 * SDK, dropped after three attempts in the other. Both silent.
 */
describe('a write the server refuses outright', () => {
  const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as any;

  beforeEach(async () => {
    const store = await import('./mocks/async-storage');
    (store.default as any).__reset();
  });

  const queueUpdate = () =>
    mutateOfflineState('user-1', (s) => {
      s.pending.push({
        id: 'w1',
        operation: 'update',
        collection: 'things',
        recordId: 'rec-1',
        data: { label: 'mine' },
        baseline: { label: 'was' },
        baseRevision: 2,
        retries: 0,
        enqueuedAt: new Date().toISOString(),
      });
    });

  const engine = () =>
    new (require('../src/sync-engine').SyncEngine)(
      config,
      () => 'user-1',
      async () => 'token',
    );

  it('is held with what the server said, not retried', async () => {
    await queueUpdate();
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ error: 'title must not be empty' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    ) as unknown as typeof fetch;

    await engine().flush();

    const { pending, conflicts } = await readOfflineState('user-1');
    expect(pending).toHaveLength(0);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toBe('rejected');
    expect(conflicts[0].message).toBe('title must not be empty');
    expect(conflicts[0].local).toEqual({ label: 'mine' });
  });

  // A role change could later permit it, but a queue holding writes against a
  // maybe is how a retry loop becomes invisible.
  it('treats a permission denial as terminal', async () => {
    await queueUpdate();
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ error: 'not allowed' }), { status: 403 })
    ) as unknown as typeof fetch;

    await engine().flush();

    const { conflicts } = await readOfflineState('user-1');
    expect(conflicts[0]?.reason).toBe('rejected');
  });

  it('leaves a network failure pending, and drops nothing', async () => {
    await queueUpdate();
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    await engine().flush();
    await engine().flush();
    await engine().flush();
    await engine().flush();

    const { pending, conflicts } = await readOfflineState('user-1');
    expect(pending).toHaveLength(1);
    expect(pending[0].retries).toBeGreaterThan(0);
    expect(conflicts).toHaveLength(0);
    // Four attempts. The old contract dropped it after three, silently.
  });
});
