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
  InvalidPhoneNumberError,
  KoolbaseAuthError,
  OtpExpiredError,
  OtpInvalidError,
  OtpMaxAttemptsError,
  OtpRateLimitError,
  PhoneAlreadyLinkedError,
  SmsConfigMissingError,
} from './auth-errors';
import { SecureAuthStorage, isKeychainAvailable } from './auth-storage';

/**
 * Internal error carrying HTTP status, used to distinguish server-side
 * rejections (4xx) from network failures (no status). Replaced by a richer
 * typed-error hierarchy in v1.9.0 Batch B.
 */
class RequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'RequestError';
  }
}

export class KoolbaseAuth {
  private config: KoolbaseConfig;
  private storage: KoolbaseAuthStorage | null;
  private session: KoolbaseSession | null = null;

  constructor(config: KoolbaseConfig) {
    this.config = config;

    // Resolve auth storage: explicit user-provided wins, else default to
    // SecureAuthStorage iff react-native-keychain is installed, else null
    // (no persistence — sessions live in memory only, with a clear warning).
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

  /**
   * Set the in-memory session AND persist it to storage so it survives
   * app restarts. The persisted write is awaited so callers know the
   * session is durable before returning.
   */
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

  /**
   * Clear in-memory session AND persisted storage. Best-effort: failures
   * to clear storage are logged but don't surface to the caller — the
   * in-memory clear always happens.
   */
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

  /**
   * Restore a previously saved session on app launch.
   *
   * Offline-aware and optimistic:
   * 1. Read persisted session. If none → {@link RestoreResult.NoSession}.
   * 2. Populate in-memory state immediately so app UI can render.
   * 3. If access token still valid → {@link RestoreResult.Restored}.
   * 4. Otherwise refresh against the server:
   *    - Success → {@link RestoreResult.Restored}.
   *    - Server rejection (4xx) → clear, return {@link RestoreResult.Expired}.
   *    - Network error → keep optimistic state, return
   *      {@link RestoreResult.Offline}.
   */
  async restoreSession(): Promise<RestoreResult> {
    if (!this.storage) return RestoreResult.NoSession;

    const persisted = await this.storage.readSession();
    if (!persisted) return RestoreResult.NoSession;

    // Optimistic restore — populate state from disk before any network.
    this.session = persisted;

    // If access token is still valid, we're done — no network needed.
    const expiresAt = persisted.expiresAt
      ? new Date(persisted.expiresAt).getTime()
      : 0;
    const oneMinuteMs = 60 * 1000;
    if (expiresAt > Date.now() + oneMinuteMs) {
      return RestoreResult.Restored;
    }

    // Access token expired (or no expiresAt on legacy session) — refresh.
    try {
      await this.refresh(persisted.refreshToken);
      return RestoreResult.Restored;
    } catch (e) {
      if (e instanceof RequestError && e.status >= 400 && e.status < 500) {
        // Server rejected the refresh token — clear and require fresh login.
        await this.clearSessionInternal();
        return RestoreResult.Expired;
      }
      // Network error (no response, timeout, 5xx). Keep optimistic state;
      // API calls will fail until network returns. App can retry via
      // refreshSession() when connectivity is restored.
      return RestoreResult.Offline;
    }
  }

  // ─── Public auth API ────────────────────────────────────────────────────

  async register(params: RegisterParams): Promise<KoolbaseUser> {
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
   * persisted one if not provided). On success the new session is stored
   * both in memory and in persistent storage.
   *
   * Single-flight deduplication of concurrent refresh calls lands in
   * Batch B.
   */
  async refresh(refreshToken?: string): Promise<KoolbaseSession> {
    const token = refreshToken ?? this.session?.refreshToken;
    if (!token) {
      throw new KoolbaseAuthError(
        'No refresh token available',
        'session_expired'
      );
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

  async logout(): Promise<void> {
    try {
      if (this.session) {
        const res = await fetch(`${this.config.baseUrl}/v1/sdk/auth/logout`, {
          method: 'POST',
          headers: this.authHeaders,
        });
        // Don't throw on logout failure — local clear is best-effort.
        // Batch B will surface the success/failure signal to callers.
        void res;
      }
    } catch {
      // Network / server error — local clear still happens below.
    } finally {
      await this.clearSessionInternal();
    }
  }

  async forgotPassword(email: string): Promise<void> {
    // Endpoint path fixed in v1.9.0 Batch A. Previously hit
    // /v1/sdk/auth/forgot-password which 404s on the server.
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
    // Endpoint path fixed in v1.9.0 Batch A. Previously hit
    // /v1/sdk/auth/reset-password which 404s on the server.
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

  get currentUser(): KoolbaseUser | null {
    return this.session?.user ?? null;
  }

  get accessToken(): string | null {
    return this.session?.accessToken ?? null;
  }

  /**
   * Set the current session and persist it to storage. Accepts null to
   * clear. The in-memory update is synchronous; the persistence write is
   * awaited.
   *
   * Previously synchronous (returned void). Now returns a Promise to
   * await persistence; source-compatible for callers ignoring the
   * return value.
   */
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
   * implemented in v2.10.x. For Sign in with Apple use the
   * KoolbaseAppleAuth wrapper — same status applies (also deprecated in
   * Batch C). Use email/password for now.
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
    // Deprecation made loud in Batch C. For Batch A, behavior unchanged
    // so we don't break consumers mid-migration. Avoid lint warning on
    // unused params:
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

  async linkPhone(params: LinkPhoneParams): Promise<void> {
    if (!this.session) {
      throw new KoolbaseAuthError(
        'Must be signed in to link a phone number',
        'unauthenticated'
      );
    }
    this.validatePhone(params.phoneNumber);
    const res = await fetch(
      `${this.config.baseUrl}/v1/sdk/auth/phone/link`,
      {
        method: 'POST',
        headers: this.authHeaders,
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
   * Map a server user (snake_case) to the typed {@link KoolbaseUser}
   * (camelCase). Used by every session-returning endpoint.
   */
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
   * snake_case server fields to camelCase typed session AND handles
   * status-coded auth errors.
   *
   * [isRefresh] controls how 401 is interpreted:
   * - false (login/register): 401 = invalid credentials
   * - true (refresh): 401 = session expired (refresh token rejected)
   */
  private async parseSessionResponse(
    res: Response,
    isRefresh: boolean
  ): Promise<KoolbaseSession> {
    if (res.status === 409) {
      throw new KoolbaseAuthError(
        'Email is already in use',
        'email_taken'
      );
    }
    if (res.status === 401) {
      throw new KoolbaseAuthError(
        isRefresh ? 'Session expired, please log in again' : 'Invalid email or password',
        isRefresh ? 'session_expired' : 'invalid_credentials'
      );
    }
    if (res.status === 403) {
      throw new KoolbaseAuthError(
        'This account has been disabled',
        'user_disabled'
      );
    }
    if (!res.ok) {
      let body: any = {};
      try {
        body = await res.json();
      } catch {
        // ignore JSON parse failure
      }
      throw new RequestError(
        body.error || `Request failed: ${res.status}`,
        res.status
      );
    }

    const data = await res.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at,
      user: this.mapUser(data.user),
    };
  }

  /**
   * Generic status check for endpoints that return void on success
   * (forgotPassword, resetPassword, verifyEmail). Throws on non-2xx.
   */
  private async checkResponse(res: Response): Promise<void> {
    if (res.ok) return;
    let body: any = {};
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    throw new RequestError(
      body.error || `Request failed: ${res.status}`,
      res.status
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
