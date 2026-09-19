import { KoolbaseAuth } from '../src/auth';
import { MalformedSessionResponseError } from '../src/auth-errors';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

// Registration succeeding and authentication succeeding are different
// outcomes.
//
// With require_verified_contact on, the server creates the account and issues
// no session — 201 with verification_required, deliberately not an error,
// because reporting failure for a signup that worked is worse. The SDK
// ignored that field and built a session out of a body with no tokens in it:
// it persisted, currentUser returned a user, and every authenticated request
// went out as `Bearer undefined`. Signed in as far as the app could tell, and
// unable to do anything.
//
// Fixed by making the caller choose. These are the tests that say so.

const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as never;

function respond(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as never;
}

const user = { id: 'u1', email: 'a@b.test', verified: false };
const session = {
  access_token: 'at',
  refresh_token: 'rt',
  expires_at: '2026-09-20T00:00:00Z',
  user,
};

describe('register', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('signs the user in when the project does not require verification', async () => {
    respond(201, session);
    const auth = new KoolbaseAuth(config);
    const result = await auth.register({ email: 'a@b.test', password: 'password123' });

    expect(result.status).toBe('authenticated');
    if (result.status !== 'authenticated') throw new Error('unreachable');
    expect(result.session.accessToken).toBe('at');
    expect(auth.currentUser?.id).toBe('u1');
  });

  it('reports verification_required without a session', async () => {
    respond(201, {
      verification_required: true,
      message: 'account created — verify your email before signing in',
      user,
    });
    const auth = new KoolbaseAuth(config);
    const result = await auth.register({ email: 'a@b.test', password: 'password123' });

    expect(result.status).toBe('verification_required');
    expect(result.session).toBeNull();
    expect(result.user.email).toBe('a@b.test');
  });

  it('persists nothing and signs nobody in on verification_required', async () => {
    // The bug: a session was stored and currentUser answered with a user
    // holding no tokens.
    respond(201, { verification_required: true, user });
    const auth = new KoolbaseAuth(config);
    await auth.register({ email: 'a@b.test', password: 'password123' });

    expect(auth.currentUser).toBeNull();
    expect(auth.accessToken).toBeNull();
  });

  it('does not fire an auth-state change for a pending signup', async () => {
    respond(201, { verification_required: true, user });
    const auth = new KoolbaseAuth(config);

    const seen: unknown[] = [];
    auth.onAuthStateChange((u) => seen.push(u));
    seen.length = 0; // drop the immediate initial call

    await auth.register({ email: 'a@b.test', password: 'password123' });
    expect(seen).toEqual([]);
  });

  it('does not destroy an existing session when a second signup is pending', async () => {
    // Registering another account must not sign out whoever is already here.
    respond(201, session);
    const auth = new KoolbaseAuth(config);
    await auth.register({ email: 'a@b.test', password: 'password123' });
    expect(auth.currentUser?.id).toBe('u1');

    respond(201, { verification_required: true, user: { id: 'u2', email: 'c@d.test' } });
    await auth.register({ email: 'c@d.test', password: 'password123' });

    expect(auth.currentUser?.id).toBe('u1');
    expect(auth.accessToken).toBe('at');
  });

  it('refuses a response that claims a session without tokens', async () => {
    // Not verification_required — a server saying "here is your session" and
    // omitting it. That is a protocol error, not a legitimate outcome.
    respond(201, { user });
    const auth = new KoolbaseAuth(config);

    await expect(
      auth.register({ email: 'a@b.test', password: 'password123' })
    ).rejects.toBeInstanceOf(MalformedSessionResponseError);
    expect(auth.currentUser).toBeNull();
  });
});
