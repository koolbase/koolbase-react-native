import { KoolbaseDatabase } from '../src/database';
import { KoolbaseDataError } from '../src/database-errors';
import { getWriteQueue } from '../src/cache-store';

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

    const queued = await getWriteQueue('user-1');
    expect(queued).toHaveLength(0);
    // A refusal will be refused again on every retry. Queueing it would mean
    // retrying forever while the caller believes the record is gone.
  });

  it('does not queue a delete the server accepted', async () => {
    global.fetch = jest.fn(async () =>
      new Response(null, { status: 204 })
    ) as unknown as typeof fetch;

    await db().delete('rec-2');

    const queued = await getWriteQueue('user-1');
    expect(queued).toHaveLength(0);
    // Previously this was queued before the request and never removed, so a
    // successful delete replayed later against whatever held that id next.
  });

  it('queues when the network is unreachable', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    await db().delete('rec-3');

    const queued = await getWriteQueue('user-1');
    expect(queued).toHaveLength(1);
    expect(queued[0].type).toBe('delete');
    expect(queued[0].recordId).toBe('rec-3');
  });
});
