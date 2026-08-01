import {
  mutateOfflineState,
  readOfflineState,
  OfflineStateTooLargeError,
} from '../src/offline-state';

describe('offline state', () => {
  beforeEach(async () => {
    const store = await import('./mocks/async-storage');
    (store.default as any).__reset();
  });

  /**
   * A single setItem is one storage operation, but read-modify-write is not.
   * Without a lock, two callers both read, both modify, and the second write
   * discards the first — two components queueing a write in the same tick is
   * enough to lose one.
   */
  it('concurrent mutations do not overwrite each other', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        mutateOfflineState('user-1', (s) => {
          s.pending.push({
            id: `w${i}`,
            operation: 'insert',
            collection: 'things',
            retries: 0,
            enqueuedAt: new Date().toISOString(),
          });
        })
      )
    );

    const state = await readOfflineState('user-1');
    expect(state.pending).toHaveLength(20);
    expect(new Set(state.pending.map((w) => w.id)).size).toBe(20);
  });

  /**
   * Moving a write from pending to conflicts is one storage write, so a crash
   * cannot leave it in both or neither. Across two keys it could.
   */
  it('a write moves to conflicts atomically', async () => {
    await mutateOfflineState('user-1', (s) => {
      s.pending.push({
        id: 'w1',
        operation: 'update',
        collection: 'things',
        recordId: 'rec-1',
        data: { a: 2 },
        baseline: { a: 1 },
        baseRevision: 3,
        retries: 0,
        enqueuedAt: new Date().toISOString(),
      });
    });

    await mutateOfflineState('user-1', (s) => {
      const w = s.pending.shift()!;
      s.conflicts.push({
        id: w.id,
        reason: 'concurrent_modification',
        operation: 'update',
        collection: w.collection,
        recordId: w.recordId!,
        local: w.data,
        baseline: w.baseline,
        baseRevision: w.baseRevision,
        serverRevision: 5,
        createdAt: new Date().toISOString(),
      });
    });

    const state = await readOfflineState('user-1');
    expect(state.pending).toHaveLength(0);
    expect(state.conflicts).toHaveLength(1);
    expect(state.conflicts[0].baseRevision).toBe(3);
  });

  /**
   * A queue that cannot be written is a queue that silently stops accepting
   * work. Better to refuse loudly than to grow past what storage will hold.
   */
  it('refuses state that is too large to store', async () => {
    const big = 'x'.repeat(200_000);
    await expect(
      mutateOfflineState('user-1', (s) => {
        for (let i = 0; i < 10; i++) {
          s.pending.push({
            id: `big${i}`,
            operation: 'insert',
            collection: 'things',
            data: { blob: big },
            retries: 0,
            enqueuedAt: '',
          });
        }
      })
    ).rejects.toBeInstanceOf(OfflineStateTooLargeError);

    // And the rejected mutation left nothing behind.
    expect((await readOfflineState('user-1')).pending).toHaveLength(0);
  });

  it('is empty for a user with nothing queued', async () => {
    expect(await readOfflineState('user-2')).toEqual({ pending: [], conflicts: [] });
  });
});
