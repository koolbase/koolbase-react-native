/**
 * Base error type for all Koolbase auth errors. Catchable via
 * `instanceof KoolbaseAuthError` to handle any auth-related failure
 * generically; subclasses let you handle specific cases.
 */
export class KoolbaseAuthError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
    this.name = 'KoolbaseAuthError';
    Object.setPrototypeOf(this, KoolbaseAuthError.prototype);
  }
}

// ─── Credentials / Registration ────────────────────────────────────────────

export class InvalidCredentialsError extends KoolbaseAuthError {
  constructor() {
    super('Invalid email or password', 'invalid_credentials');
    this.name = 'InvalidCredentialsError';
    Object.setPrototypeOf(this, InvalidCredentialsError.prototype);
  }
}

export class EmailAlreadyInUseError extends KoolbaseAuthError {
  constructor() {
    super('Email is already in use', 'email_taken');
    this.name = 'EmailAlreadyInUseError';
    Object.setPrototypeOf(this, EmailAlreadyInUseError.prototype);
  }
}

export class UserDisabledError extends KoolbaseAuthError {
  constructor() {
    super('This account has been disabled', 'user_disabled');
    this.name = 'UserDisabledError';
    Object.setPrototypeOf(this, UserDisabledError.prototype);
  }
}

export class WeakPasswordError extends KoolbaseAuthError {
  constructor() {
    super('Password must be at least 8 characters', 'weak_password');
    this.name = 'WeakPasswordError';
    Object.setPrototypeOf(this, WeakPasswordError.prototype);
  }
}

// ─── Session lifecycle ─────────────────────────────────────────────────────

export class SessionExpiredError extends KoolbaseAuthError {
  constructor() {
    super('Session expired, please log in again', 'session_expired');
    this.name = 'SessionExpiredError';
    Object.setPrototypeOf(this, SessionExpiredError.prototype);
  }
}

/**
 * Thrown when the access token references a session that has been revoked
 * centrally — either by the user (sessions endpoint) or an administrator.
 * Distinct from {@link SessionExpiredError} which indicates the access
 * token TTL elapsed without a successful refresh.
 *
 * Forward-compatible: matches multiple server message patterns so it stays
 * accurate as the server's revocation signaling evolves.
 */
export class TokenRevokedError extends KoolbaseAuthError {
  constructor() {
    super('Session has been revoked, please log in again', 'token_revoked');
    this.name = 'TokenRevokedError';
    Object.setPrototypeOf(this, TokenRevokedError.prototype);
  }
}

// ─── Brute-force protection ────────────────────────────────────────────────

/**
 * Thrown when the account is temporarily locked due to too many failed
 * login attempts. The server uses progressive 5/10/20-attempt lockouts;
 * if an unlock email was issued (level 2+), the user can clear the lock
 * by passing that token to {@link KoolbaseAuth.unlock}.
 *
 * [lockedUntil] is currently null — the server returns a generic 429 but
 * does not yet include the unlock timestamp in the response body. Field
 * is forward-compatible for when the server adds it.
 */
export class AccountLockedError extends KoolbaseAuthError {
  lockedUntil?: Date;

  constructor(lockedUntil?: Date) {
    super(
      'Account temporarily locked due to too many failed attempts',
      'account_locked'
    );
    this.lockedUntil = lockedUntil;
    this.name = 'AccountLockedError';
    Object.setPrototypeOf(this, AccountLockedError.prototype);
  }
}

/**
 * Thrown when the unlock token from a brute-force unlock email is
 * invalid, expired, or already consumed. Unlock tokens are one-shot.
 */
export class UnlockTokenInvalidError extends KoolbaseAuthError {
  constructor() {
    super('Unlock link is invalid or has expired', 'unlock_token_invalid');
    this.name = 'UnlockTokenInvalidError';
    Object.setPrototypeOf(this, UnlockTokenInvalidError.prototype);
  }
}

/**
 * Thrown when the server rate-limits a non-phone authentication endpoint
 * (HTTP 429 without the "account temporarily locked" marker). Phone OTP
 * endpoints throw {@link OtpRateLimitError} instead — they hit a
 * separate server-side rate-limiter.
 */
export class RateLimitError extends KoolbaseAuthError {
  constructor(message?: string) {
    super(message ?? 'Too many requests, please wait before trying again', 'rate_limit');
    this.name = 'RateLimitError';
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

// ─── Network ───────────────────────────────────────────────────────────────

/**
 * Generic network error. The SDK does NOT throw this directly — fetch
 * failures (DNS, no connection, timeout) propagate as native TypeErrors.
 * This class exists for consumer code that wants to construct or
 * `instanceof`-check a typed network error from their own retry logic.
 */
export class NetworkError extends KoolbaseAuthError {
  constructor() {
    super('Network error, please check your connection', 'network_error');
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

// ─── Phone OTP (unchanged from earlier releases) ───────────────────────────

export class InvalidPhoneNumberError extends KoolbaseAuthError {
  constructor() {
    super(
      'Phone number must be in E.164 format (e.g. +233XXXXXXXXX)',
      'invalid_phone'
    );
    this.name = 'InvalidPhoneNumberError';
    Object.setPrototypeOf(this, InvalidPhoneNumberError.prototype);
  }
}

export class OtpExpiredError extends KoolbaseAuthError {
  constructor() {
    super('OTP has expired, please request a new code', 'otp_expired');
    this.name = 'OtpExpiredError';
    Object.setPrototypeOf(this, OtpExpiredError.prototype);
  }
}

export class OtpInvalidError extends KoolbaseAuthError {
  constructor() {
    super('Invalid OTP code', 'otp_invalid');
    this.name = 'OtpInvalidError';
    Object.setPrototypeOf(this, OtpInvalidError.prototype);
  }
}

export class OtpMaxAttemptsError extends KoolbaseAuthError {
  constructor() {
    super(
      'Too many incorrect attempts, please request a new code',
      'otp_max_attempts'
    );
    this.name = 'OtpMaxAttemptsError';
    Object.setPrototypeOf(this, OtpMaxAttemptsError.prototype);
  }
}

export class OtpRateLimitError extends KoolbaseAuthError {
  constructor() {
    super(
      'Too many OTP requests, please wait before trying again',
      'otp_rate_limit'
    );
    this.name = 'OtpRateLimitError';
    Object.setPrototypeOf(this, OtpRateLimitError.prototype);
  }
}

export class PhoneAlreadyLinkedError extends KoolbaseAuthError {
  constructor() {
    super(
      'Phone number is already associated with another account',
      'phone_taken'
    );
    this.name = 'PhoneAlreadyLinkedError';
    Object.setPrototypeOf(this, PhoneAlreadyLinkedError.prototype);
  }
}

export class SmsConfigMissingError extends KoolbaseAuthError {
  constructor() {
    super('SMS provider not configured for this project', 'sms_config_missing');
    this.name = 'SmsConfigMissingError';
    Object.setPrototypeOf(this, SmsConfigMissingError.prototype);
  }
}

export class AppleSignInNotConfiguredError extends KoolbaseAuthError {
  constructor() {
    super('Apple Sign-In is not configured for this environment', 'apple_not_configured');
    this.name = 'AppleSignInNotConfiguredError';
    Object.setPrototypeOf(this, AppleSignInNotConfiguredError.prototype);
  }
}

export class InvalidAppleTokenError extends KoolbaseAuthError {
  constructor() {
    super('Invalid Apple identity token', 'invalid_apple_token');
    this.name = 'InvalidAppleTokenError';
    Object.setPrototypeOf(this, InvalidAppleTokenError.prototype);
  }
}

export class AppleEmailRequiredError extends KoolbaseAuthError {
  constructor() {
    super(
      'Apple did not return email for this sign-in. Revoke this app in iOS Settings → Apple ID and retry.',
      'apple_email_required',
    );
    this.name = 'AppleEmailRequiredError';
    Object.setPrototypeOf(this, AppleEmailRequiredError.prototype);
  }
}

export class OAuthEmailConflictError extends KoolbaseAuthError {
  constructor() {
    super(
      'Email is already in use by another account. Sign in with your existing method and link Apple from settings.',
      'oauth_email_conflict',
    );
    this.name = 'OAuthEmailConflictError';
    Object.setPrototypeOf(this, OAuthEmailConflictError.prototype);
  }
}

export class GoogleSignInNotConfiguredError extends KoolbaseAuthError {
  constructor() {
    super('Google Sign-In is not configured for this environment', 'google_not_configured');
    this.name = 'GoogleSignInNotConfiguredError';
    Object.setPrototypeOf(this, GoogleSignInNotConfiguredError.prototype);
  }
}

export class InvalidGoogleTokenError extends KoolbaseAuthError {
  constructor() {
    super('Invalid Google identity token', 'invalid_google_token');
    this.name = 'InvalidGoogleTokenError';
    Object.setPrototypeOf(this, InvalidGoogleTokenError.prototype);
  }
}

export class GoogleEmailRequiredError extends KoolbaseAuthError {
  constructor() {
    super(
      'Google did not return email for this sign-in. Ensure the email scope is requested in the native flow.',
      'google_email_required',
    );
    this.name = 'GoogleEmailRequiredError';
    Object.setPrototypeOf(this, GoogleEmailRequiredError.prototype);
  }
}
