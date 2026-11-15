import { KoolbaseAuth } from '../src/auth';
import * as errors from '../src/auth-errors';
import { setPlatform, getPlatform } from '../src/platform';
import type { KoolbaseAuthStorage, KoolbaseSession } from '../src/types';
import { testPlatform } from './platform';
import { BrowserAuthStorage } from '../../js/src/auth-storage'; // test-only reach across packages
// The browser storage reads its platform through the package entry: the same
// adapter is installed there too.
import { setPlatform as setEntryPlatform } from '@koolbase/core';

// Remember me (12.44.0). A sign-in says whether its session outlasts the
// browser; the SDK tells the storage before it saves -- through a second step
// (MFA) too -- and never tells the server. A refresh is not a sign-in and
// keeps the place the session has. Omitted, a sign-in is remembered, as
// before. The browser's storage keeps a session that is not remembered in
// the tab's sessionStorage, never in IndexedDB.

const sessionBody = (token = 'at') => ({
  access_token: token,
  refresh_token: 'rt',
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  user: { id: 'u1', email: 'ama@example.com', verified: true },
});

function reply(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as never;
}

function lastBody() {
  const calls = (global.fetch as unknown as jest.Mock).mock.calls;
  const init = calls[calls.length - 1][1];
  return init?.body ? JSON.parse(init.body) : undefined;
}

/** A storage that records what it is told, in order. */
class Recording implements KoolbaseAuthStorage {
  told: string[] = [];
  async setRemember(remember: boolean) {
    this.told.push(`remember:${remember}`);
  }
  async saveSession(s: KoolbaseSession) {
    this.told.push(`save:${s.accessToken}`);
  }
  async readSession() {
    return null;
  }
  async clear() {
    this.told.push('clear');
  }
}

const config = (authStorage: KoolbaseAuthStorage) =>
  ({ baseUrl: 'https://api.test', publicKey: 'pk', authStorage }) as never;

describe('Remember me: the sign-in tells the storage', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('login: the choice before the save, and never sent to the server', async () => {
    global.fetch = reply(200, sessionBody());
    const st = new Recording();
    await new KoolbaseAuth(config(st)).login({ email: 'ama@example.com', password: 'password123', remember: false });
    expect(st.told).toEqual(['remember:false', 'save:at']);
    expect(lastBody()).toEqual({ email: 'ama@example.com', password: 'password123' });
  });

  it('omitted: remembered, as before', async () => {
    global.fetch = reply(200, sessionBody());
    const st = new Recording();
    await new KoolbaseAuth(config(st)).login({ email: 'ama@example.com', password: 'password123' });
    expect(st.told).toEqual(['remember:true', 'save:at']);
  });

  it('every sign-in carries it: email code, phone, Google, Apple', async () => {
    const cases: [string, (a: KoolbaseAuth) => Promise<unknown>][] = [
      ['email code', (a) => a.signInWithEmailCode({ email: 'ama@example.com', code: '123456', remember: false })],
      ['phone', (a) => a.verifyOtp({ phoneNumber: '+233201234567', code: '123456', remember: false })],
      ['google', (a) => a.signInWithGoogle({ idToken: 'id', remember: false })],
      ['apple', (a) => a.signInWithApple({ identityToken: 'id', remember: false })],
    ];
    for (const [name, signIn] of cases) {
      global.fetch = reply(200, sessionBody());
      const st = new Recording();
      await signIn(new KoolbaseAuth(config(st)));
      expect({ name, told: st.told }).toEqual({ name, told: ['remember:false', 'save:at'] });
      expect({ name, sent: JSON.stringify(lastBody()).includes('remember') }).toEqual({ name, sent: false });
    }
  });

  it('a second step (MFA) keeps the first step\'s choice', async () => {
    const st = new Recording();
    const auth = new KoolbaseAuth(config(st));
    global.fetch = reply(403, { code: 'mfa_required', error: 'two-step', details: { challenge_token: 'ct' } });
    const err = await auth.login({ email: 'ama@example.com', password: 'password123', remember: false }).catch((e) => e);
    expect(err).toBeInstanceOf(errors.MfaRequiredError);
    expect(st.told).toEqual([]);
    global.fetch = reply(200, sessionBody());
    await auth.verifyMfa({ challengeToken: 'ct', code: '123456' });
    expect(st.told).toEqual(['remember:false', 'save:at']);
  });

  it('a refresh is not a sign-in: the place is kept', async () => {
    const st = new Recording();
    const auth = new KoolbaseAuth(config(st));
    global.fetch = reply(200, sessionBody());
    await auth.login({ email: 'ama@example.com', password: 'password123', remember: false });
    global.fetch = reply(200, sessionBody('at2'));
    await auth.refresh();
    expect(st.told).toEqual(['remember:false', 'save:at', 'save:at2']);
  });

  it('a storage without it (a keychain, an app\'s own) saves as before', async () => {
    global.fetch = reply(200, sessionBody());
    const saved: string[] = [];
    const plain: KoolbaseAuthStorage = {
      saveSession: async (s) => void saved.push(s.accessToken),
      readSession: async () => null,
      clear: async () => {},
    };
    await new KoolbaseAuth(config(plain)).login({ email: 'ama@example.com', password: 'password123', remember: false });
    expect(saved).toEqual(['at']);
  });
});

describe('Remember me: the browser storage', () => {
  // The tab's own store, as a browser has it.
  let tab: Map<string, string>;
  beforeEach(async () => {
    const p = await testPlatform();
    setPlatform(p);
    setEntryPlatform(p as never);
    tab = new Map();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (k: string) => tab.get(k) ?? null,
      setItem: (k: string, v: string) => void tab.set(k, v),
      removeItem: (k: string) => void tab.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  });

  const s = (t: string) => ({ accessToken: t, refreshToken: 'rt', expiresAt: '', user: { id: 'u1' } }) as unknown as KoolbaseSession;
  const kept = () => getPlatform().storage.getItem('koolbase_session_v1');

  it('not remembered: the tab only, never kept; a refresh stays in the tab', async () => {
    const b = new BrowserAuthStorage();
    await b.setRemember(false);
    await b.saveSession(s('at'));
    expect(await kept()).toBeNull();
    expect(JSON.parse(tab.get('koolbase_session_tab_v1')!).accessToken).toBe('at');
    await b.saveSession(s('at2'));
    expect(await kept()).toBeNull();
    // A reload in the same tab: a fresh storage finds it.
    expect((await new BrowserAuthStorage().readSession())?.accessToken).toBe('at2');
  });

  it('a fresh page that saves before reading keeps a tab session in the tab', async () => {
    tab.set('koolbase_session_tab_v1', JSON.stringify(s('at')));
    await new BrowserAuthStorage().saveSession(s('at2'));
    expect(await kept()).toBeNull();
  });

  it('remembered: kept, as before; the tab copy of an earlier sign-in goes', async () => {
    const b = new BrowserAuthStorage();
    await b.setRemember(false);
    await b.saveSession(s('old'));
    await b.setRemember(true);
    await b.saveSession(s('at'));
    expect(tab.has('koolbase_session_tab_v1')).toBe(false);
    expect(JSON.parse((await kept())!).accessToken).toBe('at');
    expect((await new BrowserAuthStorage().readSession())?.accessToken).toBe('at');
  });

  it('not remembered after a remembered one: the kept copy goes', async () => {
    const b = new BrowserAuthStorage();
    await b.saveSession(s('kept'));
    await b.setRemember(false);
    expect(await kept()).toBeNull();
  });

  it('clear removes both', async () => {
    const b = new BrowserAuthStorage();
    await b.saveSession(s('kept'));
    tab.set('koolbase_session_tab_v1', JSON.stringify(s('tab')));
    await b.clear();
    expect(await kept()).toBeNull();
    expect(tab.has('koolbase_session_tab_v1')).toBe(false);
  });

  it('no tab store (a sandboxed frame): a tab session lives in memory, never kept', async () => {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    const b = new BrowserAuthStorage();
    await b.setRemember(false);
    await b.saveSession(s('at'));
    expect(await kept()).toBeNull();
    expect((await b.readSession())?.accessToken).toBe('at');
  });
});
