import { Platform } from 'react-native';
import { isKeychainAvailable } from './auth-storage';

/**
 * Koolbase React Native SDK version. Sent in the `x-koolbase-sdk-version`
 * header on every authenticated request so the server can route
 * version-conditional logic (deprecation warnings, schema migrations,
 * feature flags). Must match the `version` field in package.json.
 */
export const koolbaseSdkVersion = '1.10.1';

/**
 * Generate a UUIDv4-shaped string for use as a stable per-install
 * device label. Not cryptographically secure — this is a label, not a
 * security primitive. Avoids pulling in a crypto-grade UUID dependency.
 */
function generateDeviceLabel(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Builds device-identifying headers attached to every Koolbase auth
 * request. Mirrors the Flutter SDK's `DeviceMetadata` for parity. Apps
 * with privacy concerns can swap in a custom storage adapter to avoid
 * persisting the device label.
 *
 * Headers emitted:
 * - User-Agent: koolbase-react-native/<sdk> (<platform> <version>)
 * - x-koolbase-sdk:              react-native
 * - x-koolbase-sdk-version:      <koolbaseSdkVersion>
 * - x-koolbase-platform:         ios | android | web | etc.
 * - x-koolbase-platform-version: numeric SDK level or OS version string
 * - x-koolbase-app-version:      from KoolbaseConfig.appVersion or 'unknown'
 * - x-koolbase-device-label:     persistent UUID per install
 */
export class DeviceMetadata {
  private cached: Record<string, string> | null = null;
  private ephemeralLabel: string | null = null;
  private readonly appVersion: string;

  constructor(appVersion?: string) {
    this.appVersion = appVersion ?? 'unknown';
  }

  /**
   * Build (or return cached) device headers. The first call may perform
   * an async keychain read to look up the persisted device label;
   * subsequent calls return the in-memory cache synchronously via the
   * returned Promise.
   */
  async build(): Promise<Record<string, string>> {
    if (this.cached) return this.cached;

    const platform = String(Platform.OS);
    const platformVersion = String(Platform.Version);
    const deviceLabel = await this.getOrCreateDeviceLabel();
    const userAgent = `koolbase-react-native/${koolbaseSdkVersion} (${platform} ${platformVersion})`;

    this.cached = {
      'User-Agent': userAgent,
      'x-koolbase-sdk': 'react-native',
      'x-koolbase-sdk-version': koolbaseSdkVersion,
      'x-koolbase-platform': platform,
      'x-koolbase-platform-version': platformVersion,
      'x-koolbase-app-version': this.appVersion,
      'x-koolbase-device-label': deviceLabel,
    };

    return this.cached;
  }

  private async getOrCreateDeviceLabel(): Promise<string> {
    // No keychain available → ephemeral per-session label.
    // (Better than no label — still useful for in-session debugging.)
    if (!isKeychainAvailable()) {
      if (!this.ephemeralLabel) {
        this.ephemeralLabel = generateDeviceLabel();
      }
      return this.ephemeralLabel;
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Keychain = require('react-native-keychain');
    const service = 'koolbase_device_label_v1';

    try {
      const existing = await Keychain.getGenericPassword({ service });
      if (existing && existing.password) {
        return existing.password;
      }
    } catch {
      // fall through to create
    }

    const newLabel = generateDeviceLabel();
    try {
      await Keychain.setGenericPassword('device', newLabel, { service });
    } catch {
      // Persistence failed — return the generated label anyway, but
      // don't cache it as ephemeral since future requests may persist.
    }
    return newLabel;
  }
}
