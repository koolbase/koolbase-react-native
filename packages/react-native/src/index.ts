// @koolbase/react-native — composes @koolbase/core for a React Native host.
//
// Everything the core exports is re-exported here unchanged, so an app that
// installed this package before the split sees the same surface. What this
// file adds is the composition: one Koolbase singleton, initialized with the
// React Native platform adapter and keychain-backed session storage.

export * from '@koolbase/core';
export { reactNativePlatform } from './platform.js';

import {
  KoolbaseAuth,
  KoolbaseDatabase,
  KoolbaseFiscal,
  KoolbaseStorage,
  KoolbaseRealtime,
  KoolbaseFunctions,
  KoolbaseFlags,
  KoolbaseAnalytics,
  disabledAnalytics,
  KoolbaseMessaging,
  getOrCreateDeviceId,
  setPlatform,
  type KoolbaseConfig,
  type VersionCheckResult,
} from '@koolbase/core';
import { reactNativePlatform } from './platform.js';
import { createUseCollection } from './use-collection.js';

let _auth: KoolbaseAuth | null = null;
let _db: KoolbaseDatabase | null = null;
let _storage: KoolbaseStorage | null = null;
let _fiscal: KoolbaseFiscal | null = null;
let _realtime: KoolbaseRealtime | null = null;
let _functions: KoolbaseFunctions | null = null;
let _flags: KoolbaseFlags | null = null;
let _analytics: KoolbaseAnalytics | null = null;
// While analytics is off, calls are harmless no-ops rather than a crash.
const analyticsOff = disabledAnalytics();
let _messaging: KoolbaseMessaging | null = null;
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
    throw new Error('Koolbase not initialized. Call Koolbase.initialize() first.');
  }
}

export const Koolbase = {
  async initialize(config: KoolbaseConfig): Promise<void> {
    if (_initialized) return;
    if (_initializing) return _initializing;
    _initializing = (async () => {

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

    // One anonymous device id for the whole SDK — bucketing (flags), targeting
    // (code push), and registration keying (messaging) must all agree on it.
    const deviceId = await getOrCreateDeviceId();

    _flags = new KoolbaseFlags(config, deviceId);
    // Initialize analytics
    // Opt-in: nothing is sent unless the app asks for it.
    if (config.analyticsEnabled === true) {
      _analytics = new KoolbaseAnalytics(config, () => _auth?.currentUser?.id ?? null);
      await _analytics.init(config.appVersion);
    }
    // Initialize messaging
    if (config.messagingEnabled !== false) {
      _messaging = new KoolbaseMessaging(config);
      _messaging.setDeviceId(deviceId);
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

  get fiscal(): KoolbaseFiscal {
    ensureInitialized();
    return _fiscal!;
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
    return _flags!.isEnabled(key);
  },

  configString(key: string, fallback = ''): string {
    ensureInitialized();
    return _flags!.getString(key, fallback);
  },

  configNumber(key: string, fallback = 0): number {
    ensureInitialized();
    return _flags!.getNumber(key, fallback);
  },

  configBool(key: string, fallback = false): boolean {
    ensureInitialized();
    return _flags!.getBool(key, fallback);
  },

  get analytics(): KoolbaseAnalytics {
    ensureInitialized();
    return _analytics ?? analyticsOff;
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

export { SecureAuthStorage } from './auth-storage.js';

export type { UseCollectionResult } from './use-collection.js';

/**
 * A collection as React state: loading, loaded or error, with refresh and
 * loadMore. Equality filters only for now: `where: { field: value }`.
 * Use it after Koolbase.initialize() (in an exported app, inside KoolbaseRoot).
 *
 * ```tsx
 * const songs = useCollection('songs', { where: { genre: 'jazz' }, orderBy: 'title' });
 * ```
 */
export const useCollection = createUseCollection(() => Koolbase.db);
