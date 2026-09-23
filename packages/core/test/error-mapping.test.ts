import { KoolbaseAuth } from '../src/auth';
import * as errors from '../src/auth-errors';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

// Every auth error code the API emits, mapped to the class an app catches.
//
// A code with no case falls through to a generic error, and the app's
// `instanceof` branch silently never runs — the failure is invisible from
// inside the SDK, which is why fourteen codes went unmapped without anyone
// noticing. This table is the guard: add a code to the API, add it here, and
// a missing case fails the build rather than a user's password reset.

const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as never;

const cases: Array<[string, new (...a: never[]) => Error]> = [
  ['invalid_credentials', errors.InvalidCredentialsError],
  ['email_in_use', errors.EmailAlreadyInUseError],
  ['account_disabled', errors.UserDisabledError],
  ['account_locked', errors.AccountLockedError],
  ['invalid_refresh_token', errors.SessionExpiredError],
  // token_revoked and session_expired are deliberately NOT here. The API
  // does not emit them — an expired or rejected session comes back as
  // invalid_refresh_token, which maps to SessionExpiredError above. Mapping
  // codes the server never sends makes the contract read as though it does.
  //
  // TokenRevokedError stays as a class for the session_revoked contract on
  // the backlog: explicit revocation — a sign-out-everywhere, an admin
  // killing a session — is worth distinguishing from an expiry, but only
  // once the server can actually establish it. A generic 401 cannot, and
  // the SDK must not infer it.
  ['invalid_unlock_token', errors.UnlockTokenInvalidError],
  ['rate_limit', errors.RateLimitError],
  ['resend_cooldown', errors.VerificationResendCooldownError],
  ['resend_daily_cap', errors.VerificationResendDailyCapError],

  // The fourteen added in 11.1.0.
  ['contact_not_verified', errors.ContactNotVerifiedError],
  ['email_not_verified', errors.ContactNotVerifiedError],
  ['signups_disabled', errors.SignupsDisabledError],
  // Sign-in codes, added with email-code sign-in (23 Sep).
  ['email_code_disabled', errors.EmailCodeDisabledError],
  // Two-step sign-in (MFA).
  ['mfa_required', errors.MfaRequiredError],
  ['recent_auth_required', errors.RecentAuthRequiredError],
  ['recent_mfa_required', errors.RecentMfaRequiredError],
  ['mfa_already_enabled', errors.MfaAlreadyEnabledError],
  ['mfa_enrollment_not_found', errors.MfaEnrollmentNotFoundError],
  ['mfa_not_enabled', errors.MfaNotEnabledError],
  ['otp_expired', errors.OtpExpiredError],
  ['otp_invalid', errors.OtpInvalidError],
  ['otp_max_attempts', errors.OtpMaxAttemptsError],
  ['weak_password', errors.WeakPasswordError],
  ['account_exists', errors.AccountExistsError],
  ['token_expired', errors.TokenExpiredError],
  ['token_used', errors.TokenAlreadyUsedError],
  ['invalid_token', errors.UnlockTokenInvalidError],
  ['invalid_password', errors.CurrentPasswordIncorrectError],
  ['oauth_only_account', errors.OAuthOnlyAccountError],
  ['unsupported_oauth_provider', errors.UnsupportedOAuthProviderError],
  ['session_required', errors.SessionRequiredError],
  ['insufficient_authority', errors.InsufficientAuthorityError],
  ['last_credential', errors.LastCredentialError],
  ['hide_requires_verification', errors.HideRequiresVerificationError],

  // Mapped once the constants file made the API's full list exact.
  ['insufficient_scope', errors.InsufficientScopeError],
  ['identity_not_found', errors.IdentityNotFoundError],
  ['provider_identity_already_linked', errors.ProviderIdentityAlreadyLinkedError],
];

describe('auth error mapping', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it.each(cases)('%s maps to its own class', async (code, Expected) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code, error: 'server message' }),
      text: async () => JSON.stringify({ code }),
    }) as never;

    const auth = new KoolbaseAuth(config);
    await expect(
      auth.login({ email: 'a@b.test', password: 'password123' })
    ).rejects.toBeInstanceOf(Expected);
  });

  it('carries the server message rather than a canned one', async () => {
    // The server knows why; the SDK should not overwrite it with a guess.
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: 'weak_password', error: 'must contain a number' }),
      text: async () => '',
    }) as never;

    const auth = new KoolbaseAuth(config);
    await expect(
      auth.login({ email: 'a@b.test', password: 'password123' })
    ).rejects.toThrow('must contain a number');
  });
});
