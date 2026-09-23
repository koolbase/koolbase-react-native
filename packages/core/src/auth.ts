import {
  AuthStateListener,
  FetchLike,
  KoolbaseAuthStorage,
  KoolbaseConfig,
  KoolbaseSession,
  KoolbaseUser,
  LinkPhoneParams,
  LoginParams,
  OtpSendResult,
  PhoneVerifyResult,
  RegisterParams,
  RestoreResult,
  KoolbaseAuditPage,
  KoolbaseSessionInfo,
  ResendVerificationResult,
  SendOtpParams,
  SignUpResult,
  SignInWithAppleParams,
  VerifyOtpParams,
} from './types.js';
import {
  AccountLockedError,
  EmailAlreadyInUseError,
  InvalidCredentialsError,
  InvalidPhoneNumberError,
  KoolbaseAuthError,
  OtpExpiredError,
  OtpInvalidError,
  OtpMaxAttemptsError,
  OtpRateLimitError,
  PhoneAlreadyLinkedError,
  IdentityNotFoundError,
  InsufficientScopeError,
  MalformedSessionResponseError,
  ProviderIdentityAlreadyLinkedError,
  AccountExistsError,
  ContactNotVerifiedError,
  CurrentPasswordIncorrectError,
  HideRequiresVerificationError,
  InsufficientAuthorityError,
  LastCredentialError,
  OAuthOnlyAccountError,
  SessionRequiredError,
  SignupsDisabledError,
  TokenAlreadyUsedError,
  TokenExpiredError,
  UnsupportedOAuthProviderError,
  RateLimitError,
  VerificationResendCooldownError,
  VerificationResendDailyCapError,
  SessionExpiredError,
  SmsConfigMissingError,
  TokenRevokedError,
  UnlockTokenInvalidError,
  UserDisabledError,
  WeakPasswordError,
  AppleEmailRequiredError,
  AppleSignInNotConfiguredError,
  InvalidAppleTokenError,
  OAuthEmailConflictError,
  GoogleEmailRequiredError,
  GoogleSignInNotConfiguredError,
  InvalidGoogleTokenError,
  EmailCodeDisabledError,
  MfaRequiredError,
  RecentAuthRequiredError,
  RecentMfaRequiredError,
  MfaAlreadyEnabledError,
  MfaEnrollmentNotFoundError,
  MfaNotEnabledError,
} from './auth-errors.js';
import type { SignInWithGoogleParams } from './types.js';
import { getPlatform } from './platform.js';
import { DeviceMetadata } from './device-metadata.js';

export class KoolbaseAuth {
  private config: KoolbaseConfig;
  private storage: KoolbaseAuthStorage | null;
  private session: KoolbaseSession | null = null;
  private metadata: DeviceMetadata;
  private fetchFn: FetchLike;
  private timeoutMs: number;

  private ongoingRefresh: Promise<KoolbaseSession> | null = null;
  private listeners: Set<AuthStateListener> = new Set();

  constructor(config: KoolbaseConfig) {
    this.config = config;
    this.metadata = new DeviceMetadata(config.appVersion);
    this.fetchFn = config.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = config.authTimeout ?? 10_000;

    if (config.authStorage) {
      this.storage = config.authStorage;
    } else if (getPlatform().authStorage()) {
      this.storage = getPlatform().authStorage();
    } else {
      this.storage = null;
      // eslint-disable-next-line no-console
      console.warn(
        // The host names its own remedy: core serves several, and a browser
        // told to install react-native-keychain learns nothing.
        `[Koolbase] No persistent auth storage on this platform ` +
          `(${getPlatform().info.os}). Sessions will not survive a restart. ` +
          `Provide KoolbaseConfig.authStorage with your own implementation, ` +
          `or install the platform's optional storage dependency.`
      );
    }
  }

  // ─── Auth state listener ────────────────────────────────────────────────

  /**
   * Subscribe to authentication state changes. The listener fires:
   * - Immediately on subscribe, with the current user (or null).
   * - On every successful login, register, refresh, session restoration.
   * - On logout / explicit setSession(null).
   * - On linkPhone success (user object updated with phone fields).
   *
   * Returns an unsubscribe function. Call it when the consumer no longer
   * needs updates (e.g. in a React useEffect cleanup).
   *
   * Listener errors are swallowed so a buggy listener can't break auth
   * state propagation to other listeners.
   *
   * @example
   * const unsubscribe = auth.onAuthStateChange((user) => {
   *   setCurrentUser(user);
   * });
   * // later:
   * unsubscribe();
   */
  onAuthStateChange(listener: AuthStateListener): () => void {
    this.listeners.add(listener);
    // Fire immediately with current state — matches RN ecosystem
    // convention (Firebase Auth, Supabase Auth) so consumers don't
    // need to separately read currentUser on mount.
    try {
      listener(this.session?.user ?? null);
    } catch {
      // swallow
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private fireAuthStateChange(): void {
    const user = this.session?.user ?? null;
    for (const listener of this.listeners) {
      try {
        listener(user);
      } catch {
        // swallow — one broken listener doesn't break others
      }
    }
  }

  // ─── Headers ────────────────────────────────────────────────────────────

  /**
   * Compose the full header set for an outbound request: base headers,
   * device metadata, and optionally the Authorization bearer token.
   * Async because device metadata's first build may read from keychain.
   */
  private async prepareHeaders(
    includeAuth: boolean
  ): Promise<Record<string, string>> {
    const deviceHeaders = await this.metadata.build();
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.publicKey,
      ...deviceHeaders,
      ...(includeAuth && this.session
        ? { Authorization: `Bearer ${this.session.accessToken}` }
        : {}),
    };
  }

  // ─── Request plumbing ───────────────────────────────────────────────────

  /**
   * Low-level request helper used by every endpoint. Wires together:
   * - The injected fetch implementation (config.fetch or global fetch)
   * - Device metadata + x-api-key + auth header in one place
   * - AbortController-based timeout (config.authTimeout, default 10s)
   *
   * On timeout, fetch rejects with an AbortError; callers see this as a
   * non-KoolbaseAuthError exception, which restoreSession() treats as
   * Offline (preserving optimistic state).
   */
  private async authRequest(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      includeAuth?: boolean;
    } = {}
  ): Promise<Response> {
    const headers = await this.prepareHeaders(options.includeAuth ?? false);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(`${this.config.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Authenticated request wrapper. Refreshes the access token if it's
   * stale (within 1-min buffer of expiry) before issuing the call, then
   * delegates to {@link authRequest} with includeAuth=true.
   */
  private async authedRequest(
    path: string,
    options: { method?: string; body?: unknown } = {}
  ): Promise<Response> {
    await this._ensureValidToken();
    return this.authRequest(path, { ...options, includeAuth: true });
  }

  // ─── Internal session lifecycle ─────────────────────────────────────────

  /**
   * Replace the user inside the current session and persist it.
   *
   * A profile update or a fresh fetch changes the user, not the tokens.
   * Without this the new values live only in the returned object: the cached
   * `currentUser` stays stale, anything bound to `onAuthStateChange` never
   * hears about the change, and a reload restores the old name.
   *
   * No session means nobody is signed in, and there is nothing to update —
   * the caller's own request would have failed first.
   */
  private async updateUserAndPersist(user: KoolbaseUser): Promise<void> {
    if (!this.session) return;
    await this.setSessionInternal({ ...this.session, user });
  }

  private async setSessionInternal(session: KoolbaseSession): Promise<void> {
    this.session = session;
    if (this.storage) {
      try {
        await this.storage.saveSession(session);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          '[Koolbase] Failed to persist session; staying signed in for this ' +
            'session only:',
          err
        );
      }
    }
    this.fireAuthStateChange();
  }

  /**
   * Discards the stored session without contacting the server.
   *
   * For when the session is already known to be unusable — the server rejected
   * the token, or a build was pointed at a different project and the persisted
   * session belongs to the old one. Unlike `logout()` there is no server call:
   * the token has already been refused, and asking for it to be revoked would
   * only add a round trip that cannot succeed.
   *
   * Safe in any state, including with no session at all. The SDK calls this
   * itself when a request is rejected as unauthenticated, so most apps will not
   * need to.
   */
  async clearStoredSession(): Promise<void> {
    await this.clearSessionInternal();
  }

  private async clearSessionInternal(): Promise<void> {
    this.session = null;
    if (this.storage) {
      try {
        await this.storage.clear();
      } catch {
        // best effort
      }
    }
    this.fireAuthStateChange();
  }

  // ─── Session restoration ────────────────────────────────────────────────

  async restoreSession(): Promise<RestoreResult> {
    if (!this.storage) return RestoreResult.NoSession;

    const persisted = await this.storage.readSession();
    if (!persisted) return RestoreResult.NoSession;

    // Optimistic restore — populate state and fire listener before any
    // network call. App can render authenticated UI immediately.
    this.session = persisted;
    this.fireAuthStateChange();

    const expiresAt = persisted.expiresAt
      ? new Date(persisted.expiresAt).getTime()
      : 0;
    const oneMinuteMs = 60 * 1000;
    if (expiresAt > Date.now() + oneMinuteMs) {
      return RestoreResult.Restored;
    }

    try {
      await this.refresh(persisted.refreshToken);
      return RestoreResult.Restored;
    } catch (e) {
      // Only a refresh the server refused clears the stored session, and
      // only because the refresh token is the last credential there is — once
      // it is rejected there is nothing left to try.
      //
      // InvalidCredentialsError used to be in this list. It means "these
      // credentials are wrong", which during a restore points at the project
      // key or the request rather than the user's session — and deleting the
      // refresh token on that reading signs someone out with no way back.
      // Nothing reaches here with it today; it stays out so nothing does.
      if (e instanceof SessionExpiredError) {
        await this.clearSessionInternal();
        return RestoreResult.Expired;
      }
      return RestoreResult.Offline;
    }
  }

  // ─── Public auth API ────────────────────────────────────────────────────

  /**
   * Create an account.
   *
   * Two outcomes, and the caller must tell them apart. With
   * require_verified_contact off, the account is created and signed in.
   * With it on, the account is created and NO session is issued — the user
   * verifies their email before their first sign-in. Both are successes.
   *
   * Switch on `status` rather than checking the session for null: the point
   * of the union is that there is no path where an app reads the user and
   * assumes it is signed in.
   */
  async register(params: RegisterParams): Promise<SignUpResult> {
    if (params.password.length < 8) throw new WeakPasswordError();
    const res = await this.authRequest('/v1/sdk/auth/register', {
      method: 'POST',
      body: params,
    });
    if (!res.ok) await this.throwTypedError(res); // never returns

    const data = await res.json();

    // The server's own discriminator. It sends this deliberately — a 201
    // meaning "created, not signed in" — and the SDK ignored it until now,
    // building a session out of a body with no tokens in it.
    if (data.verification_required === true) {
      // Nothing is persisted and no listener fires: a pending signup is not
      // an authentication event, and an existing session on this device
      // belongs to whoever was already signed in.
      return {
        status: 'verification_required',
        user: this.mapUser(data.user),
        session: null,
      };
    }

    const session = this.sessionFromBody(data);
    await this.setSessionInternal(session);
    return { status: 'authenticated', user: session.user, session };
  }

  async login(params: LoginParams): Promise<KoolbaseSession> {
    const res = await this.authRequest('/v1/sdk/auth/login', {
      method: 'POST',
      body: params,
    });
    const session = await this.parseSessionResponse(res, false);
    await this.setSessionInternal(session);
    return session;
  }

  /**
 * Sign in with Apple using a credential obtained from a native Apple
 * Sign-In SDK.
 *
 * The SDK is library-agnostic — use any native Apple Sign-In package
 * (`@invertase/react-native-apple-authentication`, etc.) and pass the
 * resulting `identityToken`, optional `nonce`, and optional `fullName`.
 *
 * `fullName` is meaningful only on first sign-in — Apple omits name
 * data on subsequent sign-ins. The server persists at link time and
 * ignores on subsequent sign-ins.
 *
 * On success the session is persisted via the configured storage and
 * `onAuthStateChange` fires with the resolved user.
 *
 * @throws AppleSignInNotConfiguredError when Apple is not enabled in
 *   the dashboard OAuth config for this environment (400).
 * @throws InvalidAppleTokenError when the token signature, audience,
 *   expiry, replay, or nonce check failed server-side (401).
 * @throws UserDisabledError when the account flag is set to disabled (403).
 * @throws AppleEmailRequiredError when Apple did not return email for
 *   a new-account sign-in (400).
 * @throws OAuthEmailConflictError when email matches existing user
 *   but auto-link rule blocked (409).
 */

async signInWithApple(params: SignInWithAppleParams): Promise<KoolbaseSession> {
  const body: Record<string, unknown> = {
    identity_token: params.identityToken,
  };
  if (params.nonce && params.nonce.length > 0) {
    body.nonce = params.nonce;
  }
  if (params.fullName) {
    const nameJson: Record<string, string> = {};
    if (params.fullName.givenName) nameJson.given_name = params.fullName.givenName;
    if (params.fullName.familyName) nameJson.family_name = params.fullName.familyName;
    if (Object.keys(nameJson).length > 0) {
      body.full_name = nameJson;
    }
  }

  const res = await this.authRequest('/v1/sdk/auth/oauth/apple', {
    method: 'POST',
    body,
  });
  const session = await this.parseAppleSessionResponse(res);
  await this.setSessionInternal(session);
  return session;
}

/**
 * Sign in with Google using an idToken from a native Google Sign-In SDK.
 *
 * The SDK is library-agnostic — use any native Google Sign-In package
 * (`@react-native-google-signin/google-signin`, etc.) and pass the
 * resulting `idToken`. Google embeds the user's name and email in the
 * idToken itself, so this method does not take a `fullName` parameter
 * (unlike `signInWithApple`).
 *
 * On success the session is persisted via the configured storage and
 * `onAuthStateChange` fires with the resolved user.
 *
 * @throws GoogleSignInNotConfiguredError when Google is not enabled
 *   in the OAuth config for this environment (400).
 * @throws InvalidGoogleTokenError when the token signature, audience,
 *   expiry, replay, or nonce check failed server-side (401).
 * @throws UserDisabledError when the account flag is set to disabled (403).
 * @throws GoogleEmailRequiredError when Google did not return email
 *   for a new-account sign-in (400).
 * @throws OAuthEmailConflictError when email matches existing user
 *   but auto-link rule blocked (409).
 */
async signInWithGoogle(params: SignInWithGoogleParams): Promise<KoolbaseSession> {
  const body: Record<string, unknown> = {
    identity_token: params.idToken,
  };
  if (params.nonce && params.nonce.length > 0) {
    body.nonce = params.nonce;
  }

  const res = await this.authRequest('/v1/sdk/auth/oauth/google', {
    method: 'POST',
    body,
  });
  const session = await this.parseGoogleSessionResponse(res);
  await this.setSessionInternal(session);
  return session;
}

/**
 * Parses a /v1/sdk/auth/oauth/google response. Code-first: the server
 * emits unified OAuth codes (oauth_not_configured, invalid_oauth_token,
 * oauth_email_required, oauth_email_conflict) for both providers; the
 * provider distinction is made here so Google codes map to Google-specific
 * errors. Status + message logic is retained as a fallback for older servers.
 */
private async parseGoogleSessionResponse(res: Response): Promise<KoolbaseSession> {
  if (res.status === 200) {
    return this.sessionFromBody(await res.json());
  }

  let body: any = {};
  try {
    body = await res.json();
  } catch {
    // best-effort error message extraction
  }
  const code: string = body?.code ?? '';
  const errorMessage: string = body?.error ?? '';

  // ─── code-first ───
  switch (code) {
      case 'mfa_required':
        throw this.mfaRequired(body);
    case 'oauth_not_configured':
      throw new GoogleSignInNotConfiguredError();
    case 'invalid_oauth_token':
      throw new InvalidGoogleTokenError();
    case 'account_disabled':
      throw new UserDisabledError();
    case 'oauth_email_required':
      throw new GoogleEmailRequiredError();
    case 'oauth_email_conflict':
      throw new OAuthEmailConflictError();
    case 'rate_limit':
      throw new RateLimitError(errorMessage || undefined);
  }

  // ─── status + message fallback (pre-code servers) ───
  if (res.status === 400) {
    if (errorMessage.includes('not configured')) {
      throw new GoogleSignInNotConfiguredError();
    }
    if (errorMessage.includes('did not return email')) {
      throw new GoogleEmailRequiredError();
    }
    throw new KoolbaseAuthError(
      `google sign-in failed: ${errorMessage}`,
      'google_signin_failed',
    );
  }
  if (res.status === 401) throw new InvalidGoogleTokenError();
  if (res.status === 403) throw new UserDisabledError();
  if (res.status === 409) throw new OAuthEmailConflictError();
  if (res.status === 429) throw new RateLimitError(errorMessage);

  throw new KoolbaseAuthError(
    `google sign-in failed: ${res.status} ${errorMessage}`,
    `google_signin_http_${res.status}`,
  );
}

/**
 * Parses a /v1/sdk/auth/oauth/apple response. Code-first; the provider
 * distinction is made here so the server's unified OAuth codes map to
 * Apple-specific errors. Status + message logic is retained as a fallback
 * for older servers.
 */
private async parseAppleSessionResponse(res: Response): Promise<KoolbaseSession> {
  if (res.status === 200) {
    return this.sessionFromBody(await res.json());
  }

  let body: any = {};
  try {
    body = await res.json();
  } catch {
    // best-effort error message extraction
  }
  const code: string = body?.code ?? '';
  const errorMessage: string = body?.error ?? '';

  // ─── code-first ───
  switch (code) {
      case 'mfa_required':
        throw this.mfaRequired(body);
    case 'oauth_not_configured':
      throw new AppleSignInNotConfiguredError();
    case 'invalid_oauth_token':
      throw new InvalidAppleTokenError();
    case 'account_disabled':
      throw new UserDisabledError();
    case 'oauth_email_required':
      throw new AppleEmailRequiredError();
    case 'oauth_email_conflict':
      throw new OAuthEmailConflictError();
    case 'rate_limit':
      throw new RateLimitError(errorMessage || undefined);
  }

  // ─── status + message fallback (pre-code servers) ───
  if (res.status === 400) {
    if (errorMessage.includes('not configured')) {
      throw new AppleSignInNotConfiguredError();
    }
    if (errorMessage.includes('did not return email')) {
      throw new AppleEmailRequiredError();
    }
    throw new KoolbaseAuthError(
      `apple sign-in failed: ${errorMessage}`,
      'apple_signin_failed',
    );
  }
  if (res.status === 401) throw new InvalidAppleTokenError();
  if (res.status === 403) throw new UserDisabledError();
  if (res.status === 409) throw new OAuthEmailConflictError();
  if (res.status === 429) throw new RateLimitError(errorMessage);

  throw new KoolbaseAuthError(
    `apple sign-in failed: ${res.status} ${errorMessage}`,
    `apple_signin_http_${res.status}`,
  );
}

  async refresh(refreshToken?: string): Promise<KoolbaseSession> {
    if (this.ongoingRefresh) {
      return this.ongoingRefresh;
    }
    const promise = this._doRefresh(refreshToken);
    this.ongoingRefresh = promise;
    promise
      .catch(() => {
        // swallow; original promise still rejects to awaiters
      })
      .finally(() => {
        if (this.ongoingRefresh === promise) {
          this.ongoingRefresh = null;
        }
      });
    return promise;
  }

  private async _doRefresh(refreshToken?: string): Promise<KoolbaseSession> {
    const token = refreshToken ?? this.session?.refreshToken;
    if (!token) {
      throw new SessionExpiredError();
    }
    const res = await this.authRequest('/v1/sdk/auth/refresh', {
      method: 'POST',
      body: { refresh_token: token },
    });
    const session = await this.parseSessionResponse(res, true);
    await this.setSessionInternal(session);
    return session;
  }

  async logout(): Promise<boolean> {
    let serverSucceeded = true;
    try {
      if (this.session) {
        // Best-effort: don't auto-refresh during logout. If the token's
        // already expired, we still want to clear local state — server
        // will reap expired sessions itself.
        const res = await this.authRequest('/v1/sdk/auth/logout', {
          method: 'POST',
          includeAuth: true,
        });
        if (!res.ok) serverSucceeded = false;
      }
    } catch {
      serverSucceeded = false;
    } finally {
      await this.clearSessionInternal();
    }
    return serverSucceeded;
  }

  async forgotPassword(email: string): Promise<void> {
    const res = await this.authRequest('/v1/sdk/auth/password-reset', {
      method: 'POST',
      body: { email },
    });
    await this.checkResponse(res);
  }

  /**
   * Ask for a new verification email, with no session.
   *
   * For the state a project with verified contact required creates:
   * registered, unverified, refused at login, and holding a link that may
   * never have arrived or has since expired. `resendVerificationEmail()`
   * cannot help there — it needs a session the user cannot get.
   *
   * Returns nothing, and throws only on a malformed request, because the
   * server answers identically whether the address has an account, has none,
   * or is already verified. Anything else would let anyone discover who has
   * signed up. So there is no "we sent it" to report: show the same "check
   * your email" either way.
   */
  async resendVerificationEmailToAddress(email: string): Promise<void> {
    const res = await this.authRequest('/v1/sdk/auth/resend-verification/by-email', {
      method: 'POST',
      body: { email },
    });
    await this.checkResponse(res);
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const res = await this.authRequest('/v1/sdk/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, password },
    });
    await this.checkResponse(res);
  }

  /**
   * Complete email verification with a token from a verification link.
   *
   * The token comes from wherever your verification URL template pointed —
   * your own page reads it from the query string and passes it here. Throws
   * if the token is invalid, expired or already used.
   */
  async verifyEmail(token: string): Promise<void> {
    const res = await this.authRequest('/v1/sdk/auth/verify-email', {
      method: 'POST',
      body: { token },
    });
    await this.checkResponse(res);
  }

  /**
   * Re-send the verification email to the signed-in but unverified user.
   *
   * Safe to call when already verified: nothing is sent and
   * `alreadyVerified` comes back true. The server throttles this — a short
   * cooldown between sends and a daily cap — and the refusal arrives as
   * VerificationResendCooldownError carrying when to retry, or
   * VerificationResendDailyCapError when the day's allowance is spent.
   *
   * Requires a session, since the server verifies the caller rather than
   * taking an email address — otherwise this would be an open mail relay.
   */
  async resendVerificationEmail(): Promise<ResendVerificationResult> {
    const res = await this.authRequest('/v1/sdk/auth/resend-verification', {
      method: 'POST',
      includeAuth: true,
    });
    await this.checkResponse(res);
    const body = (await res.json().catch(() => ({}))) as {
      already_verified?: boolean;
      expires_at?: string | null;
      cooldown_until?: string | null;
    };
    return {
      alreadyVerified: body.already_verified ?? false,
      expiresAt: body.expires_at ? new Date(body.expires_at) : null,
      cooldownUntil: body.cooldown_until ? new Date(body.cooldown_until) : null,
    };
  }

  /**
   * The signed-in user, fetched fresh from the server.
   *
   * `currentUser` returns what was cached at sign-in; this asks. Use it when
   * something may have changed the user server-side — a verification
   * completing, a profile updated from another device — and persist the
   * result so the cached copy stops being stale.
   */
  async getCurrentUser(): Promise<KoolbaseUser> {
    const res = await this.authRequest('/v1/sdk/auth/me', {
      method: 'GET',
      includeAuth: true,
    });
    await this.checkResponse(res);
    const user = this.mapUser(await res.json());
    await this.updateUserAndPersist(user);
    return user;
  }

  /**
   * Update the signed-in user's profile.
   *
   * Only the fields given are sent, so passing one leaves the other
   * untouched. The updated user is persisted, so `currentUser` reflects it
   * without a refetch.
   */
  async updateProfile(params: {
    fullName?: string;
    avatarUrl?: string;
  }): Promise<KoolbaseUser> {
    const body: Record<string, string> = {};
    if (params.fullName !== undefined) body.full_name = params.fullName;
    if (params.avatarUrl !== undefined) body.avatar_url = params.avatarUrl;

    const res = await this.authRequest('/v1/sdk/auth/me', {
      method: 'PATCH',
      body,
      includeAuth: true,
    });
    await this.checkResponse(res);
    const user = this.mapUser(await res.json());
    await this.updateUserAndPersist(user);
    return user;
  }

  /**
   * Change the signed-in user's password.
   *
   * The current password is required: a stolen session should not be enough
   * to lock the real owner out. A wrong one throws
   * CurrentPasswordIncorrectError — the server returns `invalid_password`,
   * which reads like a rejected new password and means the opposite.
   *
   * An account that signed up through Google or Apple has no password to
   * change and gets the same error, deliberately, so a caller cannot probe
   * which sign-in methods an account has.
   */
  async changePassword(params: {
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    if (params.newPassword.length < 8) throw new WeakPasswordError();
    const res = await this.authRequest('/v1/sdk/auth/me/password', {
      method: 'PATCH',
      body: {
        current_password: params.currentPassword,
        new_password: params.newPassword,
      },
      includeAuth: true,
    });
    await this.checkResponse(res);
  }

  /**
   * Delete the signed-in user's account, and sign out.
   *
   * Deletes the caller only — there is no user id to pass, which is the
   * security property. The server removes the auth record and every session
   * on every device, then fires an `auth.user.deleted` trigger.
   *
   * It does NOT delete the account's records in your collections. Koolbase
   * cannot know whether a row should be deleted, anonymised, or kept for a
   * statutory retention period. Subscribe a Function to `auth.user.deleted`
   * and clean up there — it runs server-side, so a tab closing mid-flow
   * cannot strand anything.
   */
  async deleteAccount(): Promise<void> {
    const res = await this.authRequest('/v1/sdk/auth/me', {
      method: 'DELETE',
      includeAuth: true,
    });
    await this.checkResponse(res);
    await this.clearSessionInternal();
  }

  /**
   * Every session the signed-in user has — a "where you're signed in" list.
   *
   * Newest first is not guaranteed; sort by createdAt if the order matters.
   * The entry with `isCurrent` is this device.
   */
  async listSessions(): Promise<KoolbaseSessionInfo[]> {
    const res = await this.authRequest('/v1/sdk/auth/sessions', {
      method: 'GET',
      includeAuth: true,
    });
    await this.checkResponse(res);
    const body = (await res.json()) as { sessions?: unknown[] };
    return (body.sessions ?? []).map((s) => {
      const r = s as Record<string, unknown>;
      return {
        id: String(r.id),
        ip: r.ip as string | undefined,
        userAgent: r.user_agent as string | undefined,
        deviceLabel: r.device_label as string | undefined,
        createdAt: String(r.created_at),
        expiresAt: String(r.expires_at),
        isCurrent: Boolean(r.is_current),
      };
    });
  }

  /**
   * Sign out one session by id.
   *
   * Revoking the current one ends this session too — the server does not
   * refuse it, and the local session is cleared here so the app does not keep
   * a token the server has dropped. Use logout() when that is what you mean.
   */
  async revokeSession(sessionId: string): Promise<void> {
    const res = await this.authRequest(
      `/v1/sdk/auth/sessions/${encodeURIComponent(sessionId)}/revoke`,
      { method: 'POST', includeAuth: true }
    );
    await this.checkResponse(res);

    // Revoking your own session leaves a token the server has dropped. The
    // SDK cannot tell from the response which one it was, and re-listing to
    // find out would cost a request on every revoke — so it asks the only
    // party that already knows: the next request. If it was this session,
    // that request 401s and the normal refresh path clears it.
    //
    // A UI listing sessions knows which row is current from isCurrent, and
    // should call logout() rather than revokeSession() for that one, which
    // is both clearer to the user and one fewer round trip.
  }

  /**
   * Sign out every OTHER session, keeping this one.
   *
   * What "sign out my other devices" means after a lost phone. Returns how
   * many were ended, so an app can say so rather than guess.
   */
  async revokeAllOtherSessions(): Promise<number> {
    const res = await this.authRequest('/v1/sdk/auth/sessions/revoke-all', {
      method: 'POST',
      includeAuth: true,
    });
    await this.checkResponse(res);
    const body = (await res.json().catch(() => ({}))) as { revoked_count?: number };
    return body.revoked_count ?? 0;
  }

  /**
   * What has happened to this account — sign-ins, failures, lockouts,
   * password changes.
   *
   * For a "recent security activity" screen. The server sanitizes each
   * event, so this carries what that event type is allowed to say and
   * nothing more.
   *
   * @param limit up to 200; the server caps it there.
   */
  async auditLog(options?: {
    limit?: number;
    offset?: number;
  }): Promise<KoolbaseAuditPage> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) params.set('limit', String(options.limit));
    if (options?.offset !== undefined) params.set('offset', String(options.offset));
    const qs = params.toString();

    const res = await this.authRequest(
      `/v1/sdk/auth/audit${qs ? `?${qs}` : ''}`,
      { method: 'GET', includeAuth: true }
    );
    await this.checkResponse(res);
    const body = (await res.json()) as Record<string, unknown>;

    return {
      events: ((body.events as Record<string, unknown>[]) ?? []).map((e) => ({
        id: String(e.id),
        eventType: String(e.event_type),
        occurredAt: String(e.occurred_at),
        ip: e.ip as string | undefined,
        userAgent: e.user_agent as string | undefined,
        eventData: (e.event_data as Record<string, unknown>) ?? {},
      })),
      total: Number(body.total ?? 0),
      limit: Number(body.limit ?? 0),
      offset: Number(body.offset ?? 0),
    };
  }

  async unlock(token: string): Promise<void> {
    const res = await this.authRequest('/v1/sdk/auth/unlock', {
      method: 'POST',
      body: { token },
    });
    await this.checkResponse(res);
  }

  get currentUser(): KoolbaseUser | null {
    return this.session?.user ?? null;
  }

  get accessToken(): string | null {
    return this.session?.accessToken ?? null;
  }

  /**
   * Currently-valid access token for data-plane requests, refreshing
   * (via refresh()) if the cached one is near expiry. Returns null when no
   * session exists or refresh fails — callers then go api-key-only and the
   * server treats it as having no end-user identity. The db/storage/functions
   * clients pull from this per request so identity follows the live session.
   */
  async validAccessToken(): Promise<string | null> {
    if (!this.session) return null;
    try {
      return await this._ensureValidToken();
    } catch {
      return null;
    }
  }

  async setSession(session: KoolbaseSession | null): Promise<void> {
    if (session) {
      await this.setSessionInternal(session);
    } else {
      await this.clearSessionInternal();
    }
  }

  // ─── OAuth (DEPRECATED — see v1.10.0) ───────────────────────────────────

  /**
   * @deprecated Never implemented; kept only so existing code compiles.
   * Google and Apple sign-in are supported — use signInWithGoogle() or
   * signInWithApple(). This used to say OAuth was not yet shipped and to
   * use email and password instead, which stopped being true long ago.
   *
   * @throws Always throws KoolbaseAuthError('not_implemented').
   */
  async oauthLogin(_params: {
    provider: string;
    token: string;
    email?: string;
    name?: string;
    avatarUrl?: string;
  }): Promise<never> {
    throw new KoolbaseAuthError(
      'oauthLogin() was never implemented and is kept only so existing ' +
        'code compiles. Use signInWithGoogle() or signInWithApple().',
      'not_implemented'
    );
  }

  // ─── Email code ─────────────────────────────────────────────────────────

  /**
   * Emails a six-digit sign-in code.
   *
   * Resolves the same way whether or not the address has an account, so it
   * cannot be used to check who is registered. A new address receives a code
   * only while the project accepts sign-ups; a disabled account receives
   * nothing.
   *
   * @throws EmailCodeDisabledError if the project has switched this off
   * @throws RateLimitError after too many requests for one address
   */
  async requestEmailCode(params: { email: string }): Promise<void> {
    const res = await this.authRequest('/v1/sdk/auth/email/code', {
      method: 'POST',
      body: { email: params.email },
    });
    if (!res.ok) await this.throwTypedError(res, false);
  }

  /**
   * Signs in with a code from requestEmailCode(), storing the session exactly
   * as login() does. An unknown address becomes an account only if the
   * project still accepts sign-ups at this moment. Each code works once and
   * allows three attempts.
   *
   * @throws OtpInvalidError, OtpExpiredError, OtpMaxAttemptsError
   * @throws EmailCodeDisabledError if the project has switched this off
   */
  async signInWithEmailCode(params: { email: string; code: string }): Promise<KoolbaseSession> {
    const res = await this.authRequest('/v1/sdk/auth/email/code/verify', {
      method: 'POST',
      body: { email: params.email, code: params.code },
    });
    const session = await this.parseSessionResponse(res, false);
    await this.setSessionInternal(session);
    return session;
  }

  // ─── Two-step sign-in (MFA) ─────────────────────────────────────────────
  //
  // When an account has MFA on, every sign-in method throws MfaRequiredError.
  // Finish with verifyMfa() or verifyRecoveryCode().

  // One builder for every parser, so the four cannot drift apart in how the
  // challenge reaches the app.
  private mfaRequired(body: any): MfaRequiredError {
    const d = body?.details ?? {};
    return new MfaRequiredError(String(d.challenge_token ?? ''), d.expires_at);
  }

  /** Finishes sign-in with a code from the person's authenticator app. */
  async verifyMfa(params: { challengeToken: string; code: string }): Promise<KoolbaseSession> {
    const res = await this.authRequest('/v1/sdk/auth/mfa/verify', {
      method: 'POST',
      body: { challenge_token: params.challengeToken, code: params.code },
    });
    const session = await this.parseSessionResponse(res, false);
    await this.setSessionInternal(session);
    return session;
  }

  /**
   * Finishes sign-in with a recovery code. Each works once; prompt the person
   * to regenerate when recoveryCodesRemaining reaches zero.
   */
  async verifyRecoveryCode(params: {
    challengeToken: string;
    code: string;
  }): Promise<{ session: KoolbaseSession; recoveryCodesRemaining: number }> {
    const res = await this.authRequest('/v1/sdk/auth/mfa/verify-recovery', {
      method: 'POST',
      body: { challenge_token: params.challengeToken, code: params.code },
    });
    if (!res.ok) await this.throwTypedError(res, false);
    // Read once: the session and the remaining count come from one body.
    const data = await res.json();
    if (!data?.access_token) throw new MalformedSessionResponseError('an access token');
    if (!data?.refresh_token) throw new MalformedSessionResponseError('a refresh token');
    const session: KoolbaseSession = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
      user: this.mapUser(data.user),
    };
    await this.setSessionInternal(session);
    return { session, recoveryCodesRemaining: Number(data.recovery_codes_remaining ?? 0) };
  }

  /**
   * Starts adding an authenticator; needs a sign-in within ten minutes. Show
   * otpauthUri as a QR code, then call confirmMfaEnrollment with the first
   * code the app shows.
   */
  async enrollMfa(): Promise<{ otpauthUri: string; secret: string }> {
    const res = await this.authRequest('/v1/sdk/auth/mfa/enroll', { method: 'POST', includeAuth: true });
    await this.checkResponse(res);
    const d = await res.json();
    return { otpauthUri: d.otpauth_uri, secret: d.secret };
  }

  /** Turns MFA on and returns ten recovery codes, shown this once only. Other devices are signed out. */
  async confirmMfaEnrollment(code: string): Promise<string[]> {
    const res = await this.authRequest('/v1/sdk/auth/mfa/enroll/confirm', {
      method: 'POST',
      body: { code },
      includeAuth: true,
    });
    await this.checkResponse(res);
    return (await res.json()).recovery_codes as string[];
  }

  async mfaStatus(): Promise<{ enabled: boolean; recoveryCodesRemaining: number }> {
    const res = await this.authRequest('/v1/sdk/auth/mfa', { method: 'GET', includeAuth: true });
    await this.checkResponse(res);
    const d = await res.json();
    return { enabled: !!d.enabled, recoveryCodesRemaining: Number(d.recovery_codes_remaining ?? 0) };
  }

  /** Re-confirms the second factor, opening ten minutes to change MFA. */
  async stepUpMfa(params: { code?: string; recoveryCode?: string }): Promise<void> {
    const res = await this.authRequest('/v1/sdk/auth/mfa/step-up', {
      method: 'POST',
      body: {
        ...(params.code ? { code: params.code } : {}),
        ...(params.recoveryCode ? { recovery_code: params.recoveryCode } : {}),
      },
      includeAuth: true,
    });
    await this.checkResponse(res);
  }

  /** Turns MFA off. Needs stepUpMfa() within the last ten minutes. */
  async disableMfa(): Promise<void> {
    const res = await this.authRequest('/v1/sdk/auth/mfa/disable', { method: 'POST', includeAuth: true });
    await this.checkResponse(res);
  }

  /** Replaces all recovery codes; the old ones stop working. Needs stepUpMfa() within ten minutes. */
  async regenerateRecoveryCodes(): Promise<string[]> {
    const res = await this.authRequest('/v1/sdk/auth/mfa/recovery-codes', { method: 'POST', includeAuth: true });
    await this.checkResponse(res);
    return (await res.json()).recovery_codes as string[];
  }

  // ─── Phone OTP ──────────────────────────────────────────────────────────

  async sendOtp(params: SendOtpParams): Promise<OtpSendResult> {
    this.validatePhone(params.phoneNumber);
    const res = await this.authRequest('/v1/sdk/auth/phone/send-otp', {
      method: 'POST',
      body: { phone_number: params.phoneNumber },
    });
    const data = await this.parsePhoneResponse(res);
    return { expiresAt: data.expires_at };
  }

  async verifyOtp(params: VerifyOtpParams): Promise<PhoneVerifyResult> {
    this.validatePhone(params.phoneNumber);
    const res = await this.authRequest('/v1/sdk/auth/phone/verify-otp', {
      method: 'POST',
      body: {
        phone_number: params.phoneNumber,
        code: params.code,
      },
    });
    const data = await this.parsePhoneResponse(res);

    const session: KoolbaseSession = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
      user: this.mapUser(data.user),
    };

    await this.setSessionInternal(session);
    return { session, isNewUser: data.is_new_user ?? false };
  }

  async linkPhone(params: LinkPhoneParams): Promise<void> {
    if (!this.session) {
      throw new KoolbaseAuthError(
        'Must be signed in to link a phone number',
        'unauthenticated'
      );
    }
    this.validatePhone(params.phoneNumber);
    const res = await this.authedRequest('/v1/sdk/auth/phone/link', {
      method: 'POST',
      body: {
        phone_number: params.phoneNumber,
        code: params.code,
      },
    });
    const body = await this.parsePhoneResponse(res);

    // Update local session: prefer the canonical user from the server
    // response if present; otherwise merge the linked phone into the
    // existing in-memory user. Either way, setSessionInternal fires the
    // auth state listener so consumers can react to the phone link.
    if (this.session) {
      const updatedUser: KoolbaseUser = body.user
        ? this.mapUser(body.user)
        : {
            ...this.session.user,
            phoneNumber: params.phoneNumber,
            phoneVerified: true,
          };
      await this.setSessionInternal({
        ...this.session,
        user: updatedUser,
      });
    }
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────

  /**
   * Release resources held by this auth client. Clears the in-memory
   * listener set. Does not invalidate sessions or clear storage — call
   * {@link logout} for that.
   */
  dispose(): void {
    this.listeners.clear();
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private validatePhone(phoneNumber: string): void {
    if (!/^\+[1-9]\d{6,14}$/.test(phoneNumber)) {
      throw new InvalidPhoneNumberError();
    }
  }

  private async _ensureValidToken(): Promise<string> {
    if (this.session && this.session.expiresAt) {
      const expiresAt = new Date(this.session.expiresAt).getTime();
      if (Date.now() < expiresAt - 60 * 1000) {
        return this.session.accessToken;
      }
    }
    if (!this.session) {
      throw new SessionExpiredError();
    }
    try {
      const session = await this.refresh();
      return session.accessToken;
    } catch (e) {
      if (e instanceof KoolbaseAuthError) throw e;
      throw new SessionExpiredError();
    }
  }

  private mapUser(raw: any): KoolbaseUser {
    return {
      id: raw.id,
      email: raw.email ?? '',
      phoneNumber: raw.phone_number,
      phoneVerified: raw.phone_verified ?? false,
      fullName: raw.full_name,
      avatarUrl: raw.avatar_url,
      verified: raw.verified ?? false,
      createdAt: raw.created_at,
    };
  }

  /**
   * Parse a session-returning response (login, register, refresh).
   * Non-2xx is delegated to throwTypedError, which is code-first
   * (reads body.code) with a status/message fallback. isRefresh only
   * affects how a bare 401 (no code, older server) is interpreted.
   */
  private async parseSessionResponse(
    res: Response,
    isRefresh: boolean
  ): Promise<KoolbaseSession> {
    if (!res.ok) await this.throwTypedError(res, isRefresh); // never returns

    return this.sessionFromBody(await res.json());
  }

  /**
   * A session, or a refusal — never a session-shaped object with nothing in
   * it.
   *
   * This used to read the fields straight off the body, so a response with no
   * tokens produced a session whose accessToken was undefined. It persisted,
   * currentUser returned a user, and every authenticated request went out as
   * `Bearer undefined` and came back 401 — signed in as far as the app could
   * tell, and unable to do anything. A user object without tokens is not a
   * session, and refusing is the only honest answer.
   */
  private sessionFromBody(data: any): KoolbaseSession {
    if (!data?.access_token) throw new MalformedSessionResponseError('an access token');
    if (!data?.refresh_token) throw new MalformedSessionResponseError('a refresh token');
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
      user: this.mapUser(data.user),
    };
  }

  private async checkResponse(res: Response): Promise<void> {
    if (res.ok) return;
    await this.throwTypedError(res);
  }

  /**
   * Map a non-2xx credential/session response to a typed error.
   *
   * Code-first: the server now emits a stable `code` on every error
   * (contract conformance), so we switch on body.code. The status +
   * message logic is retained as a fallback for older servers or any
   * response that arrives without a code. isRefresh only changes how a
   * bare 401 is interpreted in the fallback path.
   */
  private async throwTypedError(res: Response, isRefresh = false): Promise<never> {
    let body: any = {};
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    const code: string = body.code ?? '';
    const msg: string = body.error ?? '';

    // ─── code-first ───
    switch (code) {
      case 'mfa_required':
        throw this.mfaRequired(body);
      case 'recent_auth_required':
        throw new RecentAuthRequiredError();
      case 'recent_mfa_required':
        throw new RecentMfaRequiredError();
      case 'mfa_already_enabled':
        throw new MfaAlreadyEnabledError();
      case 'mfa_enrollment_not_found':
        throw new MfaEnrollmentNotFoundError();
      case 'mfa_not_enabled':
        throw new MfaNotEnabledError();
      case 'invalid_credentials':
        throw new InvalidCredentialsError();
      case 'email_in_use':
        throw new EmailAlreadyInUseError();
      case 'account_disabled':
        throw new UserDisabledError();
      case 'account_locked':
        throw new AccountLockedError();
      case 'invalid_refresh_token':
        // Refresh token rejected — the session is unrecoverable; re-login.
        throw new SessionExpiredError();
      case 'invalid_unlock_token':
        throw new UnlockTokenInvalidError();
      case 'rate_limit':
        throw new RateLimitError(msg || undefined);
      // Verification state. Two codes, one situation — projectauth and the
      // dashboard's auth package name it differently and an app should not
      // have to know which spoke.

      // Verification state. Two codes, one situation — projectauth and the
      // dashboard's auth package name it differently and an app should not
      // have to know which spoke.
      case 'contact_not_verified':
      case 'email_not_verified':
        throw new ContactNotVerifiedError(msg || undefined);

      // Sign-in codes. The otp_* codes are shared with phone sign-in; mapped
      // here, every path that returns them throws the class an app catches.
      case 'email_code_disabled':
        throw new EmailCodeDisabledError();
      case 'otp_expired':
        throw new OtpExpiredError();
      case 'otp_invalid':
        throw new OtpInvalidError();
      case 'otp_max_attempts':
        throw new OtpMaxAttemptsError();

      // Registration
      case 'signups_disabled':
        throw new SignupsDisabledError(msg || undefined);
      case 'weak_password':
        // The class existed and was only ever thrown client-side for length.
        // The server has its own rules, and a password that passes ours and
        // fails theirs deserves the same error, not a generic one.
        throw new WeakPasswordError(msg || undefined);
      case 'account_exists':
        throw new AccountExistsError(msg || undefined);

      // Link tokens — verification and password reset
      case 'token_expired':
        throw new TokenExpiredError(msg || undefined);
      case 'token_used':
        throw new TokenAlreadyUsedError(msg || undefined);
      case 'invalid_token':
        throw new UnlockTokenInvalidError();

      // Password change
      case 'invalid_password':
        throw new CurrentPasswordIncorrectError(msg || undefined);

      // OAuth
      case 'oauth_only_account':
        throw new OAuthOnlyAccountError(msg || undefined);
      case 'unsupported_oauth_provider':
        throw new UnsupportedOAuthProviderError(msg || undefined);
      case 'identity_not_found':
        throw new IdentityNotFoundError(msg || undefined);
      case 'provider_identity_already_linked':
        throw new ProviderIdentityAlreadyLinkedError(msg || undefined);
      case 'insufficient_scope':
        throw new InsufficientScopeError(msg || undefined);

      // Authority
      case 'session_required':
        throw new SessionRequiredError(msg || undefined);
      case 'insufficient_authority':
        throw new InsufficientAuthorityError(msg || undefined);
      case 'last_credential':
        throw new LastCredentialError(msg || undefined);
      case 'hide_requires_verification':
        throw new HideRequiresVerificationError(msg || undefined);

      case 'resend_cooldown':
        throw new VerificationResendCooldownError(
          body.cooldown_until ? new Date(body.cooldown_until) : null,
          msg || undefined
        );
      case 'resend_daily_cap':
        throw new VerificationResendDailyCapError(msg || undefined);
    }

    // ─── status fallback (pre-code servers) ───
    if (res.status === 409) throw new EmailAlreadyInUseError();
    if (res.status === 401) {
      throw isRefresh ? new SessionExpiredError() : new InvalidCredentialsError();
    }
    if (res.status === 403) throw new UserDisabledError();
    if (res.status === 429) {
      if (msg.includes('account temporarily locked')) {
        throw new AccountLockedError();
      }
      throw new RateLimitError(msg || undefined);
    }

    // ─── legacy message fallback ───
    if (msg.includes('invalid or expired unlock token')) {
      throw new UnlockTokenInvalidError();
    }
    throw new KoolbaseAuthError(
      msg || `Request failed: ${res.status}`,
      code || `http_${res.status}`
    );
  }

  /**
   * Parse a phone-auth response. Code-first, with a phone-specific twist:
   * the server emits the generic `rate_limit` code for the phone endpoints
   * (they share the default 429), but phone has a dedicated server-side
   * rate-limiter, so we surface OtpRateLimitError rather than RateLimitError.
   * Status + message logic is retained as a fallback for older servers.
   */
  private async parsePhoneResponse(res: Response): Promise<any> {
    let body: any = {};
    try {
      body = await res.json();
    } catch {
      // ignore
    }

    if (res.ok) return body;

    const code: string = body.code ?? '';
    const msg: string = body.error ?? '';

    // ─── code-first ───
    switch (code) {
      case 'mfa_required':
        throw this.mfaRequired(body);
      case 'invalid_phone':
        throw new InvalidPhoneNumberError();
      case 'otp_expired':
        throw new OtpExpiredError();
      case 'otp_invalid':
        throw new OtpInvalidError();
      case 'otp_max_attempts':
        throw new OtpMaxAttemptsError();
      case 'phone_in_use':
        throw new PhoneAlreadyLinkedError();
      case 'sms_not_configured':
        throw new SmsConfigMissingError();
      case 'rate_limit':
        throw new OtpRateLimitError();
    }

    // ─── status fallback (pre-code servers) ───
    if (res.status === 429) throw new OtpRateLimitError();
    if (res.status === 409) throw new PhoneAlreadyLinkedError();

    // ─── legacy message fallback ───
    if (msg.includes('E.164')) throw new InvalidPhoneNumberError();
    if (msg.includes('OTP has expired')) throw new OtpExpiredError();
    if (msg.includes('too many incorrect attempts')) {
      throw new OtpMaxAttemptsError();
    }
    if (
      msg.includes('invalid OTP') ||
      msg.includes('invalid or expired OTP')
    ) {
      throw new OtpInvalidError();
    }
    if (msg.includes('SMS provider not configured')) {
      throw new SmsConfigMissingError();
    }

    throw new KoolbaseAuthError(msg || 'An unexpected error occurred', code || undefined);
  }
}
