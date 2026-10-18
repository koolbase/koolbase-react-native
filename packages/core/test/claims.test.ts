import { KoolbaseAuth } from '../src/auth';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

// #155b: the signed-in user's claims -- only the keys the project's owner
// made readable by the user arrive, on the session and on getCurrentUser.

const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as never;
const user = { id: 'u1', email: 'a@b.test', full_name: 'Ada', verified: true };

function respond(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as never;
}

describe('claims', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('a session carries them; getCurrentUser refreshes them', async () => {
    respond(200, { access_token: 'at', refresh_token: 'rt', expires_at: '2026-12-01T00:00:00Z', user: { ...user, claims: { role: 'organiser' } } });
    const auth = new KoolbaseAuth(config);
    await auth.login({ email: 'a@b.test', password: 'password123' });
    expect(auth.currentUser?.claims).toEqual({ role: 'organiser' });

    respond(200, { ...user, claims: { role: 'member', org: 'gather' } });
    const fetched = await auth.getCurrentUser();
    expect(fetched.claims).toEqual({ role: 'member', org: 'gather' });
    expect(auth.currentUser?.claims).toEqual({ role: 'member', org: 'gather' });
  });

  it('none: absent, never an empty object', async () => {
    respond(200, { access_token: 'at', refresh_token: 'rt', expires_at: '2026-12-01T00:00:00Z', user });
    const auth = new KoolbaseAuth(config);
    await auth.login({ email: 'a@b.test', password: 'password123' });
    expect(auth.currentUser).not.toHaveProperty('claims');
  });
});
