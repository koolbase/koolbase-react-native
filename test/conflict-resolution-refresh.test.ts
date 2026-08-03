import { KoolbaseDatabase } from '../src/database';
import { KoolbaseDataError } from '../src/database-errors';
import { mutateOfflineState, readOfflineState } from '../src/offline-state';

/**
 * A refused resolution must teach the stored conflict, not just gate it.
 * Device-proven bug: conflict held at rev 8, server moved to rev 9, resolution
 * correctly refused — then refused again, identically, forever: the stored
 * conflict never absorbed the 409's current_revision, so every retry replayed
 * the stale condition. Abandon was the only exit.
 */
describe('conflict resolution refresh-on-refusal', () => {
  const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as any;
  const db = new KoolbaseDatabase(config, () => 'u1', async () => 'token');

  const seedConflict = () =>
    mutateOfflineState('u1', (s) => {
      s.conflicts.push({
        reason: 'concurrent_modification',
        id: 'c1',
        operation: 'update',
        collection: 'expenses',
        recordId: 'rec-1',
        local: { amount: 48 },
        server: { amount: 10 },
        serverRevision: 8,
      } as any);
    });

  beforeEach(async () => {
    const store = await import('./mocks/async-storage');
    (store.default as any).__reset();
    await seedConflict();
  });

  it('a refusal absorbs the 409 into the stored conflict, and the retry succeeds', async () => {
    let sentRevisions: unknown[] = [];
    global.fetch = jest.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      sentRevisions.push(body.expected_revision);
      if (body.expected_revision === 8) {
        const body409 = JSON.stringify({
          code: 'revision_mismatch',
          error: 'the record has changed since you read it',
          details: {
            expected_revision: 8, current_revision: 9,
            record: { amount: 3000 },
          },
        });
        return { ok: false, status: 409, text: async () => body409 };
      }
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ record: { id: 'rec-1', data: body.data, revision: 10 } }),
      };
    });

    const conflicts = await db.conflicts();
    // Attempt 1: refused — and the refusal teaches.
    await expect(conflicts[0].resolveWithLocal()).rejects.toThrow(
      /changed again/,
    );
    const st = await readOfflineState('u1');
    expect(st.conflicts[0].serverRevision).toBe(9);
    expect(st.conflicts[0].server).toEqual({ amount: 3000 });

    // Attempt 2: same conflict, server unmoved — succeeds against reality.
    const retry = await db.conflicts();
    await retry[0].resolveWithLocal();
    expect(sentRevisions).toEqual([8, 9]);
    expect((await readOfflineState('u1')).conflicts).toHaveLength(0);
  });

  it('a non-mismatch failure leaves the conflict untouched and rethrows', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 403,
      text: async () => JSON.stringify({ code: 'permission_denied', error: 'no' }),
    });
    const conflicts = await db.conflicts();
    await expect(conflicts[0].resolveWithLocal()).rejects.toThrow();
    const st = await readOfflineState('u1');
    expect(st.conflicts[0].serverRevision).toBe(8);
  });
});
