import {
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
} from './auth-errors';
import { SecureAuthStorage, isKeychainAvailable } from './auth-storage';

export class KoolbaseAuth {
  private config: KoolbaseConfig;
  private storage: KoolbaseAuthStorage | null;
  private session: KoolbaseSession | null = null;

  /**
   * Single-flight refresh slot. Multiple concurrent callers that hit
   * {@link _ensureValidToken} or {@link refresh} while a refresh is in
   * progress share the same Promise and receive the same resulting
   * session — avoiding the race where parallel callers each trigger
   * their own refresh and the server rotates the refresh token from
   * under the in-flight peers.
   */
  private ongoingRefresh: Promise<KoolbaseSession> | null = null;

  constructor(config: KoolbaseConfig) {
    this.config = config;

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

  // ─── Headers ────────────────────────────────────────────────────────────

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.publicKey,
    };
  }

  private get authHeaders(): Record<string, string> {
    return {
      ...this.headers,
      ...(this.session
        ? { Authorization: `Bearer ${this.session.accessToken}` }
        : {}),
    };
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
  }

  private async clearSessionInternal(): Promise<void> {
    this.session = null;
    if (this.storage) {
      try {
        await this.storage.clear();
      } catch {
        // Best effort.
      }
    }
  }

  // ─── Session restoration ────────────────────────────────────────────────

  async restoreSession(): Promise<RestoreResult> {
    if (!this.storage) return RestoreResult.NoSession;

    const persisted = await this.storage.readSession();
    if (!persisted) return RestoreResult.NoSession;

    // Optimistic restore — populate state from disk before any network.
    this.session = persisted;

    // If access token is still valid (with 1-min buffer), we're done.
    const expiresAt = persisted.expiresAt
      ? new Date(persisted.expiresAt).getTime()
      : 0;
    const oneMinuteMs = 60 * 1000;
    if (expiresAt > Date.now() + oneMinuteMs) {
      return RestoreResult.Restored;
    }

    // Access token expired (or no expiresAt) — attempt to refresh.
    try {
      await this.refresh(persisted.refreshToken);
      return RestoreResult.Restored;
    } catch (e) {
      // Definitive auth-rejection types clear the session — refresh token
      // is no longer valid, user must log in again. Everything else (5xx,
      // rate-limit, network) keeps the optimistic state for retry later.
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
    const res = await fetch(`${this.config.baseUrl}/v1/sdk/auth/register`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(params),
    });
    const session = await this.parseSessionResponse(res, false);
    await this.setSessionInternal(session);
    return session.user;
  }

  async login(params: LoginParams): Promise<KoolbaseSession> {
    const res = await fetch(`${this.config.baseUrl}/v1/sdk/auth/login`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(params),
    });
    const session = await this.parseSessionResponse(res, false);
    await this.setSessionInternal(session);
    return session;
  }

  /**
   * Refresh the access token using the supplied refresh token (or the
   * persisted/in-memory one if not provided).
   *
   * Concurrent calls are deduplicated via a single-flight Promise slot —
   * multiple simultaneous callers share one underlying refresh and
   * receive the same resulting session (or same error). This prevents
   * the race where parallel refreshes each rotate the refresh token,
   * invalidating peers mid-flight.
   */
  async refresh(refreshToken?: string): Promise<KoolbaseSession> {
    // Share an in-flight refresh if one exists.
    if (this.ongoingRefresh) {
      return this.ongoingRefresh;
    }

    // Claim the slot synchronously. JavaScript is single-threaded so the
    // check above and the assignment below are atomic relative to other
    // SDK callers — no await between them.
    const promise = this._doRefresh(refreshToken);
    this.ongoingRefresh = promise;

    // Clear the slot once the refresh settles (whether resolved or
    // rejected). The strict-equality check protects against the rare
    // case where another refresh has already replaced this one.
    promise
      .catch(() => {
        // swallow; the original promise still rejects to awaiters
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
    const res = await fetch(`${this.config.baseUrl}/v1/sdk/auth/refresh`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ refresh_token: token }),
    });
    const session = await this.parseSessionResponse(res, true);
    await this.setSessionInternal(session);
    return session;
  }

  /**
   * Log the user out.
   *
   * The local session is **always cleared**, regardless of whether the
   * server-side logout succeeded. Intentional best-effort behavior: a
   * network error during logout should not leave the user locally
   * "logged in" with a stale token — that's a worse UX (and a security
   * regression on shared devices) than a silent server-side stale-session.
   *
   * Returns `true` if the server-side logout call succeeded (or if there
   * was no session to invalidate); `false` if the server call failed.
   * Apps that need to handle server-side failure explicitly can branch
   * on this; apps that don't care can ignore the return value.
   */
  async logout(): Promise<boolean> {
    let serverSucceeded = true;
    try {
      if (this.session) {
        const res = await fetch(`${this.config.baseUrl}/v1/sdk/auth/logout`, {
          method: 'POST',
          headers: this.authHeaders,
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
    const res = await fetch(
      `${this.config.baseUrl}/v1/sdk/auth/password-reset`,
      {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ email }),
      }
    );
    await this.checkResponse(res);
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const res = await fetch(
      `${this.config.baseUrl}/v1/sdk/auth/password-reset/confirm`,
      {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ token, password }),
      }
    );
    await this.checkResponse(res);
  }

  /**
   * Consume an unlock token from a brute-force unlock email. Apps
   * typically extract this token from a deep link parameter when the
   * user clicks the unlock link.
   *
   * Throws {@link UnlockTokenInvalidError} if the token is invalid,
   * expired, or already consumed (one-shot).
   */
  async unlock(token: string): Promise<void> {
    const res = await fetch(`${this.config.baseUrl}/v1/sdk/auth/unlock`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ token }),
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

  // ─── OAuth (DEPRECATED — see Batch C) ───────────────────────────────────

  /**
   * @deprecated Server endpoint /v1/sdk/auth/oauth not yet shipped. This
   * method previously targeted /v1/auth/oauth (dashboard developer OAuth)
   * which never created project-scoped end-user sessions. Properly
   * implemented in v2.10.x. For Sign in with Apple use KoolbaseAppleAuth —
   * same status applies (deprecated cascadingly in Batch C). Use
   * email/password for now.
   */
  async oauthLogin({
    provider,
    token,
    email = '',
    name = '',
    avatarUrl = '',
  }: {
    provider: string;
    token: string;
    email?: string;
    name?: string;
    avatarUrl?: string;
  }): Promise<Record<string, unknown> | null> {
    void provider;
    void token;
    void email;
    void name;
    void avatarUrl;
    try {
      const response = await fetch(`${this.config.baseUrl}/v1/auth/oauth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, token, email, name, avatar_url: avatarUrl }),
      });
      if (response.ok) return response.json();
      return null;
    } catch {
      return null;
    }
  }

  // ─── Phone OTP ──────────────────────────────────────────────────────────

  async sendOtp(params: SendOtpParams): Promise<OtpSendResult> {
    this.validatePhone(params.phoneNumber);
    const res = await fetch(
      `${this.config.baseUrl}/v1/sdk/auth/phone/send-otp`,
      {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ phone_number: params.phoneNumber }),
      }
    );
    const data = await this.parsePhoneResponse(res);
    return { expiresAt: data.expires_at };
  }

  async verifyOtp(params: VerifyOtpParams): Promise<PhoneVerifyResult> {
    this.validatePhone(params.phoneNumber);
    const res = await fetch(
      `${this.config.baseUrl}/v1/sdk/auth/phone/verify-otp`,
      {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          phone_number: params.phoneNumber,
          code: params.code,
        }),
      }
    );
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

  /**
   * Link a phone number to the currently authenticated user. The user
   * must already be signed in and must have requested an OTP for this
   * phone number first.
   *
   * Uses {@link _authedFetch} to auto-refresh the access token if it's
   * stale, preventing 401 errors on expired tokens.
   */
  async linkPhone(params: LinkPhoneParams): Promise<void> {
    if (!this.session) {
      throw new KoolbaseAuthError(
        'Must be signed in to link a phone number',
        'unauthenticated'
      );
    }
    this.validatePhone(params.phoneNumber);
    const res = await this._authedFetch(
      `${this.config.baseUrl}/v1/sdk/auth/phone/link`,
      {
        method: 'POST',
        body: JSON.stringify({
          phone_number: params.phoneNumber,
          code: params.code,
        }),
      }
    );
    await this.parsePhoneResponse(res);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private validatePhone(phoneNumber: string): void {
    if (!/^\+[1-9]\d{6,14}$/.test(phoneNumber)) {
      throw new InvalidPhoneNumberError();
    }
  }

  /**
   * Ensure the access token is fresh, refreshing if it's expired or
   * within a 1-minute buffer of expiry. Throws {@link SessionExpiredError}
   * if no session is available or refresh fails.
   */
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

  /**
   * Wrapper around fetch that auto-refreshes the access token before
   * making an authenticated call. Use this for any endpoint that
   * requires `Authorization: Bearer …`.
   */
  private async _authedFetch(
    url: string,
    init: RequestInit = {}
  ): Promise<Response> {
    const token = await this._ensureValidToken();
    return fetch(url, {
      ...init,
      headers: {
        ...this.headers,
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    });
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
   * Parse a session-returning response (login, register, refresh). Maps
   * snake_case server fields to camelCase typed session AND routes
   * status-coded errors to specific typed exceptions.
   *
   * [isRefresh] controls how 401 is interpreted:
   * - false (login/register): 401 → InvalidCredentialsError
   * - true (refresh): 401 → SessionExpiredError
   */
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

  /**
   * Generic status check for endpoints that return void on success.
   * Routes non-2xx responses to specific typed errors via
   * {@link throwTypedError}.
   */
  private async checkResponse(res: Response): Promise<void> {
    if (res.ok) return;
    await this.throwTypedError(res);
  }

  /**
   * Map a non-2xx response to a typed exception.
   *
   * Status-based routing:
   * - 429 + "account temporarily locked" → AccountLockedError
   * - 429 (other)                        → RateLimitError
   *
   * Message-based routing (for status codes too generic on their own):
   * - "invalid or expired unlock token"  → UnlockTokenInvalidError
   * - "session revoked" / "token revoked" → TokenRevokedError
   *
   * Fallback: generic KoolbaseAuthError with the server-provided message.
   */
  private async throwTypedError(res: Response): Promise<never> {
    let body: any = {};
    try {
      body = await res.json();
    } catch {
      // ignore JSON parse failure
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
