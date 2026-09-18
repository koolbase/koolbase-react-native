// @koolbase/js — composes @koolbase/core for the browser.
//
// The same surface as @koolbase/react-native where the browser can honour it.
// What is deliberately absent, so it is not discovered as a method that
// fails: code push (a native-bundle concept; the web already has one), the
// logic engine (its flows arrived only through code-push bundles), push
// messaging (FCM tokens come from a native module), and Apple/Google native
// sign-in (use the web OAuth flows against the same auth endpoints).

export * from '@koolbase/core';
export { BrowserAuthStorage } from './auth-storage';
export { browserPlatform } from './platform';

import {
  KoolbaseAuth,
  KoolbaseDatabase,
  KoolbaseStorage,
  KoolbaseRealtime,
  KoolbaseFunctions,
  KoolbaseFlags,
  KoolbaseAnalytics,
  getOrCreateDeviceId,
  setPlatform,
  type KoolbaseConfig,
  type VersionCheckResult,
} from '@koolbase/core';
import { browserPlatform } from './platform';

let _auth: KoolbaseAuth | null = null;
let _db: KoolbaseDatabase | null = null;
let _storage: KoolbaseStorage | null = null;
let _realtime: KoolbaseRealtime | null = null;
let _functions: KoolbaseFunctions | null = null;
let _flags: KoolbaseFlags | null = null;
let _analytics: KoolbaseAnalytics | null = null;
let _initialized = false;

function ensureInitialized() {
  if (!_initialized) {
    throw new Error('Koolbase not initialized. Call Koolbase.initialize(config) first.');
  }
}

export const Koolbase = {
  async initialize(config: KoolbaseConfig): Promise<void> {
    if (_initialized) return;

    setPlatform(config.platform ?? browserPlatform());

    _auth = new KoolbaseAuth(config);
    _db = new KoolbaseDatabase(
      config,
      () => _auth?.currentUser?.id ?? null,
      () => _auth?.validAccessToken() ?? Promise.resolve(null),
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

    const deviceId = await getOrCreateDeviceId();
    _flags = new KoolbaseFlags(config, deviceId);

    if (config.analyticsEnabled !== false) {
      _analytics = new KoolbaseAnalytics(config);
      await _analytics.init(config.appVersion);
    }

    _initialized = true;
  },

  get auth(): KoolbaseAuth { ensureInitialized(); return _auth!; },
  get db(): KoolbaseDatabase { ensureInitialized(); return _db!; },
  get storage(): KoolbaseStorage { ensureInitialized(); return _storage!; },
  get realtime(): KoolbaseRealtime { ensureInitialized(); return _realtime!; },
  get functions(): KoolbaseFunctions { ensureInitialized(); return _functions!; },
  get analytics(): KoolbaseAnalytics {
    ensureInitialized();
    if (!_analytics) throw new Error('Analytics is disabled (analyticsEnabled: false).');
    return _analytics;
  },

  isEnabled(key: string): boolean { ensureInitialized(); return _flags!.isEnabled(key); },
  configString(key: string, fallback = ''): string { ensureInitialized(); return _flags!.getString(key, fallback); },
  configNumber(key: string, fallback = 0): number { ensureInitialized(); return _flags!.getNumber(key, fallback); },
  configBool(key: string, fallback = false): boolean { ensureInitialized(); return _flags!.getBool(key, fallback); },
  checkVersion(currentVersion: string): VersionCheckResult { ensureInitialized(); return _flags!.checkVersion(currentVersion); },
};
