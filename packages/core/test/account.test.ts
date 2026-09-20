import { KoolbaseAuth } from '../src/auth';
import { CurrentPasswordIncorrectError, WeakPasswordError } from '../src/auth-errors';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

// Account settings: read the user, change the profile, change the password,
// delete the account.
//
// All four existed in the Flutter SDK and on the server, and in none of the
// TypeScript SDKs until 20 September 2026 — so an application built on
// @koolbase/js could not offer a settings screen at all. Found by comparing
// each SDK's public surface against the API's routes, after I answered a
// customer's question about deleteAccount by checking Flutter and reporting
// it as the platform's.

const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as never;
const user = { id: 'u1', email: 'a@b.test', full_name: 'Ada', verified: true };
const session = { access_token: 'at', refresh_token: 'rt', expires_at: '2026-12-01T00:00:00Z', user };

function respond(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as never;
}

/** A signed-in client, via a scripted login. */
async function signedIn(): Promise<KoolbaseAuth> {
  respond(200, session);
  const auth = new KoolbaseAuth(config);
  await auth.login({ email: 'a@b.test', password: 'password123' });
  return auth;
}

describe('account', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('getCurrentUser fetches and caches', async () => {
    const auth = await signedIn();
    respond(200, { ...user, full_name: 'Ada Lovelace' });

    const fetched = await auth.getCurrentUser();
    // mapUser camelCases on the way out; asserting the raw key too would let
    // a dropped mapping pass.
    expect(fetched.fullName).toBe('Ada Lovelace');

    // The cached copy must move too, or the next read is stale and a reload
    // shows the old name.
    expect(auth.currentUser?.id).toBe('u1');
  });

  it('updateProfile sends only the fields given', async () => {
    const auth = await signedIn();
    respond(200, { ...user, full_name: 'Grace' });

    await auth.updateProfile({ fullName: 'Grace' });

    const calls = (global.fetch as jest.Mock).mock.calls;
    const [url, init] = calls[calls.length - 1];
    expect(url).toContain('/v1/sdk/auth/me');
    expect(init.method).toBe('PATCH');
    // avatar_url absent, not null: sending null would clear it.
    expect(JSON.parse(init.body)).toEqual({ full_name: 'Grace' });
  });

  it('updateProfile refreshes what currentUser reports', async () => {
    const auth = await signedIn();
    respond(200, { ...user, full_name: 'Grace' });
    await auth.updateProfile({ fullName: 'Grace' });

    expect(auth.currentUser?.fullName).toBe('Grace');
  });

  it('changePassword refuses a short new password before sending', async () => {
    const auth = await signedIn();
    const before = (global.fetch as jest.Mock).mock.calls.length;

    await expect(
      auth.changePassword({ currentPassword: 'oldpassword', newPassword: 'short' })
    ).rejects.toBeInstanceOf(WeakPasswordError);

    // Refused locally: no point spending a request to be told what we knew.
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(before);
  });

  it('changePassword reports a wrong current password as its own error', async () => {
    const auth = await signedIn();
    respond(400, { code: 'invalid_password', error: 'current password is incorrect' });

    await expect(
      auth.changePassword({ currentPassword: 'wrong', newPassword: 'password456' })
    ).rejects.toBeInstanceOf(CurrentPasswordIncorrectError);
  });

  it('deleteAccount signs the user out', async () => {
    const auth = await signedIn();
    expect(auth.currentUser).not.toBeNull();

    respond(200, {});
    await auth.deleteAccount();

    // The account is gone; holding a session for it would leave the app
    // showing a signed-in user whose every request 401s.
    expect(auth.currentUser).toBeNull();
    expect(auth.accessToken).toBeNull();
  });

  it('deleteAccount keeps the session when the server refuses', async () => {
    const auth = await signedIn();
    respond(401, { code: 'unauthenticated', error: 'invalid token' });

    await expect(auth.deleteAccount()).rejects.toThrow();
    // Nothing was deleted, so signing the user out would be a lie.
    expect(auth.currentUser?.id).toBe('u1');
  });
});
