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
  SendOtpParams,
  SignInWithAppleParams,
  VerifyOtpParams,
} from './types';
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
  RateLimitError,
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
} from './auth-errors';
import { SecureAuthStorage, isKeychainAvailable } from './auth-storage';
import { DeviceMetadata } from './device-metadata';

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
    } else if (isKeychainAvailable()) {
      this.storage = new SecureAuthStorage();
    } else {
      this.storage = null;
      // eslint-disable-next-line no-console
      console.warn(
        '[Koolbase] No persistent auth storage available. Sessions will not ' +
          'survive app restarts. Install react-native-keychain for the ' +
          'default secure backend, or provide KoolbaseConfig.authStorage ' +
          'with your own implementation.'
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
      if (
        e instanceof SessionExpiredError ||
        e instanceof TokenRevokedError ||
        e instanceof InvalidCredentialsError
      ) {
        await this.clearSessionInternal();
        return RestoreResult.Expired;
      }
      return RestoreResult.Offline;
    }
  }

  // ─── Public auth API ────────────────────────────────────────────────────

  async register(params: RegisterParams): Promise<KoolbaseUser> {
    if (params.password.length < 8) throw new WeakPasswordError();
    const res = await this.authRequest('/v1/sdk/auth/register', {
      method: 'POST',
      body: params,
    });
    const session = await this.parseSessionResponse(res, false);
    await this.setSessionInternal(session);
    return session.user;
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
 * Parses a /v1/sdk/auth/oauth/apple response. Distinct from
 * parseSessionResponse because OAuth error semantics differ from
 * credential auth — status codes map to a separate error set.
 */
private async parseAppleSessionResponse(res: Response): Promise<KoolbaseSession> {
  if (res.status === 200) {
    const data = await res.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
      user: this.mapUser(data.user),
    };
  }

  let errorMessage = '';
  try {
    const data = await res.json();
    errorMessage = data?.error ?? '';
  } catch {
    // best-effort error message extraction
  }

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

  async resetPassword(token: string, password: string): Promise<void> {
    const res = await this.authRequest('/v1/sdk/auth/password-reset/confirm', {
      method: 'POST',
      body: { token, password },
    });
    await this.checkResponse(res);
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

  async setSession(session: KoolbaseSession | null): Promise<void> {
    if (session) {
      await this.setSessionInternal(session);
    } else {
      await this.clearSessionInternal();
    }
  }

  // ─── OAuth (DEPRECATED — see v1.10.0) ───────────────────────────────────

  /**
   * @deprecated v1.9.0: Server endpoint /v1/sdk/auth/oauth not yet
   * shipped. This method previously routed to /v1/auth/oauth (dashboard
   * developer OAuth) which never created project-scoped end-user
   * sessions. Properly implemented in v1.10.0 with provider-specific
   * server endpoints under /v1/sdk/auth/oauth/{apple,google,github}.
   * Use email/password sign-in for now.
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
      'OAuth sign-in is not yet implemented for the Koolbase SDK. ' +
        'Planned for v1.10.0 (server-side endpoints under ' +
        '/v1/sdk/auth/oauth/{provider}). Use email/password authentication ' +
        'in the meantime.',
      'not_implemented'
    );
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

  private async parseSessionResponse(
    res: Response,
    isRefresh: boolean
  ): Promise<KoolbaseSession> {
    if (res.status === 409) throw new EmailAlreadyInUseError();
    if (res.status === 401) {
      throw isRefresh ? new SessionExpiredError() : new InvalidCredentialsError();
    }
    if (res.status === 403) throw new UserDisabledError();
    if (!res.ok) await this.throwTypedError(res);

    const data = await res.json();
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

  private async throwTypedError(res: Response): Promise<never> {
    let body: any = {};
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    const msg: string = body.error ?? '';

    if (res.status === 429) {
      if (msg.includes('account temporarily locked')) {
        throw new AccountLockedError();
      }
      throw new RateLimitError(msg || undefined);
    }

    if (msg.includes('invalid or expired unlock token')) {
      throw new UnlockTokenInvalidError();
    }

    if (
      msg.includes('session revoked') ||
      msg.includes('token revoked') ||
      msg.includes('session has been revoked')
    ) {
      throw new TokenRevokedError();
    }

    throw new KoolbaseAuthError(
      msg || `Request failed: ${res.status}`,
      `http_${res.status}`
    );
  }

  private async parsePhoneResponse(res: Response): Promise<any> {
    let body: any = {};
    try {
      body = await res.json();
    } catch {
      // ignore
    }

    if (res.ok) return body;

    const msg: string = body.error ?? '';

    if (res.status === 429) throw new OtpRateLimitError();
    if (res.status === 409) throw new PhoneAlreadyLinkedError();

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

    throw new KoolbaseAuthError(msg || 'An unexpected error occurred');
  }
}
