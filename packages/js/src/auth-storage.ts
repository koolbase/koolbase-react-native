import type { KoolbaseAuthStorage, KoolbaseSession } from '@koolbase/core';
import { getPlatform } from '@koolbase/core';

// Session persistence for the browser.
//
// This is the default when an app injects nothing through
// KoolbaseConfig.authStorage. It keeps the session in the platform's storage
// — IndexedDB — so a page refresh does not sign the user out.
//
// What it is not: secure the way a keychain is. IndexedDB, localStorage and
// every other store a page can read are readable by any script running on
// that page, so an XSS vulnerability in the app exposes the session. That is
// true of every browser SDK from every vendor; the mitigations are an
// application's content-security policy and short session lifetimes, not a
// storage backend. An app that needs a different trade-off — an httpOnly
// cookie set by its own backend, say — injects its own KoolbaseAuthStorage.

const KEY = 'koolbase_session_v1';

export class BrowserAuthStorage implements KoolbaseAuthStorage {
  async readSession(): Promise<KoolbaseSession | null> {
    const raw = await getPlatform().storage.getItem(KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as KoolbaseSession;
    } catch {
      await this.clear();
      return null;
    }
  }

  async saveSession(session: KoolbaseSession): Promise<void> {
    await getPlatform().storage.setItem(KEY, JSON.stringify(session));
  }

  async clear(): Promise<void> {
    await getPlatform().storage.removeItem(KEY);
  }
}
