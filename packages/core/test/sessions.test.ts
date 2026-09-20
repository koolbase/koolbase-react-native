import { KoolbaseAuth } from '../src/auth';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

// Session management: where am I signed in, and sign the others out.
//
// Three endpoints existed on the server and no SDK exposed any of them —
// found on 20 September 2026 by comparing each SDK's public surface against
// the API's routes. It also means "sign out everywhere" has been available
// the whole time, contrary to what I told a customer the day before.

const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as never;
const user = { id: 'u1', email: 'a@b.test', verified: true };
const session = { access_token: 'at', refresh_token: 'rt', expires_at: '2026-12-01T00:00:00Z', user };

function respond(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as never;
}

async function signedIn(): Promise<KoolbaseAuth> {
  respond(200, session);
  const auth = new KoolbaseAuth(config);
  await auth.login({ email: 'a@b.test', password: 'password123' });
  return auth;
}

describe('sessions', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('lists sessions and camelCases the server shape', async () => {
    const auth = await signedIn();
    respond(200, {
      sessions: [
        {
          id: 's1',
          ip: '1.2.3.4',
          user_agent: 'Chrome',
          device_label: 'laptop',
          created_at: '2026-09-01T00:00:00Z',
          expires_at: '2026-10-01T00:00:00Z',
          is_current: true,
        },
      ],
      total: 1,
    });

    const [s] = await auth.listSessions();
    expect(s.id).toBe('s1');
    expect(s.userAgent).toBe('Chrome');
    expect(s.deviceLabel).toBe('laptop');
    expect(s.isCurrent).toBe(true);
  });

  it('never exposes a token hash', async () => {
    // The server excludes them deliberately. If it ever stopped, mapping
    // them through would put a credential-shaped value in an app's hands.
    const auth = await signedIn();
    respond(200, {
      sessions: [
        {
          id: 's1',
          created_at: '2026-09-01T00:00:00Z',
          expires_at: '2026-10-01T00:00:00Z',
          is_current: false,
          access_token_hash: 'leaked',
          refresh_token_hash: 'leaked',
        },
      ],
    });

    const [s] = await auth.listSessions();
    expect(JSON.stringify(s)).not.toContain('leaked');
  });

  it('an empty list is an empty array, not a throw', async () => {
    const auth = await signedIn();
    respond(200, { total: 0 });
    await expect(auth.listSessions()).resolves.toEqual([]);
  });

  it('revokeAllOtherSessions returns how many ended', async () => {
    const auth = await signedIn();
    respond(200, { revoked_count: 3 });

    await expect(auth.revokeAllOtherSessions()).resolves.toBe(3);

    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls[calls.length - 1][0]).toContain('/v1/sdk/auth/sessions/revoke-all');
  });

  it('revokeAllOtherSessions keeps this session', async () => {
    // "Other" is the whole point: signing yourself out too would make the
    // feature useless for the case it exists for — a lost phone.
    const auth = await signedIn();
    respond(200, { revoked_count: 2 });
    await auth.revokeAllOtherSessions();

    expect(auth.currentUser?.id).toBe('u1');
    expect(auth.accessToken).toBe('at');
  });

  it('revokeSession posts to the id it was given', async () => {
    const auth = await signedIn();
    respond(200, {});
    await auth.revokeSession('s2');

    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls[calls.length - 1][0]).toContain('/v1/sdk/auth/sessions/s2/revoke');
  });

  it('revokeSession escapes the id', async () => {
    // An id is a UUID today. Interpolating one unescaped is the habit that
    // becomes a path-traversal the day it is not.
    const auth = await signedIn();
    respond(200, {});
    await auth.revokeSession('../../admin');

    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls[calls.length - 1][0]).not.toContain('../../admin');
  });
});
