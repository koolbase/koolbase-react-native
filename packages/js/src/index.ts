// @koolbase/js — composes @koolbase/core for the browser.
//
// The same surface as @koolbase/react-native where the browser can honour it.
// What is deliberately absent, so it is not discovered as a method that
// fails: code push (a native-bundle concept; the web already has one), the
// logic engine (its flows arrived only through code-push bundles), push
// messaging (FCM tokens come from a native module), and Apple/Google native
// sign-in (use the web OAuth flows against the same auth endpoints).

export * from '@koolbase/core';
export { BrowserAuthStorage } from './auth-storage.js';
export { browserPlatform } from './platform.js';

import {
  KoolbaseAuth,
  KoolbaseDatabase,
  KoolbaseFiscal,
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
import { browserPlatform } from './platform.js';

let _auth: KoolbaseAuth | null = null;
let _db: KoolbaseDatabase | null = null;
let _storage: KoolbaseStorage | null = null;
let _fiscal: KoolbaseFiscal | null = null;
let _realtime: KoolbaseRealtime | null = null;
let _functions: KoolbaseFunctions | null = null;
let _flags: KoolbaseFlags | null = null;
let _analytics: KoolbaseAnalytics | null = null;
let _initialized = false;

// The in-flight initialize, so overlapping callers await the same one.
//
// A boolean guard is not enough: the check happens before the first await
// and the flag is set after the last, so two calls that overlap in that
// window both pass and both build a whole SDK — two of every client, two
// analytics flush timers, two sync engines over one queue. React strict
// mode does exactly this in development, and so does any app that
// initializes from two components.
let _initializing: Promise<void> | null = null;

function ensureInitialized() {
  if (!_initialized) {
    throw new Error('Koolbase not initialized. Call Koolbase.initialize(config) first.');
  }
}

export const Koolbase = {
  async initialize(config: KoolbaseConfig): Promise<void> {
    if (_initialized) return;
    if (_initializing) return _initializing;
    _initializing = (async () => {

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
    _fiscal = new KoolbaseFiscal(
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
      _analytics = new KoolbaseAnalytics(config, () => _auth?.currentUser?.id ?? null);
      await _analytics.init(config.appVersion);
    }

      _initialized = true;
    })();
    try {
      await _initializing;
    } finally {
      // Cleared either way: a failed initialize must be retryable rather
      // than leaving every later caller awaiting a rejected promise.
      _initializing = null;
    }
  },

  get auth(): KoolbaseAuth { ensureInitialized(); return _auth!; },
  get db(): KoolbaseDatabase { ensureInitialized(); return _db!; },
  get storage(): KoolbaseStorage { ensureInitialized(); return _storage!; },
  get fiscal(): KoolbaseFiscal { ensureInitialized(); return _fiscal!; },
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
