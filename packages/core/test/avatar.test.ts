import { KoolbaseAuth } from '../src/auth';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

// The profile photo as one of the user's files: { bucket, path } on the
// user, kept as currentUser, set by updateProfile({ avatar }) after an upload
// -- or removed with avatar: null.

const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as never;
const user = { id: 'u1', email: 'a@b.test', full_name: 'Ada', verified: true };

let sent: unknown[] = [];
function respond(status: number, body: unknown) {
  global.fetch = jest.fn().mockImplementation(async (_url: string, init?: { body?: string }) => {
    if (init?.body) sent.push(JSON.parse(init.body));
    return {
      ok: status < 400,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }) as never;
}

async function signedIn(extra: Record<string, unknown> = {}) {
  respond(200, { access_token: 'at', refresh_token: 'rt', expires_at: '2099-12-01T00:00:00Z', user: { ...user, ...extra } });
  const auth = new KoolbaseAuth(config);
  await auth.login({ email: 'a@b.test', password: 'password123' });
  sent = [];
  return auth;
}

describe('avatar', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it("read from the server's user; none or not one, absent", async () => {
    const auth = await signedIn({ avatar: { bucket: 'avatars', path: 'ada/me.jpg' } });
    expect(auth.currentUser?.avatar).toEqual({ bucket: 'avatars', path: 'ada/me.jpg' });
    expect((await signedIn()).currentUser).not.toHaveProperty('avatar');
    expect((await signedIn({ avatar: { bucket: 'avatars' } })).currentUser).not.toHaveProperty('avatar');
  });

  it('set to a file: its bucket and path; currentUser follows', async () => {
    const auth = await signedIn();
    respond(200, { ...user, avatar: { bucket: 'avatars', path: 'ada/me.jpg' }, avatar_url: 'https://cdn.test/x' });
    const u = await auth.updateProfile({ avatar: { bucket: 'avatars', path: 'ada/me.jpg' } });
    expect(sent).toEqual([{ avatar: { bucket: 'avatars', path: 'ada/me.jpg' } }]);
    expect(u.avatar?.path).toBe('ada/me.jpg');
    expect(auth.currentUser?.avatar?.bucket).toBe('avatars');
  });

  it('removed: null sends an empty avatar; a name alone sends none', async () => {
    const auth = await signedIn({ avatar: { bucket: 'avatars', path: 'ada/me.jpg' } });
    respond(200, user);
    await auth.updateProfile({ avatar: null });
    await auth.updateProfile({ fullName: 'Ada L' });
    expect(sent).toEqual([{ avatar: {} }, { full_name: 'Ada L' }]);
    expect(auth.currentUser).not.toHaveProperty('avatar');
  });

  it('a file and an address at once: refused before anything is sent', async () => {
    const auth = await signedIn();
    await expect(
      auth.updateProfile({ avatarUrl: 'https://x.test/a.png', avatar: { bucket: 'avatars', path: 'ada/me.jpg' } })
    ).rejects.toThrow(TypeError);
    expect(sent).toEqual([]);
  });
});
