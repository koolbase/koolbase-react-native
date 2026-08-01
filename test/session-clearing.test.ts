import { KoolbaseDatabase } from '../src/database';
import { KoolbaseUnauthenticatedError } from '../src/errors';
import { KoolbasePermissionError } from '../src/database-errors';

/**
 * A session the server refuses is not a session. Left in place, the app keeps
 * believing it is authenticated and every call fails the same way — call,
 * reject, retry, with no path back to login.
 *
 * The distinction from a permission failure matters as much as the clearing: a
 * 403 means the credentials were accepted and this caller may not proceed.
 * Signing someone out for opening the wrong record would be worse than the loop.
 */
describe('a rejected credential', () => {
  const config = { baseUrl: 'https://api.test', publicKey: 'pk_test' } as any;

  const respond = (status: number, body: unknown) =>
    jest.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    ) as unknown as typeof fetch;

  it('clears the session and raises the shared type', async () => {
    let cleared = false;
    global.fetch = respond(401, { error: 'unauthorized' });
    const db = new KoolbaseDatabase(
      config,
      () => 'user-1',
      async () => 'token',
      async () => { cleared = true; }
    );

    await expect(db.update('rec-1', { a: 1 })).rejects.toBeInstanceOf(
      KoolbaseUnauthenticatedError
    );
    expect(cleared).toBe(true);
  });

  it('a permission failure does not sign the user out', async () => {
    let cleared = false;
    global.fetch = respond(403, { code: 'permission_denied', error: 'nope' });
    const db = new KoolbaseDatabase(
      config,
      () => 'user-1',
      async () => 'token',
      async () => { cleared = true; }
    );

    await expect(db.update('rec-1', { a: 1 })).rejects.toBeInstanceOf(
      KoolbasePermissionError
    );
    expect(cleared).toBe(false);
  });

  it('is catchable as any SDK failure', async () => {
    const { koolbaseDataError } = await import('../src/database-errors');
    const { KoolbaseError } = await import('../src/errors');
    expect(koolbaseDataError(401, {}, 'x')).toBeInstanceOf(KoolbaseError);
    expect(koolbaseDataError(403, {}, 'x')).toBeInstanceOf(KoolbaseError);
  });
});
