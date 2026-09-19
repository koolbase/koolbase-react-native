import { browserPlatform } from '../../js/src/platform';

// @koolbase/js is a client SDK, and a client SDK gets imported on a server:
// Next.js renders components there, tooling loads modules there. It must not
// crash, and it must not leak one caller's session into another's.
//
// These run under jest's node environment, where window, document,
// indexedDB and localStorage are all undefined — the same shape as a server
// render.

describe('browser adapter outside a browser', () => {
  it('constructs without touching a browser global', () => {
    // Before the fix this threw at first use: with no indexedDB the adapter
    // fell through to localStorage, which does not exist in Node either.
    expect(() => browserPlatform()).not.toThrow();
  });

  it('storage works and persists nothing beyond the adapter', async () => {
    const p = browserPlatform();
    await p.storage.setItem('k', 'v');
    expect(await p.storage.getItem('k')).toBe('v');
    expect(await p.storage.getAllKeys()).toEqual(['k']);
    await p.storage.removeItem('k');
    expect(await p.storage.getItem('k')).toBeNull();
  });

  it('two adapters share nothing', async () => {
    // The requirement behind this: a server process that built a client for
    // one request must not hand that request's session to the next. The
    // adapter is the storage boundary, so two adapters must be two stores.
    const a = browserPlatform();
    const b = browserPlatform();
    await a.storage.setItem('koolbase_session_v1', 'user-a-session');
    expect(await b.storage.getItem('koolbase_session_v1')).toBeNull();
  });

  it('reports the session as absent rather than failing', async () => {
    // What restoreSession() reads. An empty store means NoSession, which is
    // the correct answer on a server: there is no browser session to restore.
    const p = browserPlatform();
    const stored = await p.storage.getItem('koolbase_session_v1');
    expect(stored).toBeNull();
  });

  it('network and lifecycle subscriptions are inert, not fatal', () => {
    const p = browserPlatform();
    const offNet = p.network.onChange(() => {});
    const offLife = p.lifecycle.onBackground(() => {});
    expect(typeof offNet).toBe('function');
    expect(typeof offLife).toBe('function');
    expect(() => { offNet(); offLife(); }).not.toThrow();
  });

  it('still identifies itself as web', () => {
    // The host is a JavaScript runtime without a DOM, not a different SDK.
    // x-koolbase-sdk must still say js so server-side requests are
    // attributed correctly.
    expect(browserPlatform().info.os).toBe('web');
  });
});
