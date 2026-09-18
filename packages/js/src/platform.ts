import type { PlatformAdapter, PlatformStorage } from '@koolbase/core';
import { BrowserAuthStorage } from './auth-storage';

// The browser host, expressed through the platform seam.
//
// Storage is IndexedDB behind the same four calls the core makes — get, set,
// remove, list. One object store, string keys, string values, one operation
// per transaction: exactly the contract the offline queue and conflict store
// were verified against, with nothing the RN adapter does not also do.
//
// What this adapter does NOT do, stated so it is not discovered later:
//
//  - Multi-tab coordination. Two tabs share one IndexedDB and one write
//    queue; both may replay the same pending write. Inserts are idempotent
//    on the server (ids are UUIDs from birth), so the damage is bounded, but
//    a conflict resolved in one tab can be re-resolved in another. v1 is
//    single-tab; a leader election is the fix and belongs in its own change.
//
//  - Secure token storage. There is no keychain in a browser. Anything
//    JavaScript can read, a script injected by XSS can read. The core's
//    KoolbaseAuthStorage is the injection point; the default here persists
//    the session in IndexedDB so a refresh does not sign the user out, and
//    the README says plainly what that means.

const DB_NAME = 'koolbase';
const STORE = 'kv';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
  });
}

function indexedDBStorage(): PlatformStorage & { close(): Promise<void> } {
  let dbp: Promise<IDBDatabase> | null = null;
  const db = () => (dbp ??= openDB());
  return {
    // Not part of PlatformStorage. Test harnesses call it between cases so
    // deleteDatabase is not blocked by a live connection.
    close: async () => {
      if (!dbp) return;
      (await dbp).close();
      dbp = null;
    },
    getItem: async (k) => {
      const v = await tx<string | undefined>(await db(), 'readonly', s => s.get(k) as IDBRequest<string | undefined>);
      return v ?? null;
    },
    setItem: async (k, v) => { await tx(await db(), 'readwrite', s => s.put(v, k)); },
    removeItem: async (k) => { await tx(await db(), 'readwrite', s => s.delete(k)); },
    getAllKeys: async () => {
      const keys = await tx<IDBValidKey[]>(await db(), 'readonly', s => s.getAllKeys());
      return keys.map(String);
    },
  };
}

// localStorage is synchronous and small, but present in more environments
// than IndexedDB (some private modes disable IDB). Used only when IDB is
// absent, so the common path keeps the larger, asynchronous store.
function localStorageStorage(): PlatformStorage {
  return {
    getItem: async (k) => localStorage.getItem(k),
    setItem: async (k, v) => { localStorage.setItem(k, v); },
    removeItem: async (k) => { localStorage.removeItem(k); },
    getAllKeys: async () => {
      const out: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k !== null) out.push(k);
      }
      return out;
    },
  };
}

function browserVersion(): string {
  if (typeof navigator === 'undefined') return '';
  const ua = navigator.userAgent;
  const m = /(Chrome|Firefox|Safari|Edg)\/([\d.]+)/.exec(ua);
  return m ? `${m[1]} ${m[2]}` : '';
}

export function browserPlatform(): PlatformAdapter {
  const hasIDB = typeof indexedDB !== 'undefined';
  return {
    storage: hasIDB ? indexedDBStorage() : localStorageStorage(),
    network: {
      onChange: (cb) => {
        // navigator.onLine is a hint that the interface is up, not that
        // Koolbase is reachable. The sync engine treats a false positive as
        // a failed request, the same as any other; a false negative is only
        // a delayed flush until the next event or manual sync.
        // No window in a worker or during SSR: no events, and the sync
        // engine falls back to discovering reachability by trying.
        if (typeof window === 'undefined') return () => {};
        const on = () => cb(true);
        const off = () => cb(false);
        window.addEventListener('online', on);
        window.addEventListener('offline', off);
        return () => {
          window.removeEventListener('online', on);
          window.removeEventListener('offline', off);
        };
      },
    },
    lifecycle: {
      onBackground: (cb) => {
        if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
        const handler = () => { if (document.visibilityState === 'hidden') cb(); };
        document.addEventListener('visibilitychange', handler);
        // pagehide is the reliable "tab is going away" signal on mobile
        // browsers, where visibilitychange may not fire before unload.
        window.addEventListener('pagehide', cb);
        return () => {
          document.removeEventListener('visibilitychange', handler);
          window.removeEventListener('pagehide', cb);
        };
      },
    },
    info: {
      os: 'web',
      version: browserVersion(),
    },
    // IndexedDB-backed; see auth-storage.ts for what that does and does not
    // protect against.
    authStorage: () => new BrowserAuthStorage(),
  };
}
