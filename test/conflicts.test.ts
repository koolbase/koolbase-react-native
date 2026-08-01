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
