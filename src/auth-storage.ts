import { KoolbaseAuthStorage, KoolbaseSession } from './types';

// Lazy-load react-native-keychain so apps without it installed (e.g. Expo Go,
// or those providing a custom adapter) can still import this module without
// crashing. The default SecureAuthStorage will throw a clear error on first
// use if the peer dependency is missing.
let _keychain: typeof import('react-native-keychain') | null = null;
let _keychainAttempted = false;

function loadKeychain(): typeof import('react-native-keychain') {
  if (!_keychainAttempted) {
    _keychainAttempted = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      _keychain = require('react-native-keychain');
    } catch {
      _keychain = null;
    }
  }
  if (!_keychain) {
    throw new Error(
      '[Koolbase] SecureAuthStorage requires react-native-keychain. ' +
        'Install it with:\n  npm install react-native-keychain\n' +
        'Or provide your own storage adapter via ' +
        'KoolbaseConfig.authStorage. For Expo Go (where ' +
        'react-native-keychain is unavailable), implement KoolbaseAuthStorage ' +
        'with expo-secure-store and pass it via authStorage.'
    );
  }
  return _keychain;
}

/**
 * Probe whether react-native-keychain is installed without throwing.
 * Used by KoolbaseAuth to decide whether to instantiate a default
 * SecureAuthStorage or proceed without persistence.
 */
export function isKeychainAvailable(): boolean {
  if (!_keychainAttempted) {
    _keychainAttempted = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      _keychain = require('react-native-keychain');
    } catch {
      _keychain = null;
    }
  }
  return _keychain !== null;
}

/**
 * Default secure storage implementation backed by `react-native-keychain`.
 *
 * - iOS: Keychain (encrypted, never synced via iCloud by default)
 * - Android: Android Keystore-backed encryption
 *
 * Requires `react-native-keychain` as a peer dependency. Apps that prefer a
 * different secure backend (e.g. `expo-secure-store`,
 * `react-native-encrypted-storage`, an in-memory mock for testing, or a
 * compliance-grade encryption layer) should implement the
 * {@link KoolbaseAuthStorage} interface and pass it via
 * `KoolbaseConfig.authStorage`.
 */
export class SecureAuthStorage implements KoolbaseAuthStorage {
  private static readonly SERVICE = 'koolbase_session_v1';

  async saveSession(session: KoolbaseSession): Promise<void> {
    const Keychain = loadKeychain();
    await Keychain.setGenericPassword(
      'session',
      JSON.stringify(session),
      { service: SecureAuthStorage.SERVICE }
    );
  }

  async readSession(): Promise<KoolbaseSession | null> {
    let Keychain: typeof import('react-native-keychain');
    try {
      Keychain = loadKeychain();
    } catch {
      // Peer dep missing — caller will fall back to no persistence.
      return null;
    }
    try {
      const credentials = await Keychain.getGenericPassword({
        service: SecureAuthStorage.SERVICE,
      });
      if (!credentials || !credentials.password) return null;
      return JSON.parse(credentials.password) as KoolbaseSession;
    } catch {
      // Corrupt data, schema mismatch, or platform-level keychain error.
      // Treat as no session — caller will trigger fresh login.
      return null;
    }
  }

  async clear(): Promise<void> {
    let Keychain: typeof import('react-native-keychain');
    try {
      Keychain = loadKeychain();
    } catch {
      return; // No-op if peer dep missing.
    }
    await Keychain.resetGenericPassword({
      service: SecureAuthStorage.SERVICE,
    });
  }
}
