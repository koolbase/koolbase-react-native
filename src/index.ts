import AsyncStorage from '@react-native-async-storage/async-storage';
import { KoolbaseAuth } from './auth';
import { KoolbaseCodePush } from './code-push';
import { KoolbaseAnalytics } from './analytics';
import { KoolbaseMessaging } from './messaging';
export { KoolbaseMessaging } from './messaging';
export { KoolbaseAppleAuth } from './apple-auth';
export type { RegisterTokenOptions, SendOptions } from './messaging';
import { KoolbaseLogicEngine, FlowResult } from './logic-engine';
export { KoolbaseAnalytics } from './analytics';
export type { FlowResult } from './logic-engine';
export { KoolbaseCodePush } from './code-push';
export type { BundleManifest, BundlePayload } from './code-push';
import { KoolbaseDatabase } from './database';
import { KoolbaseFlags } from './flags';
import { KoolbaseFunctions } from './functions';
import { KoolbaseRealtime } from './realtime';
import { KoolbaseStorage } from './storage';
import { KoolbaseConfig, VersionCheckResult } from './types';

export * from './types';
export * from './auth-errors';
export * from './database-errors';
export { KoolbaseAuth, KoolbaseDatabase, KoolbaseFlags, KoolbaseFunctions, KoolbaseRealtime, KoolbaseStorage };

let _auth: KoolbaseAuth | null = null;
let _db: KoolbaseDatabase | null = null;
let _storage: KoolbaseStorage | null = null;
let _realtime: KoolbaseRealtime | null = null;
let _functions: KoolbaseFunctions | null = null;
let _flags: KoolbaseFlags | null = null;
let _codePush: KoolbaseCodePush | null = null;
let _analytics: KoolbaseAnalytics | null = null;
let _messaging: KoolbaseMessaging | null = null;
const _logicEngine = new KoolbaseLogicEngine();
let _initialized = false;

function ensureInitialized() {
  if (!_initialized) {
    throw new Error('Koolbase not initialized. Call Koolbase.initialize() first.');
  }
}

export const Koolbase = {
  async initialize(config: KoolbaseConfig): Promise<void> {
    if (_initialized) return;

    _auth = new KoolbaseAuth(config);
    _db = new KoolbaseDatabase(config, () => _auth?.currentUser?.id ?? null);
    _storage = new KoolbaseStorage(config, () => _auth?.accessToken ?? null);
    _realtime = new KoolbaseRealtime(config);
    _functions = new KoolbaseFunctions(config, () => _auth?.accessToken ?? null);
    _flags = new KoolbaseFlags(config, 'rn-device');

    _codePush = new KoolbaseCodePush(config, config.codePushChannel ?? 'stable');

    // Initialize code push — loads cached bundle then checks in background
    await _codePush.init({
      appVersion: '1.0.0', // override with your app version
      platform: 'react-native',
      deviceId: 'rn-device',
    });

    // Initialize analytics
    if (config.analyticsEnabled !== false) {
      _analytics = new KoolbaseAnalytics(config);
      await _analytics.init(config.appVersion);
    }

    // Initialize messaging
    if (config.messagingEnabled !== false) {
      _messaging = new KoolbaseMessaging(config);
      const storedDeviceId = await AsyncStorage.getItem('koolbase:device_id');
      _messaging.setDeviceId(storedDeviceId ?? 'rn-device');
    }

    _initialized = true;
  },

  get auth(): KoolbaseAuth {
    ensureInitialized();
    return _auth!;
  },

  get db(): KoolbaseDatabase {
    ensureInitialized();
    return _db!;
  },

  get storage(): KoolbaseStorage {
    ensureInitialized();
    return _storage!;
  },

  get realtime(): KoolbaseRealtime {
    ensureInitialized();
    return _realtime!;
  },

  get functions(): KoolbaseFunctions {
    ensureInitialized();
    return _functions!;
  },

  isEnabled(key: string): boolean {
    ensureInitialized();
    // Bundle flag wins over remote flag
    const bundleFlag = _codePush?.getBundleFlag(key);
    if (bundleFlag !== undefined) return bundleFlag;
    return _flags!.isEnabled(key);
  },

  configString(key: string, fallback = ''): string {
    ensureInitialized();
    const bundleVal = _codePush?.getBundleConfig(key);
    if (bundleVal !== undefined) return String(bundleVal);
    return _flags!.getString(key, fallback);
  },

  configNumber(key: string, fallback = 0): number {
    ensureInitialized();
    const bundleVal = _codePush?.getBundleConfig(key);
    if (bundleVal !== undefined) return typeof bundleVal === 'number' ? bundleVal : Number(bundleVal) || fallback;
    return _flags!.getNumber(key, fallback);
  },

  configBool(key: string, fallback = false): boolean {
    ensureInitialized();
    const bundleVal = _codePush?.getBundleConfig(key);
    if (bundleVal !== undefined) return typeof bundleVal === 'boolean' ? bundleVal : bundleVal === 'true';
    return _flags!.getBool(key, fallback);
  },

  get codePush(): KoolbaseCodePush {
    ensureInitialized();
    return _codePush!;
  },

  get analytics(): KoolbaseAnalytics {
    ensureInitialized();
    return _analytics!;
  },

  executeFlow(flowId: string, context?: Record<string, unknown>): FlowResult {
    ensureInitialized();
    const manifest = _codePush?.manifest;
    if (!manifest) return { hasEvent: false, args: {}, completed: true };
    return _logicEngine.execute(
      flowId,
      manifest.payload.flows ?? {},
      context ?? {},
      manifest.payload.config ?? {},
      manifest.payload.flags ?? {},
    );
  },

  get messaging(): KoolbaseMessaging {
    ensureInitialized();
    return _messaging!;
  },

  checkVersion(currentVersion: string): VersionCheckResult {
    ensureInitialized();
    return _flags!.checkVersion(currentVersion);
  },
};

// v1.9.0 additions
export { koolbaseSdkVersion } from './device-metadata';
export { RestoreResult } from './types';
export type { AuthStateListener, FetchLike, KoolbaseAuthStorage } from './types';
export { SecureAuthStorage } from './auth-storage';
export {
  KoolbaseAuthError,
  InvalidCredentialsError,
  EmailAlreadyInUseError,
  UserDisabledError,
  WeakPasswordError,
  SessionExpiredError,
  TokenRevokedError,
  AccountLockedError,
  UnlockTokenInvalidError,
  RateLimitError,
  NetworkError,
  InvalidPhoneNumberError,
  OtpExpiredError,
  OtpInvalidError,
  OtpMaxAttemptsError,
  OtpRateLimitError,
  PhoneAlreadyLinkedError,
  SmsConfigMissingError,
} from './auth-errors';
