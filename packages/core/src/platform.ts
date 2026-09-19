// Shared across module instances; see shared.ts for why.
import { shared, setShared } from './shared';

// The platform seam.
//
// Everything the SDK needs from the host that is not plain JavaScript goes
// through here: persistent key-value storage, whether the network is up, when
// the app goes to the background, and what platform this is. The core never
// imports a native module; a platform package supplies an adapter once at
// initialize, and tests supply the in-memory one below.
//
// The storage contract is deliberately the four calls the SDK already made
// against AsyncStorage — get, set, remove, list — with no batch or transaction.
// That is what the offline queue and conflict store were device-verified on,
// so an adapter that provides exactly this preserves proven behaviour. A
// richer contract can come later, behind the same interface.

export interface PlatformStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<string[]>;
}

export interface PlatformNetwork {
  /**
   * Subscribe to connectivity changes. The callback receives true when the
   * host believes it is online. Treated as a hint: the sync engine still
   * discovers reachability by trying, and a host that reports online while
   * Koolbase is unreachable is handled the same as any failed request.
   */
  onChange(callback: (online: boolean) => void): () => void;
}

export interface PlatformLifecycle {
  /** Subscribe to the app moving to the background. Used to flush analytics. */
  onBackground(callback: () => void): () => void;
}

export interface PlatformInfo {
  /** e.g. 'ios', 'android', 'web' */
  os: string;
  /** OS or browser version, as a string; '' if unknown. */
  version: string;
}

export interface PlatformAdapter {
  storage: PlatformStorage;
  network: PlatformNetwork;
  lifecycle: PlatformLifecycle;
  info: PlatformInfo;
  /**
   * The host's best persistent store for the auth session, or null if it has
   * none worth the name. Used only when the app injects nothing through
   * KoolbaseConfig.authStorage. React Native answers with the keychain when
   * it is installed; a browser answers with IndexedDB and says so in its
   * README, since nothing JavaScript can read is secure against XSS.
   */
  authStorage(): import('./types').KoolbaseAuthStorage | null;
}

/**
 * An adapter that persists nothing beyond the process and reports the
 * network as always up. The default until a platform sets its own — which
 * makes tests run without a module mapper, and makes forgetting to call
 * setPlatform an obvious failure (nothing survives a restart) rather than a
 * crash.
 */
export function memoryPlatform(): PlatformAdapter {
  const store = new Map<string, string>();
  return {
    storage: {
      getItem: async (k) => store.get(k) ?? null,
      setItem: async (k, v) => { store.set(k, v); },
      removeItem: async (k) => { store.delete(k); },
      getAllKeys: async () => Array.from(store.keys()),
    },
    network: {
      onChange: () => () => {},
    },
    lifecycle: {
      onBackground: () => () => {},
    },
    info: { os: 'memory', version: '' },
    authStorage: () => null,
  };
}


/** Install the host platform. Called once by the platform package's initialize. */
export function setPlatform(adapter: PlatformAdapter): void {
  setShared('platform', adapter);
}

/** The installed platform. Always returns something; see memoryPlatform. */
export function getPlatform(): PlatformAdapter {
  return shared('platform', memoryPlatform) as PlatformAdapter;
}
