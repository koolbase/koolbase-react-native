import { KoolbaseConfig } from './types';

// ─── Models ──────────────────────────────────────────────────────────────────

export interface RegisterTokenOptions {
  token: string;
  platform: 'android' | 'ios';
  userId?: string;
}

// ─── KoolbaseMessaging ────────────────────────────────────────────────────────

export class KoolbaseMessaging {
  private config: KoolbaseConfig;
  private deviceId = '';

  constructor(config: KoolbaseConfig) {
    this.config = config;
  }

  setDeviceId(deviceId: string): void {
    this.deviceId = deviceId;
  }

  // ─── Register token ───────────────────────────────────────────────────────

  async registerToken(options: RegisterTokenOptions): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/v1/messaging/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.publicKey,
        },
        body: JSON.stringify({
          device_id: this.deviceId,
          token: options.token,
          platform: options.platform,
          ...(options.userId && { user_id: options.userId }),
        }),
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  // NOTE: no send() here — sending requires a secret kb_live_ key and is
  // server-initiated only (backend or Koolbase Function). The publishable key
  // this client holds ships in the app binary and must not be able to push to
  // other devices; the API rejects publishable-key sends with 401.
  // See docs: /sdk/messaging.

}
