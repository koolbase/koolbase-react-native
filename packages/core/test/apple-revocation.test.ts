import { KoolbaseAuth } from '../src/auth';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

// Sign in with Apple sends the credential's authorization code (A0 piece 6):
// the server exchanges it for the token it revokes when the account is
// deleted, as Apple asks.

const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as never;

function reply(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as never;
}

const sessionBody = () => ({
  access_token: 'at',
  refresh_token: 'rt',
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  user: { id: 'u1', email: 'ama@example.com', verified: true },
});

function lastBody() {
  const calls = (global.fetch as unknown as jest.Mock).mock.calls;
  const [url, init] = calls[calls.length - 1];
  return { url: String(url), body: init?.body ? JSON.parse(init.body) : {} };
}

describe('signInWithApple and the authorization code', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('sends authorization_code and client when given', async () => {
    global.fetch = reply(200, sessionBody());
    const auth = new KoolbaseAuth(config);
    await auth.signInWithApple({ identityToken: 'idt', nonce: 'n1', authorizationCode: 'code-1', client: 'web' });
    const { url, body } = lastBody();
    expect(url).toContain('/v1/sdk/auth/oauth/apple');
    expect(body).toMatchObject({ identity_token: 'idt', nonce: 'n1', authorization_code: 'code-1', client: 'web' });
  });

  it('sends neither when not given, as before', async () => {
    global.fetch = reply(200, sessionBody());
    const auth = new KoolbaseAuth(config);
    await auth.signInWithApple({ identityToken: 'idt' });
    const { body } = lastBody();
    expect(body.identity_token).toBe('idt');
    expect(body.authorization_code).toBeUndefined();
    expect(body.client).toBeUndefined();
  });
});
