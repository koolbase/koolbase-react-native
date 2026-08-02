import { KoolbaseDatabase } from '../src/database';
import { KoolbaseUnauthenticatedError } from '../src/errors';
import { readOfflineState } from '../src/offline-state';

/**
 * Tonight's fake-zero, pinned. Per-user state was read with a silent
 * `?? 'anonymous'` fallback, so a signed-out display showed "0 pending" —
 * indistinguishable from "all synced" — while a signed-in user's writes sat
 * unseen in their bucket. "No user" and "nothing pending" are different
 * answers, and these tests keep them different.
 */
describe('signed-out per-user state', () => {
  const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as any;
  let user: string | null;
  const db = () => new KoolbaseDatabase(config, () => user, async () => null);

  beforeEach(async () => {
    user = null;
    const store = await import('./mocks/async-storage');
    (store.default as any).__reset();
    // Every network attempt dies: forces the offline path.
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
  });

  it('pendingWrites() refuses signed out — no answer is not "empty"', async () => {
    await expect(db().pendingWrites()).rejects.toThrow(KoolbaseUnauthenticatedError);
  });

  it('conflicts() refuses signed out', async () => {
    await expect(db().conflicts()).rejects.toThrow(KoolbaseUnauthenticatedError);
  });

  it('a signed-out offline insert refuses — and writes to NO bucket', async () => {
    await expect(
      db().insert('expenses', { amount: 10 })
    ).rejects.toThrow(KoolbaseUnauthenticatedError);

    // The assertion that matters: nothing filed anywhere, anonymous included.
    const anon = await readOfflineState('anonymous');
    expect(anon.pending).toHaveLength(0);
  });

  it('sign-out mid-flight cannot enqueue under the dead identity', async () => {
    user = 'u1';
    const client = db();
    // The network attempt is where sign-out lands: resolve identity loss
    // during the awaited fetch, before the offline fallback runs.
    (global.fetch as jest.Mock).mockImplementation(async () => {
      user = null;
      throw new TypeError('Network request failed');
    });

    await expect(
      client.insert('expenses', { amount: 10 })
    ).rejects.toThrow(KoolbaseUnauthenticatedError);
    expect((await readOfflineState('u1')).pending).toHaveLength(0);
    expect((await readOfflineState('anonymous')).pending).toHaveLength(0);
  });

  it("the queue survives a sign-out/sign-in cycle untouched — tonight's timeline", async () => {
    user = 'u1';
    const client = db();
    await client.insert('expenses', { amount: 50 }).catch(() => {});
    expect((await readOfflineState('u1')).pending).toHaveLength(1);

    // Signed out: the queue is invisible (refusal, not a fake zero)...
    user = null;
    await expect(client.pendingWrites()).rejects.toThrow(KoolbaseUnauthenticatedError);

    // ...and intact on return.
    user = 'u1';
    expect(await client.pendingWrites()).toHaveLength(1);
  });
});
