import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';
import {
  addToWriteQueue,
  getWriteQueue,
  setCached,
  getCached,
  clearUserCache,
  invalidateCache,
  hashQuery,
} from '../src/cache-store';

/**
 * clearUserCache deleted every key under the user's prefix, and the write queue
 * lives under one of them — so clearing the cache destroyed offline writes the
 * user believed were saved, silently and irrecoverably.
 *
 * A cache is what can be refetched. Queued writes are not that, and the
 * distinction is the whole reason the queue exists.
 */
describe('clearUserCache', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('spares the write queue', async () => {
    await addToWriteQueue('user-1', {
      id: 'w1',
      type: 'update',
      recordId: 'rec-1',
      data: { a: 1 },
    });
    await setCached('user-1', 'things', 'hash', { records: [], total: 0 } as any);

    await clearUserCache('user-1');

    expect(await getCached('user-1', 'things', 'hash')).toBeNull();
    const queue = await getWriteQueue('user-1');
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe('w1');
  });

  it('leaves another user alone', async () => {
    await addToWriteQueue('user-2', {
      id: 'w2',
      type: 'insert',
      collection: 'things',
      data: {},
    });
    await clearUserCache('user-1');
    expect(await getWriteQueue('user-2')).toHaveLength(1);
  });
});

/**
 * invalidateCache runs after every write, so if it reached the queue a user's
 * own edit would destroy their pending ones.
 */
describe('invalidateCache', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('spares the write queue', async () => {
    await addToWriteQueue('user-1', {
      id: 'w3',
      type: 'delete',
      recordId: 'rec-9',
    });
    await setCached('user-1', 'things', 'hash', { records: [], total: 0 } as any);

    await invalidateCache('user-1', 'things');

    expect(await getCached('user-1', 'things', 'hash')).toBeNull();
    expect(await getWriteQueue('user-1')).toHaveLength(1);
  });
});


describe('hashQuery', () => {
  it('is the same whatever the order of keys, at any depth', () => {
    expect(hashQuery('songs', { filters: { a: 1, b: { y: 2, x: 1 } }, limit: 5 })).toBe(
      hashQuery('songs', { limit: 5, filters: { b: { x: 1, y: 2 }, a: 1 } }),
    );
  });

  it('still tells different queries apart, and keeps array order', () => {
    expect(hashQuery('songs', { filters: { a: 1 } })).not.toBe(hashQuery('songs', { filters: { a: 2 } }));
    expect(hashQuery('songs', { populate: ['a', 'b'] })).not.toBe(hashQuery('songs', { populate: ['b', 'a'] }));
  });
});
