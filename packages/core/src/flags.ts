import { BootstrapPayload, KoolbaseConfig, VersionCheckResult } from './types';

export class KoolbaseFlags {
  private config: KoolbaseConfig;
  private payload: BootstrapPayload | null = null;
  private deviceId: string;

  constructor(config: KoolbaseConfig, deviceId: string) {
    this.config = config;
    this.deviceId = deviceId;
  }

  async fetch(appVersion: string, platform: string): Promise<void> {
    try {
      const res = await fetch(
        `${this.config.baseUrl}/v1/bootstrap?public_key=${this.config.publicKey}&device_id=${this.deviceId}&app_version=${appVersion}&platform=${platform}`
      );
      if (res.ok) {
        this.payload = await res.json();
      }
    } catch (_) {}
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
      };
    }
    if (policy.latest_version && current < latest) {
      return {
        status: policy.force_update ? 'force_update' : 'soft_update',
        message: policy.update_message,
        latestVersion: policy.latest_version,
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
