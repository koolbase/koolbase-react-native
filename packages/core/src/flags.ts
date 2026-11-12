import { koolbaseFetch } from './network.js';
import { BootstrapPayload, KoolbaseConfig, VersionCheckResult } from './types.js';

export class KoolbaseFlags {
  private config: KoolbaseConfig;
  private payload: BootstrapPayload | null = null;
  private deviceId: string;
  // The last bootstrap's arguments, so a nudge can refresh with the same ones;
  // and the fetch in flight, so nudges never stack.
  private lastArgs: { appVersion: string; platform: string } | null = null;
  private inFlight: Promise<void> | null = null;
  // Told when a bootstrap brings new flags or config (onRemoteChange), so a
  // screen that reads them can draw again once they arrive.
  private listeners = new Set<() => void>();

  constructor(config: KoolbaseConfig, deviceId: string) {
    this.config = config;
    this.deviceId = deviceId;
  }

  async koolbaseFetch(appVersion: string, platform: string): Promise<void> {
    this.lastArgs = { appVersion, platform };
    try {
      const res = await koolbaseFetch(
        `${this.config.baseUrl}/v1/bootstrap?public_key=${this.config.publicKey}&device_id=${this.deviceId}&app_version=${appVersion}&platform=${platform}`
      );
      if (res.ok) {
        this.payload = await res.json();
        for (const l of [...this.listeners]) {
          try { l(); } catch (_) { /* a listener's error is its own */ }
        }
      }
    } catch (_) {}
  }

  /**
   * Calls [listener] each time a bootstrap brings flags and config (the first
   * load and every refresh). Returns the function that stops it. A listener
   * that throws never stops the others.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * The project id learned from the bootstrap payload, or '' while the first
   * bootstrap has not completed (storage's publicUrlFor reads it).
   */
  projectId(): string {
    return this.payload?.project_id ?? '';
  }

  /**
   * Fetch the bootstrap payload again with the last arguments -- a nudge from
   * storage when identity is missing, so a startup failure heals within the
   * session. One fetch at a time; never throws.
   */
  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const args = this.lastArgs ?? { appVersion: this.config.appVersion ?? '0.0.0', platform: 'unknown' };
    this.inFlight = this.koolbaseFetch(args.appVersion, args.platform).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  isEnabled(key: string): boolean {
    const flag = this.payload?.flags[key];
    if (!flag || !flag.enabled || flag.kill_switch) return false;
    const bucket = this.stableHash(`${this.deviceId}:${key}`) % 100;
    return bucket < flag.rollout_percentage;
  }

  getString(key: string, fallback = ''): string {
    const val = this.payload?.config[key];
    return val !== undefined ? String(val) : fallback;
  }

  getNumber(key: string, fallback = 0): number {
    const val = this.payload?.config[key];
    return typeof val === 'number' ? val : Number(val) || fallback;
  }

  getBool(key: string, fallback = false): boolean {
    const val = this.payload?.config[key];
    if (typeof val === 'boolean') return val;
    return val === 'true' ? true : fallback;
  }

  checkVersion(currentVersion: string): VersionCheckResult {
    const policy = this.payload?.version;
    if (!policy?.min_version) {
      return { status: 'up_to_date', message: '', latestVersion: '' };
    }

    const current = this.parseVersion(currentVersion);
    const min = this.parseVersion(policy.min_version);
    const latest = this.parseVersion(policy.latest_version);

    if (current < min) {
      return {
        status: 'force_update',
        message: policy.update_message,
        latestVersion: policy.latest_version,
        ...(policy.store_url ? { storeUrl: policy.store_url } : {}),
      };
    }
    if (policy.latest_version && current < latest) {
      return {
        status: policy.force_update ? 'force_update' : 'soft_update',
        message: policy.update_message,
        latestVersion: policy.latest_version,
        ...(policy.store_url ? { storeUrl: policy.store_url } : {}),
      };
    }
    return { status: 'up_to_date', message: '', latestVersion: policy.latest_version };
  }

  private parseVersion(v: string): number {
    const parts = v.split('.').map(Number);
    return (parts[0] ?? 0) * 10000 + (parts[1] ?? 0) * 100 + (parts[2] ?? 0);
  }

  private stableHash(s: string): number {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = (Math.imul(31, hash) + s.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }
}
