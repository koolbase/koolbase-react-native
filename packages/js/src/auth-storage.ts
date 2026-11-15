import type { KoolbaseAuthStorage, KoolbaseSession } from '@koolbase/core';
import { getPlatform } from '@koolbase/core';

// Session persistence for the browser.
//
// This is the default when an app injects nothing through
// KoolbaseConfig.authStorage. It keeps the session in the platform's storage
// — IndexedDB — so a page refresh does not sign the user out.
//
// Remember me (12.44.0): a sign-in made with `remember: false` is kept in the
// tab's sessionStorage instead, so it ends when the tab or the browser closes
// and a new tab asks again — the browser's usual meaning, and Firebase's
// "session" persistence. A refresh saves the session where it already lives,
// so a session that is not remembered never reaches IndexedDB.
//
// What it is not: secure the way a keychain is. IndexedDB, localStorage and
// every other store a page can read are readable by any script running on
// that page, so an XSS vulnerability in the app exposes the session. That is
// true of every browser SDK from every vendor; the mitigations are an
// application's content-security policy and short session lifetimes, not a
// storage backend. An app that needs a different trade-off — an httpOnly
// cookie set by its own backend, say — injects its own KoolbaseAuthStorage.

const KEY = 'koolbase_session_v1';
/** This tab's session: a sign-in that is not remembered. */
const TAB_KEY = 'koolbase_session_tab_v1';

/** Where the session lives: kept (IndexedDB) or this tab's only. */
type Place = 'kept' | 'tab';

/** The tab's own store, or null where there is none (a server render, a
 *  sandboxed frame that refuses it). Then a tab session lives in memory and
 *  ends with the page — never in IndexedDB. */
function tabStore(): Storage | null {
  try {
    const s = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

export class BrowserAuthStorage implements KoolbaseAuthStorage {
  /** Set by a sign-in (setRemember), or found where the session is. */
  private place: Place | null = null;

  /** A tab session where the tab has no store of its own. */
  private memory: string | null = null;

  private tabRead(): string | null {
    const s = tabStore();
    if (!s) return this.memory;
    try {
      return s.getItem(TAB_KEY);
    } catch {
      return this.memory;
    }
  }

  private tabWrite(raw: string | null): void {
    this.memory = raw;
    const s = tabStore();
    if (!s) return;
    try {
      if (raw === null) s.removeItem(TAB_KEY);
      else s.setItem(TAB_KEY, raw);
    } catch {
      // Refused (quota, a sandbox): it lives in memory, for this page.
    }
  }

  async setRemember(remember: boolean): Promise<void> {
    this.place = remember ? 'kept' : 'tab';
    // One place at a time: the other's copy belongs to an earlier sign-in.
    if (remember) this.tabWrite(null);
    else await getPlatform().storage.removeItem(KEY);
  }

  async readSession(): Promise<KoolbaseSession | null> {
    // This tab's session first: a sign-in here that is not remembered.
    const tab = this.tabRead();
    if (tab) {
      try {
        const session = JSON.parse(tab) as KoolbaseSession;
        this.place = 'tab';
        return session;
      } catch {
        this.tabWrite(null);
      }
    }
    const raw = await getPlatform().storage.getItem(KEY);
    if (!raw) return null;
    try {
      const session = JSON.parse(raw) as KoolbaseSession;
      this.place = 'kept';
      return session;
    } catch {
      await getPlatform().storage.removeItem(KEY);
      return null;
    }
  }

  async saveSession(session: KoolbaseSession): Promise<void> {
    const raw = JSON.stringify(session);
    // Where it already lives: a refresh never moves a tab session to
    // IndexedDB. Unknown (a fresh page that has not read): the tab's copy
    // says so if there is one.
    const place = this.place ?? (this.tabRead() !== null ? 'tab' : 'kept');
    this.place = place;
    if (place === 'tab') {
      this.tabWrite(raw);
      return;
    }
    await getPlatform().storage.setItem(KEY, raw);
  }

  async clear(): Promise<void> {
    this.tabWrite(null);
    this.place = null;
    await getPlatform().storage.removeItem(KEY);
  }
}
