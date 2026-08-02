import { KoolbaseDatabase } from '../src/database';
import { mutateOfflineState } from '../src/offline-state';

/**
 * The queue is the same durable state as conflicts, one step earlier: changes
 * the user believes are saved, existing only on this device. conflicts() got a
 * surfacing API with a warning about invisible accumulation; the queue got
 * nothing — so an app could not show "3 changes waiting" or warn a user
 * logging out with unsynced edits. Queues survive logout by design, so those
 * edits sync whenever that user next signs in on this device. Possibly never.
 */
describe('pendingWrites', () => {
  const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as any;
  const db = (user = 'user-1') =>
    new KoolbaseDatabase(config, () => user, async () => 'token');

  const seed = (userId: string) =>
    mutateOfflineState(userId, (s) => {
      s.pending.push(
        {
          id: 'w1',
          operation: 'insert',
          collection: 'expenses',
          recordId: 'rec-1',
          data: { amount: 50 },
          retries: 0,
          enqueuedAt: '2026-08-01T10:00:00Z',
        },
        {
          id: 'w2',
          operation: 'update',
          collection: 'expenses',
          recordId: 'rec-1',
          data: { amount: 65 },
          baseline: { amount: 50 },
          baseRevision: 1,
          retries: 2,
          enqueuedAt: '2026-08-01T10:01:00Z',
        },
      );
    });

  beforeEach(async () => {
    const store = await import('./mocks/async-storage');
    (store.default as any).__reset();
  });

  it('is empty with nothing queued', async () => {
    expect(await db().pendingWrites()).toEqual([]);
  });

  it('returns queued writes, oldest first, with their public fields', async () => {
    await seed('user-1');
    const pending = await db().pendingWrites();

    expect(pending).toHaveLength(2);
    expect(pending[0]).toEqual({
      id: 'w1',
      operation: 'insert',
      collection: 'expenses',
      recordId: 'rec-1',
      data: { amount: 50 },
      enqueuedAt: '2026-08-01T10:00:00Z',
      attempts: 0,
    });
    expect(pending[1].attempts).toBe(2);
  });

  /**
   * The contract test. baseline and baseRevision are replay mechanics; the
   * projection names each public field precisely so new internals stay
   * internal. If this fails, someone switched the mapper to a spread — that is
   * the change being prevented, not a formality.
   */
  it('never leaks replay internals', async () => {
    await seed('user-1');
    for (const w of await db().pendingWrites()) {
      expect(w).not.toHaveProperty('baseline');
      expect(w).not.toHaveProperty('baseRevision');
      expect(w).not.toHaveProperty('retries');
    }
  });

  it('is per-user', async () => {
    await seed('user-2');
    expect(await db('user-1').pendingWrites()).toEqual([]);
    expect(await db('user-2').pendingWrites()).toHaveLength(2);
  });
});
