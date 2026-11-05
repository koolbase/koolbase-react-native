import { koolbaseFetch } from './network.js';
import { KoolbaseConfig } from './types.js';

// ─── Models ──────────────────────────────────────────────────────────────────

/** The platforms a token registers as: a phone's FCM token, or a browser's (R138). */
export type KoolbaseMessagingPlatform = 'android' | 'ios' | 'web';

export interface RegisterTokenOptions {
  token: string;
  platform: KoolbaseMessagingPlatform;
  /** Ignored by the API (the owner comes from the session); kept for compatibility. */
  userId?: string;
}

const PLATFORMS = new Set<string>(['android', 'ios', 'web']);

// ─── KoolbaseMessaging ────────────────────────────────────────────────────────

export class KoolbaseMessaging {
  private config: KoolbaseConfig;
  private deviceId = '';
  private accessToken: () => Promise<string | null>;
  /** The last token registered, and its platform: registered again when
   *  someone signs in or out, so the device follows who is signed in. */
  private last: { token: string; platform: KoolbaseMessagingPlatform } | null = null;

  /** [accessToken]: the signed-in person's, or null -- the device is theirs
   *  only while they are signed in (the API takes the owner from it, never
   *  from the request body). */
  constructor(config: KoolbaseConfig, accessToken: () => Promise<string | null> = () => Promise.resolve(null)) {
    this.config = config;
    this.accessToken = accessToken;
  }

  setDeviceId(deviceId: string): void {
    this.deviceId = deviceId;
  }

  // ─── Register token ───────────────────────────────────────────────────────

  /** Registers an FCM token with Koolbase -- tied to the signed-in person, if
   *  someone is signed in (R138). Call it after getting the token, and again
   *  when it changes; signing in or out registers it again by itself. */
  async registerToken(options: RegisterTokenOptions): Promise<boolean> {
    if (!PLATFORMS.has(options.platform)) return false;
    this.last = { token: options.token, platform: options.platform };
    return this.send(options.token, options.platform);
  }

  /** Someone signed in or out (Koolbase wires it): the last token is
   *  registered again. Nothing before a token is registered. */
  async sessionChanged(): Promise<void> {
    if (this.last === null) return;
    await this.send(this.last.token, this.last.platform);
  }

  private async send(token: string, platform: KoolbaseMessagingPlatform): Promise<boolean> {
    try {
      const access = await this.accessToken().catch(() => null);
      const response = await koolbaseFetch(`${this.config.baseUrl}/v1/messaging/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.publicKey,
          ...(access ? { Authorization: `Bearer ${access}` } : {}),
        },
        body: JSON.stringify({ device_id: this.deviceId, token, platform }),
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
