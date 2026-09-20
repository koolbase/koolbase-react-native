import { KoolbaseAuth } from '../src/auth';
import {
  VerificationResendCooldownError,
  VerificationResendDailyCapError,
} from '../src/auth-errors';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

// verifyEmail and resendVerificationEmail existed on the API and in the
// Flutter SDK, and not here — so a web app's verify-email page had nothing to
// call. Added 19 Sep.
//
// The resend throttle is the part worth testing: the server answers 429 with
// resend_cooldown and a cooldown_until timestamp, and if the SDK maps neither
// then an app gets a generic error and cannot show a countdown — which is the
// only thing that makes the refusal actionable.

const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as never;

function respond(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as never;
}

describe('email verification', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('verifyEmail posts the token', async () => {
    respond(200, {});
    const auth = new KoolbaseAuth(config);
    await expect(auth.verifyEmail('tok_123')).resolves.toBeUndefined();

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ token: 'tok_123' });
  });

  it('resend reports an already-verified account rather than erroring', async () => {
    // Not a failure: the user verified in another tab and pressed the button
    // anyway. An app shows "you're all set", not an error.
    respond(200, { already_verified: true });
    const auth = new KoolbaseAuth(config);
    const result = await auth.resendVerificationEmail();

    expect(result.alreadyVerified).toBe(true);
    expect(result.cooldownUntil).toBeNull();
  });

  it('resend returns when the link expires and when another send is allowed', async () => {
    respond(200, {
      already_verified: false,
      expires_at: '2026-09-20T10:00:00Z',
      cooldown_until: '2026-09-19T20:01:00Z',
    });
    const auth = new KoolbaseAuth(config);
    const result = await auth.resendVerificationEmail();

    expect(result.alreadyVerified).toBe(false);
    expect(result.expiresAt?.toISOString()).toBe('2026-09-20T10:00:00.000Z');
    expect(result.cooldownUntil?.toISOString()).toBe('2026-09-19T20:01:00.000Z');
  });

  it('the by-address resend needs no session and reports nothing', async () => {
    // The signed-out path. It answers the same whether the address has an
    // account, has none, or is already verified — so there is nothing to
    // return, and an app shows the same "check your email" either way.
    respond(200, { message: 'If that email needs verifying, a new link has been sent' });
    const auth = new KoolbaseAuth(config);

    await expect(
      auth.resendVerificationEmailToAddress('someone@example.test')
    ).resolves.toBeUndefined();

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/v1/sdk/auth/resend-verification/by-email');
    expect(JSON.parse(init.body)).toEqual({ email: 'someone@example.test' });
    // No Authorization header: the whole point is that there is no session.
    expect(init.headers?.Authorization ?? init.headers?.authorization).toBeUndefined();
  });

  it('a cooldown is a typed error carrying when to retry', async () => {
    respond(429, {
      code: 'resend_cooldown',
      error: 'please wait before requesting another verification email',
      cooldown_until: '2026-09-19T20:01:00Z',
    });
    const auth = new KoolbaseAuth(config);

    await expect(auth.resendVerificationEmail()).rejects.toBeInstanceOf(
      VerificationResendCooldownError
    );

    try {
      await auth.resendVerificationEmail();
    } catch (e) {
      const err = e as VerificationResendCooldownError;
      // The timestamp is the point: without it the app can only say "no".
      expect(err.cooldownUntil?.toISOString()).toBe('2026-09-19T20:01:00.000Z');
    }
  });

  it('the daily cap is a different error from the cooldown', async () => {
    // Different remedy — wait seconds versus wait until tomorrow — so an app
    // must be able to tell them apart.
    respond(429, { code: 'resend_daily_cap', error: 'daily limit reached' });
    const auth = new KoolbaseAuth(config);

    await expect(auth.resendVerificationEmail()).rejects.toBeInstanceOf(
      VerificationResendDailyCapError
    );
  });
});
