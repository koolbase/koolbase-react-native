import { readFileSync } from 'fs';
import { join } from 'path';
import { KoolbaseAuth } from '../src/auth';
import * as errors from '../src/auth-errors';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

// Two-step sign-in (MFA) in the SDK.
//
// Every sign-in method must surface mfa_required as MfaRequiredError carrying
// the challenge token — including phone, Google and Apple, which have their
// own error parsers. A method that turned it into a generic error would leave
// the app unable to ask for the second factor.

const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as never;

function reply(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as never;
}

const sessionBody = (extra: Record<string, unknown> = {}) => ({
  access_token: 'at',
  refresh_token: 'rt',
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  user: { id: 'u1', email: 'ama@example.com', verified: true },
  ...extra,
});

const mfaRequired = {
  code: 'mfa_required',
  error: 'two-step sign-in required',
  details: { challenge_token: 'ct-123', expires_at: '2026-09-23T10:05:00Z' },
};

function lastCall() {
  const calls = (global.fetch as unknown as jest.Mock).mock.calls;
  const [url, init] = calls[calls.length - 1];
  return { url: String(url), body: init?.body ? JSON.parse(init.body) : undefined, headers: init?.headers ?? {} };
}

describe('two-step sign-in', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('every error switch in auth.ts maps mfa_required', () => {
    // Structural: a sign-in path whose parser lacks the case would hide the
    // challenge. Fails if any switch on the error code — shared, phone,
    // Apple, Google, or one added later — is missing it.
    const src = readFileSync(join(__dirname, '../src/auth.ts'), 'utf8');
    const starts = [...src.matchAll(/switch \(code\) \{/g)].map((m) => m.index!);
    expect(starts.length).toBeGreaterThan(0);
    starts.forEach((start, i) => {
      const block = src.slice(start, starts[i + 1] ?? src.length);
      expect({ switch: i + 1, maps: block.includes("case 'mfa_required':") }).toEqual({ switch: i + 1, maps: true });
    });
  });

  it('a first factor that needs MFA throws with the challenge token', async () => {
    global.fetch = reply(403, mfaRequired);
    const auth = new KoolbaseAuth(config);
    const err = await auth.login({ email: 'ama@example.com', password: 'password123' }).catch((e) => e);
    expect(err).toBeInstanceOf(errors.MfaRequiredError);
    expect(err.challengeToken).toBe('ct-123');
    expect(err.code).toBe('mfa_required');
  });

  it('verifyMfa sends the challenge and stores the session', async () => {
    global.fetch = reply(200, sessionBody());
    const auth = new KoolbaseAuth(config);
    const session = await auth.verifyMfa({ challengeToken: 'ct-123', code: '123456' });
    expect(session.accessToken).toBe('at');
    const c = lastCall();
    expect(c.url).toContain('/v1/sdk/auth/mfa/verify');
    expect(c.body).toEqual({ challenge_token: 'ct-123', code: '123456' });
  });

  it('a recovery code sign-in reports how many remain', async () => {
    global.fetch = reply(200, sessionBody({ recovery_codes_remaining: 4 }));
    const auth = new KoolbaseAuth(config);
    const r = await auth.verifyRecoveryCode({ challengeToken: 'ct-123', code: 'abcde-fghij' });
    expect(r.session.accessToken).toBe('at');
    expect(r.recoveryCodesRemaining).toBe(4);
    expect(lastCall().url).toContain('/v1/sdk/auth/mfa/verify-recovery');
  });

  it('a wrong code throws OtpInvalidError', async () => {
    global.fetch = reply(400, { code: 'otp_invalid', error: 'invalid code' });
    const auth = new KoolbaseAuth(config);
    await expect(auth.verifyMfa({ challengeToken: 'ct', code: '000000' })).rejects.toBeInstanceOf(errors.OtpInvalidError);
  });

  it.each([
    ['recent_auth_required', 'RecentAuthRequiredError'],
    ['recent_mfa_required', 'RecentMfaRequiredError'],
    ['mfa_already_enabled', 'MfaAlreadyEnabledError'],
    ['mfa_enrollment_not_found', 'MfaEnrollmentNotFoundError'],
    ['mfa_not_enabled', 'MfaNotEnabledError'],
  ])('%s throws its own class', async (code, cls) => {
    // Signed-in call: sign in first, or the SDK refuses before sending.
    global.fetch = reply(200, sessionBody());
    const auth = new KoolbaseAuth(config);
    await auth.login({ email: 'ama@example.com', password: 'password123' });
    global.fetch = reply(403, { code, error: 'm' });
    await expect(auth.disableMfa()).rejects.toBeInstanceOf((errors as Record<string, unknown>)[cls] as never);
  });
});
