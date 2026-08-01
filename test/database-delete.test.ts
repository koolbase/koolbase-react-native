import { KoolbaseDatabase } from '../src/database';
import { KoolbaseDataError } from '../src/database-errors';
import { cacheRecord, getCachedRecord } from '../src/cache-store';
import { readOfflineState, queueWrite } from '../src/offline-state';
import { KoolbaseOfflineBaselineUnavailableError } from '../src/errors';

/**
 * delete() queued the write before attempting the request and swallowed every
 * server response, so a delete the server refused reported success, and a
 * delete that succeeded stayed queued to replay later — against a record that
 * may since have been recreated under the same id.
 *
 * update() had been written correctly all along: try the network, tell a
 * refusal apart from an unreachable server, queue only the latter. delete
 * simply did not follow it.
 */
describe('delete', () => {
  const config = { baseUrl: 'https://api.test', publicKey: 'pk_test' } as any;
  const db = () =>
    new KoolbaseDatabase(config, () => 'user-1', async () => 'token');

  beforeEach(async () => {
    const store = await import('./mocks/async-storage');
    (store.default as any).__reset();
  });

  it('surfaces a refusal instead of reporting success', async () => {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ code: 'permission_denied', error: 'nope' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    ) as unknown as typeof fetch;

    await expect(db().delete('rec-1')).rejects.toBeInstanceOf(KoolbaseDataError);

    const { pending } = await readOfflineState('user-1');
    expect(pending).toHaveLength(0);
    // A refusal will be refused again on every retry. Queueing it would mean
    // retrying forever while the caller believes the record is gone.
  });

  it('does not queue a delete the server accepted', async () => {
    global.fetch = jest.fn(async () =>
      new Response(null, { status: 204 })
    ) as unknown as typeof fetch;

    await db().delete('rec-2');

    const { pending } = await readOfflineState('user-1');
    expect(pending).toHaveLength(0);
    // Previously this was queued before the request and never removed, so a
    // successful delete replayed later against whatever held that id next.
  });

  const offline = () =>
    jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

  it('queues with its baseline when the record has been seen', async () => {
    await cacheRecord('user-1', 'things', 'rec-3', { label: 'before' }, 4);
    global.fetch = offline();

    await db().delete('rec-3');

    const { pending } = await readOfflineState('user-1');
    expect(pending).toHaveLength(1);
    expect(pending[0].operation).toBe('delete');
    expect(pending[0].recordId).toBe('rec-3');
    expect(pending[0].baseline).toEqual({ label: 'before' });
    expect(pending[0].baseRevision).toBe(4);
  });

  // The guarantee: a delete replayed without knowing what the record was would
  // remove something the user last saw hours earlier and which may have changed
  // since. Refusing is deliberate — queueing it anyway would mean most offline
  // deletes are conflict-safe and some quietly are not.
  it('refuses when the record has never been seen', async () => {
    global.fetch = offline();

    await expect(db().delete('never-seen')).rejects.toBeInstanceOf(
      KoolbaseOfflineBaselineUnavailableError
    );

    const { pending } = await readOfflineState('user-1');
    expect(pending).toHaveLength(0);
  });

  // Insert-then-remove is an ordinary offline sequence: the record does not
  // exist on the server yet, but the queued insert holds what it would be.
  it('accepts a delete of a record created offline', async () => {
    await queueWrite('user-1', {
      id: 'w-insert',
      operation: 'insert',
      collection: 'things',
      recordId: 'rec-4',
      data: { label: 'made offline' },
    });
    global.fetch = offline();

    await db().delete('rec-4');

    const { pending } = await readOfflineState('user-1');
    expect(pending.map((w) => w.operation)).toEqual(['insert', 'delete']);
    expect(pending[1].baseline).toEqual({ label: 'made offline' });
  });

  // A record already deleted locally has no state to compose against — a
  // contradiction in the SDK's own queue rather than a conflict to resolve. Left
  // unchecked, repeated deletes would stack duplicate entries.
  it('refuses a second delete of the same record', async () => {
    await cacheRecord('user-1', 'things', 'rec-5', { label: 'x' }, 1);
    global.fetch = offline();
    await db().delete('rec-5');

    await expect(db().delete('rec-5')).rejects.toBeInstanceOf(
      KoolbaseOfflineBaselineUnavailableError
    );

    const { pending } = await readOfflineState('user-1');
    expect(pending).toHaveLength(1);
  });

  // Otherwise a later update could resolve a baseline from a record the user
  // has already removed.
  it('forgets the cached record either way', async () => {
    await cacheRecord('user-1', 'things', 'rec-6', { label: 'x' }, 1);
    global.fetch = jest.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    await db().delete('rec-6');
    expect(await getCachedRecord('user-1', 'rec-6')).toBeNull();

    await cacheRecord('user-1', 'things', 'rec-7', { label: 'y' }, 1);
    global.fetch = offline();
    await db().delete('rec-7');
    expect(await getCachedRecord('user-1', 'rec-7')).toBeNull();
  });
});
