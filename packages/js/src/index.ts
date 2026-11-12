// @koolbase/js — composes @koolbase/core for the browser.
//
// The same surface as @koolbase/react-native where the browser can honour it.
// What is deliberately absent, so it is not discovered as a method that
// fails: code push (a native-bundle concept; the web already has one), the
// logic engine (its flows arrived only through code-push bundles), and
// Apple/Google native sign-in (use the web OAuth flows against the same auth
// endpoints). Messaging registers a browser's FCM token as `web` (R138).

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
  KoolbaseConnectivity,
  KoolbaseFlags,
  KoolbaseAnalytics,
  disabledAnalytics,
  KoolbaseMessaging,
  getOrCreateDeviceId,
  setPlatform,
  type KoolbaseConfig,
  type VersionCheckResult, type FetchLike, setSessionRenewal, setFetch, memoryPlatform, MemoryAuthStorage } from '@koolbase/core';
import { browserPlatform } from './platform.js';

let _auth: KoolbaseAuth | null = null;
let _db: KoolbaseDatabase | null = null;
let _storage: KoolbaseStorage | null = null;
let _fiscal: KoolbaseFiscal | null = null;
let _realtime: KoolbaseRealtime | null = null;
let _connectivity: KoolbaseConnectivity | null = null;
let _functions: KoolbaseFunctions | null = null;
let _flags: KoolbaseFlags | null = null;
let _analytics: KoolbaseAnalytics | null = null;
let _messaging: KoolbaseMessaging | null = null;
// While analytics is off, calls are harmless no-ops rather than a crash.
const analyticsOff = disabledAnalytics();
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
    // Every JSON request the SDK makes goes through config.fetch, when one is given (R49).
    setFetch(config.fetch ?? null);

    _auth = new KoolbaseAuth(config);
    // A data request refused with the signed-in person's token renews the
    // session once and goes again (#96); only a refused renewal ends it.
    setSessionRenewal((refused) => (_auth ? _auth.renewRejected(refused) : Promise.resolve(null)));
    _db = new KoolbaseDatabase(
      config,
      () => _auth?.currentUser?.id ?? null,
      () => _auth?.validAccessToken() ?? Promise.resolve(null),
      async () => { await _auth?.sessionRejected(); },
    );
    _storage = new KoolbaseStorage(
      config,
      () => _auth?.validAccessToken() ?? Promise.resolve(null),
      async () => { await _auth?.sessionRejected(); },
      // Project identity for publicUrlFor, from the bootstrap payload; a
      // missing one nudges a refresh (as Flutter's storage client).
      () => _flags?.projectId() ?? '',
      () => { void _flags?.refresh(); },
    );
    _fiscal = new KoolbaseFiscal(
      config,
      () => _auth?.validAccessToken() ?? Promise.resolve(null),
      async () => { await _auth?.sessionRejected(); },
    );
    _realtime = new KoolbaseRealtime(
      config,
      () => _auth?.validAccessToken() ?? Promise.resolve(null),
      () => _auth?.currentUser?.id ?? null,
    );
    // Signed in, signed out, another user: the realtime connection is
    // replaced to match (signed out, collections anyone can read only).
    let lastUser = _auth?.currentUser?.id ?? null;
    _auth?.onAuthStateChange(() => {
      _realtime?.sessionChanged();
      // Pending writes and conflicts are per-user: watchers read again.
      _db?.sessionChanged();
      // R138: a registered device follows who is signed in.
      const user = _auth?.currentUser?.id ?? null;
      if (user !== lastUser) {
        lastUser = user;
        void _messaging?.sessionChanged();
      }
    });
    // Whether the device reports a connection: unknown until it first answers.
    _connectivity = new KoolbaseConnectivity();
    _connectivity.start();
    _functions = new KoolbaseFunctions(
      config,
      () => _auth?.validAccessToken() ?? Promise.resolve(null),
      async () => { await _auth?.sessionRejected(); },
    );

    const deviceId = await getOrCreateDeviceId();
    _flags = new KoolbaseFlags(config, deviceId);
    // The bootstrap payload (flags, config, version policy, project identity),
    // fetched in the background as Flutter's SDK does: never blocks startup.
    void _flags.koolbaseFetch(config.appVersion ?? '0.0.0', 'web');

    // Opt-in: nothing is sent unless the app asks for it.
    if (config.analyticsEnabled === true) {
      _analytics = new KoolbaseAnalytics(config, () => _auth?.currentUser?.id ?? null);
      await _analytics.init(config.appVersion);
    }
    // A browser's FCM token registers as web (R138).
    if (config.messagingEnabled !== false) {
      _messaging = new KoolbaseMessaging(config, () => _auth?.validAccessToken() ?? Promise.resolve(null));
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

  /**
   * For tests (R49): the real initialize, against a server you give as
   * `fetch` -- the SDK's own auth and data code runs; only the server is
   * yours -- with storage and the session in memory, and no analytics.
   * Messaging registers on that server too (R138). Call resetForTesting
   * after each test.
   *
   * ```ts
   * await Koolbase.initializeForTesting({ fetch: myFakeServer });
   * await Koolbase.auth.login({ email, password });
   * ```
   */
  async initializeForTesting(options: { fetch: FetchLike; baseUrl?: string; publicKey?: string }): Promise<void> {
    await Koolbase.initialize({
      baseUrl: options.baseUrl ?? 'http://koolbase.test',
      publicKey: options.publicKey ?? 'pk_test',
      platform: memoryPlatform(),
      authStorage: new MemoryAuthStorage(),
      fetch: options.fetch,
      analyticsEnabled: false,
    });
  },

  /** After a test (R49): everything initialize made is dropped, so the next one starts from nothing. */
  resetForTesting(): void {
    (_connectivity as unknown as { stop?: () => void } | null)?.stop?.();
    setSessionRenewal(null);
    setFetch(null);
    _auth = null;
    _db = null;
    _storage = null;
    _fiscal = null;
    _realtime = null;
    _connectivity = null;
    _functions = null;
    _flags = null;
    _analytics = null;
    _messaging = null;
    _initialized = false;
    _initializing = null;
  },

  get auth(): KoolbaseAuth { ensureInitialized(); return _auth!; },
  get db(): KoolbaseDatabase { ensureInitialized(); return _db!; },
  get storage(): KoolbaseStorage { ensureInitialized(); return _storage!; },
  get fiscal(): KoolbaseFiscal { ensureInitialized(); return _fiscal!; },
  get realtime(): KoolbaseRealtime { ensureInitialized(); return _realtime!; },
  get connectivity(): KoolbaseConnectivity { ensureInitialized(); return _connectivity!; },
  get functions(): KoolbaseFunctions { ensureInitialized(); return _functions!; },
  get messaging(): KoolbaseMessaging { ensureInitialized(); return _messaging!; },
  get analytics(): KoolbaseAnalytics {
    ensureInitialized();
    return _analytics ?? analyticsOff;
  },

  isEnabled(key: string): boolean { ensureInitialized(); return _flags!.isEnabled(key); },
  configString(key: string, fallback = ''): string { ensureInitialized(); return _flags!.getString(key, fallback); },
  /** Told each time flags and config arrive or refresh; returns the unsubscribe. */
  onRemoteChange(listener: () => void): () => void { ensureInitialized(); return _flags!.subscribe(listener); },
  configNumber(key: string, fallback = 0): number { ensureInitialized(); return _flags!.getNumber(key, fallback); },
  configBool(key: string, fallback = false): boolean { ensureInitialized(); return _flags!.getBool(key, fallback); },
  checkVersion(currentVersion: string): VersionCheckResult { ensureInitialized(); return _flags!.checkVersion(currentVersion); },
};
