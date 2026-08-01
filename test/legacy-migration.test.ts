import AsyncStorage from './mocks/async-storage';
import { migrateLegacyQueue, readOfflineState } from '../src/offline-state';

/**
 * Writes queued by an earlier version sit under a different key. Left there,
 * they would never replay — the user believes they synced, and they sit on disk
 * forever.
 *
 * Inserts port cleanly. Updates and deletes do not: they were queued before
 * baselines were recorded, so replaying one would apply it blindly and
 * overwrite whatever changed in the meantime. They are preserved as waiting for
 * a decision — the change is not lost, and nothing is written on a guess.
 */
describe('migrating a legacy queue', () => {
  const legacyKey = 'koolbase:v1:user-1:write_queue';

  beforeEach(() => (AsyncStorage as any).__reset());

  const seed = (writes: unknown[]) =>
    AsyncStorage.setItem(legacyKey, JSON.stringify(writes));

  it('carries an insert across, still replayable', async () => {
    await seed([
      { id: 'w1', type: 'insert', collection: 'things', data: { a: 1 }, retries: 0, createdAt: 'then' },
    ]);

    await migrateLegacyQueue('user-1');

    const { pending, conflicts } = await readOfflineState('user-1');
    expect(pending).toHaveLength(1);
    expect(pending[0].operation).toBe('insert');
    expect(pending[0].data).toEqual({ a: 1 });
    expect(conflicts).toHaveLength(0);
  });

  it('holds an update for a decision rather than replaying it blindly', async () => {
    await seed([
      { id: 'w2', type: 'update', recordId: 'rec-1', data: { a: 2 }, createdAt: 'then' },
      { id: 'w3', type: 'delete', recordId: 'rec-2', createdAt: 'then' },
    ]);

    await migrateLegacyQueue('user-1');

    const { pending, conflicts } = await readOfflineState('user-1');
    expect(pending).toHaveLength(0);
    expect(conflicts).toHaveLength(2);
    expect(conflicts.every((c) => c.reason === 'baseline_unavailable')).toBe(true);
    // The user's change is preserved, which is the point of not dropping it.
    expect(conflicts[0].local).toEqual({ a: 2 });
    expect(conflicts[0].baseline).toBeUndefined();
  });

  // Without clearing the key, every reconnect would migrate again and duplicate
  // everything the user had queued.
  it('runs once', async () => {
    await seed([{ id: 'w4', type: 'insert', collection: 'things', data: {} }]);

    await migrateLegacyQueue('user-1');
    await migrateLegacyQueue('user-1');

    expect((await readOfflineState('user-1')).pending).toHaveLength(1);
    expect(await AsyncStorage.getItem(legacyKey)).toBeNull();
  });

  it('does nothing for a user with no legacy queue', async () => {
    await migrateLegacyQueue('user-2');
    expect(await readOfflineState('user-2')).toEqual({ pending: [], conflicts: [] });
  });
});
