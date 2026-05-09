import {
  KoolbaseConfig,
  KoolbaseSession,
  KoolbaseUser,
  LinkPhoneParams,
  LoginParams,
  OtpSendResult,
  PhoneVerifyResult,
  RegisterParams,
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

export class KoolbaseAuth {
  private config: KoolbaseConfig;
  private session: KoolbaseSession | null = null;

  constructor(config: KoolbaseConfig) {
    this.config = config;
  }

  private get headers() {
    return { 'Content-Type': 'application/json' };
  }

  private get authHeaders() {
    return {
      'Content-Type': 'application/json',
      ...(this.session
        ? { Authorization: `Bearer ${this.session.accessToken}` }
        : {}),
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    auth = false
  ): Promise<T> {
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers: auth ? this.authHeaders : this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? `Request failed: ${res.status}`);
    }
    return data as T;
  }

  async register(params: RegisterParams): Promise<KoolbaseUser> {
    const data = await this.request<{ user: KoolbaseUser }>(
      'POST',
      '/v1/sdk/auth/register',
      params
    );
    return data.user;
  }

  async login(params: LoginParams): Promise<KoolbaseSession> {
    const data = await this.request<KoolbaseSession>(
      'POST',
      '/v1/sdk/auth/login',
      params
    );
    this.session = data;
    return data;
  }

  async logout(): Promise<void> {
    if (!this.session) return;
    try {
      await this.request('POST', '/v1/sdk/auth/logout', {}, true);
    } finally {
      this.session = null;
    }
  }

  async forgotPassword(email: string): Promise<void> {
    await this.request('POST', '/v1/sdk/auth/forgot-password', { email });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    await this.request('POST', '/v1/sdk/auth/reset-password', {
      token,
      password,
    });
  }

  get currentUser(): KoolbaseUser | null {
    return this.session?.user ?? null;
  }

  get accessToken(): string | null {
    return this.session?.accessToken ?? null;
  }

  setSession(session: KoolbaseSession | null): void {
    this.session = session;
  }


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

    const user: KoolbaseUser = {
      id: data.user.id,
      email: data.user.email ?? '',
      phoneNumber: data.user.phone_number,
      phoneVerified: data.user.phone_verified ?? false,
      fullName: data.user.full_name,
      avatarUrl: data.user.avatar_url,
      verified: data.user.verified ?? false,
      createdAt: data.user.created_at,
    };

    const session: KoolbaseSession = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      user,
    };

    this.session = session;
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

  private validatePhone(phoneNumber: string): void {
    if (!/^\+[1-9]\d{6,14}$/.test(phoneNumber)) {
      throw new InvalidPhoneNumberError();
    }
  }

  private async parsePhoneResponse(res: Response): Promise<any> {
    let body: any = {};
    try {
      body = await res.json();
    } catch {}

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
