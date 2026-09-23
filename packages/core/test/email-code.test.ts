import { KoolbaseAuth } from '../src/auth';
import * as errors from '../src/auth-errors';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

// Email-code sign-in: the request always resolves the same way, and a
// verified code returns and stores a session exactly as login() does.

const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as never;

function reply(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as never;
}

describe('email code sign-in', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('requests a code at the right endpoint and resolves', async () => {
    global.fetch = reply(200, { sent: true });
    const auth = new KoolbaseAuth(config);
    await expect(auth.requestEmailCode({ email: 'ama@example.com' })).resolves.toBeUndefined();
    const [url, init] = (global.fetch as unknown as jest.Mock).mock.calls[0];
    expect(String(url)).toContain('/v1/sdk/auth/email/code');
    expect(JSON.parse(init.body)).toEqual({ email: 'ama@example.com' });
  });

  it('signs in with a code and returns the session', async () => {
    global.fetch = reply(200, {
      access_token: 'at',
      refresh_token: 'rt',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      user: { id: 'u1', email: 'ama@example.com', verified: true },
    });
    const auth = new KoolbaseAuth(config);
    const session = await auth.signInWithEmailCode({ email: 'ama@example.com', code: '123456' });
    expect(session.accessToken).toBe('at');
    const [url] = (global.fetch as unknown as jest.Mock).mock.calls[0];
    expect(String(url)).toContain('/v1/sdk/auth/email/code/verify');
  });

  it('a switched-off project throws a class an app can catch', async () => {
    global.fetch = reply(403, { code: 'email_code_disabled', error: 'switched off' });
    const auth = new KoolbaseAuth(config);
    await expect(auth.requestEmailCode({ email: 'ama@example.com' })).rejects.toBeInstanceOf(
      errors.EmailCodeDisabledError
    );
  });

  it('a wrong code throws OtpInvalidError', async () => {
    global.fetch = reply(400, { code: 'otp_invalid', error: 'invalid code' });
    const auth = new KoolbaseAuth(config);
    await expect(
      auth.signInWithEmailCode({ email: 'ama@example.com', code: '000000' })
    ).rejects.toBeInstanceOf(errors.OtpInvalidError);
  });
});
