// @koolbase/react-native — composes @koolbase/core for a React Native host.
//
// Everything the core exports is re-exported here unchanged, so an app that
// installed this package before the split sees the same surface. What this
// file adds is the composition: one Koolbase singleton, initialized with the
// React Native platform adapter and keychain-backed session storage.

export * from '@koolbase/core';
export { reactNativePlatform } from './platform';

import {
  KoolbaseAuth,
  KoolbaseDatabase,
  KoolbaseStorage,
  KoolbaseRealtime,
  KoolbaseFunctions,
  KoolbaseFlags,
  KoolbaseCodePush,
  KoolbaseAnalytics,
  KoolbaseMessaging,
  KoolbaseLogicEngine,
  getOrCreateDeviceId,
  setPlatform,
  type FlowResult,
  type KoolbaseConfig,
  type VersionCheckResult,
} from '@koolbase/core';
import { reactNativePlatform } from './platform';

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

    // The host platform, installed before any subsystem touches storage or
    // the network. Tests leave this unset and run on the in-memory default.
    setPlatform(config.platform ?? reactNativePlatform());

    _auth = new KoolbaseAuth(config);
    _db = new KoolbaseDatabase(
      config,
      () => _auth?.currentUser?.id ?? null,
      () => _auth?.validAccessToken() ?? Promise.resolve(null),
      // A session the server refuses is not a session. Clearing it here means an
      // app catching KoolbaseUnauthenticatedError is already signed out and can
      // route to login, rather than looping on a dead token.
      async () => { await _auth?.clearStoredSession(); },
    );
    _storage = new KoolbaseStorage(
      config,
      () => _auth?.validAccessToken() ?? Promise.resolve(null),
      async () => { await _auth?.clearStoredSession(); },
    );
    _realtime = new KoolbaseRealtime(
      config,
      () => _auth?.validAccessToken() ?? Promise.resolve(null),
      () => _auth?.currentUser?.id ?? null,
    );
    _functions = new KoolbaseFunctions(
      config,
      () => _auth?.validAccessToken() ?? Promise.resolve(null),
      async () => { await _auth?.clearStoredSession(); },
    );

    // One anonymous device id for the whole SDK — bucketing (flags), targeting
    // (code push), and registration keying (messaging) must all agree on it.
    const deviceId = await getOrCreateDeviceId();

    _flags = new KoolbaseFlags(config, deviceId);
    _codePush = new KoolbaseCodePush(config, config.codePushChannel ?? 'stable');
    // Initialize code push — loads cached bundle then checks in background
    await _codePush.init({
      appVersion: '1.0.0', // override with your app version
      platform: 'react-native',
      deviceId,
    });
    // Initialize analytics
    if (config.analyticsEnabled !== false) {
      _analytics = new KoolbaseAnalytics(config);
      await _analytics.init(config.appVersion);
    }
    // Initialize messaging
    if (config.messagingEnabled !== false) {
      _messaging = new KoolbaseMessaging(config);
      _messaging.setDeviceId(deviceId);
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

export { SecureAuthStorage } from './auth-storage';
