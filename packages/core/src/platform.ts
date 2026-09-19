// Shared across module instances; see shared.ts for why.
import { shared, setShared } from './shared.js';

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

/**
 * Coordination between copies of the SDK that share durable storage.
 *
 * Two locks, different problems, different durations:
 *
 *   exclusive     short, waited for, held across a read-modify-write of the
 *                 offline state and never across the network. Stops one copy
 *                 overwriting another's queued write.
 *
 *   tryExclusive  a lease on the responsibility to replay the queue, held for
 *                 a whole flush pass INCLUDING its HTTP calls, and never
 *                 waited for. Without it two tabs read the same pending write
 *                 and both send it: the state stays consistent and the server
 *                 is hit twice. A copy that cannot take the lease skips,
 *                 because whoever holds it is already doing the work.
 *
 * A host where the SDK cannot be running twice over one store — React Native,
 * one process — satisfies both by just running the function.
 */
export interface PlatformLocks {
  exclusive<T>(name: string, fn: () => Promise<T>): Promise<T>;
  tryExclusive(name: string, fn: () => Promise<void>): Promise<{ ran: boolean }>;
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
  locks: PlatformLocks;
  /**
   * The host's best persistent store for the auth session, or null if it has
   * none worth the name. Used only when the app injects nothing through
   * KoolbaseConfig.authStorage. React Native answers with the keychain when
   * it is installed; a browser answers with IndexedDB and says so in its
   * README, since nothing JavaScript can read is secure against XSS.
   */
  authStorage(): import('./types.js').KoolbaseAuthStorage | null;
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
    // One process, one store, and the in-process promise chain in
    // offline-state already serialises it.
    locks: {
      exclusive: (_n, fn) => fn(),
      tryExclusive: async (_n, fn) => { await fn(); return { ran: true }; },
    },
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
