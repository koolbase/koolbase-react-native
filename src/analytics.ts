import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { KoolbaseConfig } from './types';
import { getOrCreateDeviceId } from './device-id';

// ─── Types ──────────────────────────────────────────────────────────────────

interface AnalyticsEvent {
  device_id: string;
  user_id?: string;
  environment_id?: string;
  event_name: string;
  properties: Record<string, unknown>;
  user_properties: Record<string, unknown>;
  platform: string;
  app_version: string;
  sdk_version: string;
  session_id: string;
  occurred_at: string;
}

// ─── KoolbaseAnalytics ───────────────────────────────────────────────────────

const SDK_VERSION = '1.3.0';
const DEVICE_ID_KEY = 'koolbase:device_id';
const FLUSH_INTERVAL_MS = 30_000;
const MAX_BATCH_SIZE = 20;

export class KoolbaseAnalytics {
  private config: KoolbaseConfig;
  private queue: AnalyticsEvent[] = [];
  private deviceId = '';
  private userId?: string;
  private environmentId?: string;
  private userProperties: Record<string, unknown> = {};
  private sessionId = '';
  private appVersion = '1.0.0';
  private flushTimer?: ReturnType<typeof setInterval>;
  private initialized = false;

  constructor(config: KoolbaseConfig) {
    this.config = config;
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  async init(appVersion?: string): Promise<void> {
    if (this.initialized) return;

    this.deviceId = await getOrCreateDeviceId();
    this.sessionId = `${this.deviceId}-${Date.now()}`;
    this.appVersion = appVersion ?? '1.0.0';

    // Auto flush on app background
    AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background' || state === 'inactive') {
        this.flush();
      }
    });

    // Periodic flush
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);

    // Auto track app_open
    this.track('app_open');

    this.initialized = true;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  track(eventName: string, properties?: Record<string, unknown>): void {
    const event: AnalyticsEvent = {
      device_id: this.deviceId,
      user_id: this.userId,
      environment_id: this.environmentId,
      event_name: eventName,
      properties: properties ?? {},
      user_properties: { ...this.userProperties },
      platform: Platform.OS,
      app_version: this.appVersion,
      sdk_version: SDK_VERSION,
      session_id: this.sessionId,
      occurred_at: new Date().toISOString(),
    };

    this.queue.push(event);

    if (this.queue.length >= MAX_BATCH_SIZE) {
      this.flush();
    }
  }

  screenView(screenName: string, properties?: Record<string, unknown>): void {
    this.track('screen_view', {
      screen_name: screenName,
      ...properties,
    });
  }

  identify(userId: string): void {
    this.userId = userId;
  }

  setUserProperty(key: string, value: unknown): void {
    this.userProperties[key] = value;
  }

  setUserProperties(properties: Record<string, unknown>): void {
    Object.assign(this.userProperties, properties);
  }

  setEnvironment(environmentId: string): void {
    this.environmentId = environmentId;
  }

  reset(): void {
    this.userId = undefined;
    this.userProperties = {};
  }

  // ─── Flush ────────────────────────────────────────────────────────────────

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = [...this.queue];
    this.queue = [];

    try {
      const response = await fetch(`${this.config.baseUrl}/v1/analytics/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.publicKey,
        },
        body: JSON.stringify({ events: batch }),
      });

      if (!response.ok) {
        // Re-queue on failure
        this.queue.unshift(...batch.slice(0, MAX_BATCH_SIZE - this.queue.length));
      }
    } catch {
      // Re-queue on network error
      this.queue.unshift(...batch.slice(0, MAX_BATCH_SIZE - this.queue.length));
    }
  }

  async dispose(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.track('session_end');
    await this.flush();
  }
}
