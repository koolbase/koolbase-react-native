import { KoolbaseAuth } from '../src/auth';
import { KoolbaseDatabase } from '../src/database';
import { KoolbaseUnauthenticatedError } from '../src/errors';
import { RestoreResult, type KoolbaseAuthStorage, type KoolbaseSession } from '../src/types';
import { setPlatform } from '../src/platform';
import { setSessionRenewal } from '../src/network';
import { testPlatform } from './platform';

// Sessions across a restart and past their expiry (#96, #104).
//
// #104: after signing out, the app reopened signed in on a stale local
// session. #96: hours later the session was not renewed, every list failed,
// and Retry did not help. These prove the rules that fix both: a restart asks
// the server before trusting a session; a refused request renews once and
// goes again; only a refused renewal signs anyone out; and two tabs renewing
// at the same moment end up sharing one session rather than both signed out.

/** One device's keychain: what survives a restart. */
class DeviceStorage implements KoolbaseAuthStorage {
  session: KoolbaseSession | null = null;
  async readSession() { return this.session; }
  async saveSession(s: KoolbaseSession) { this.session = s; }
  async clear() { this.session = null; }
}

const user = { id: 'u1', email: 'a@b.test', verified: true };
const later = () => new Date(Date.now() + 15 * 60 * 1000).toISOString();
const earlier = () => new Date(Date.now() - 60 * 1000).toISOString();
const wire = (at: string, rt: string) => ({ access_token: at, refresh_token: rt, expires_at: later(), user });
const stored = (at: string, rt: string, expiresAt = later()): KoolbaseSession =>
  ({ accessToken: at, refreshToken: rt, expiresAt, user: { id: 'u1', email: 'a@b.test', verified: true } } as KoolbaseSession);

type Handler = (url: string, init: RequestInit) => { status: number; body?: unknown } | 'offline';

/** A server: each request answered by `handle`; every call recorded. */
function server(handle: Handler) {
  const calls: { url: string; auth?: string; body?: string }[] = [];
  global.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const h = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url, auth: h.Authorization, body: typeof init.body === 'string' ? init.body : undefined });
    const r = handle(url, init);
    if (r === 'offline') throw new TypeError('Network request failed');
    return {
      ok: r.status < 400,
      status: r.status,
      json: async () => r.body ?? {},
      text: async () => JSON.stringify(r.body ?? {}),
    } as Response;
  }) as never;
  return calls;
}

const config = (storage: KoolbaseAuthStorage) => ({ baseUrl: 'https://api.test', publicKey: 'pk', authStorage: storage }) as never;

describe('a restart', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
    setSessionRenewal(null);
  });

  it('after signing out opens signed out (#104)', async () => {
    const device = new DeviceStorage();
    server((url) => (url.endsWith('/login') ? { status: 200, body: wire('at1', 'rt1') } : { status: 204 }));
    const before = new KoolbaseAuth(config(device));
    await before.login({ email: 'a@b.test', password: 'password123' });
    await before.logout();
    expect(before.lastSignOutReason).toBe('signed_out');
    expect(device.session).toBeNull();

    const after = new KoolbaseAuth(config(device));
    expect(await after.restoreSession()).toBe(RestoreResult.NoSession);
    expect(after.currentUser).toBeNull();
  });

  it('with a session revoked on the server opens signed out, though its token has not expired (#104)', async () => {
    const device = new DeviceStorage();
    device.session = stored('at1', 'rt1');
    const calls = server((url) =>
      url.endsWith('/me') ? { status: 401, body: { error: 'invalid token' } }
        : url.endsWith('/refresh') ? { status: 401, body: { code: 'invalid_refresh_token', error: 'invalid or expired refresh token' } }
          : { status: 500 });
    const auth = new KoolbaseAuth(config(device));
    expect(await auth.restoreSession()).toBe(RestoreResult.Expired);
    expect(auth.currentUser).toBeNull();
    expect(auth.lastSignOutReason).toBe('session_ended');
    expect(device.session).toBeNull();
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['me', 'refresh']);
  });

  it('with a good session asks the server once and stays signed in', async () => {
    const device = new DeviceStorage();
    device.session = stored('at1', 'rt1');
    const calls = server((url) => (url.endsWith('/me') ? { status: 200, body: user } : { status: 500 }));
    const auth = new KoolbaseAuth(config(device));
    expect(await auth.restoreSession()).toBe(RestoreResult.Restored);
    expect(auth.currentUser?.id).toBe('u1');
    expect(calls).toHaveLength(1);
  });

  it('offline keeps the session, to be checked when the network returns', async () => {
    const device = new DeviceStorage();
    device.session = stored('at1', 'rt1');
    server(() => 'offline');
    const auth = new KoolbaseAuth(config(device));
    expect(await auth.restoreSession()).toBe(RestoreResult.Offline);
    expect(auth.currentUser?.id).toBe('u1');
    expect(device.session).not.toBeNull();
  });

  it('with an expired access token renews it and stays signed in', async () => {
    const device = new DeviceStorage();
    device.session = stored('at1', 'rt1', earlier());
    server((url) => (url.endsWith('/refresh') ? { status: 200, body: wire('at2', 'rt2') } : { status: 500 }));
    const auth = new KoolbaseAuth(config(device));
    expect(await auth.restoreSession()).toBe(RestoreResult.Restored);
    expect(device.session?.refreshToken).toBe('rt2');
  });
});

describe('a request refused as unauthenticated (#96)', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  /** Signed in, with the SDK's own wiring: renewal and session ending. */
  function signedIn(device: DeviceStorage) {
    const auth = new KoolbaseAuth(config(device));
    void auth.setSession(device.session);
    setSessionRenewal((refused) => auth.renewRejected(refused));
    const db = new KoolbaseDatabase(config(device), () => 'u1', () => auth.validAccessToken(), () => auth.sessionRejected());
    return { auth, db };
  }

  it('renews the session once and goes again, unseen by the caller', async () => {
    const device = new DeviceStorage();
    device.session = stored('at1', 'rt1');
    const { auth, db } = signedIn(device);
    const calls = server((url, init) => {
      const h = init.headers as Record<string, string>;
      if (url.endsWith('/refresh')) return { status: 200, body: wire('at2', 'rt2') };
      if (h.Authorization === 'Bearer at1') return { status: 401, body: { error: 'unauthorized' } };
      return { status: 200, body: { records: [{ id: 'r1', data: {} }], total: 1 } };
    });
    const res = await db.query('events', { limit: 10 } as never);
    expect((res as { records: unknown[] }).records).toHaveLength(1);
    expect(auth.currentUser?.id).toBe('u1');
    expect(device.session?.accessToken).toBe('at2');
    expect(calls.filter((c) => c.url.endsWith('/query')).map((c) => c.auth)).toEqual(['Bearer at1', 'Bearer at2']);
  });

  it('signs out when renewal is refused too, and says the session ended', async () => {
    const device = new DeviceStorage();
    device.session = stored('at1', 'rt1');
    const { auth, db } = signedIn(device);
    server((url) =>
      url.endsWith('/refresh') ? { status: 401, body: { code: 'invalid_refresh_token', error: 'x' } } : { status: 401, body: { error: 'unauthorized' } });
    await expect(db.query('events', { limit: 10 } as never)).rejects.toBeInstanceOf(KoolbaseUnauthenticatedError);
    expect(auth.currentUser).toBeNull();
    expect(auth.lastSignOutReason).toBe('session_ended');
    expect(device.session).toBeNull();
  });

  it('keeps the session when renewal finds no network', async () => {
    const device = new DeviceStorage();
    device.session = stored('at1', 'rt1', earlier());
    const { auth, db } = signedIn(device);
    server(() => 'offline');
    await expect(db.query('events', { limit: 10 } as never)).rejects.toBeInstanceOf(TypeError);
    expect(auth.currentUser?.id).toBe('u1');
    expect(device.session).not.toBeNull();
  });
});

describe('two tabs renewing at the same moment (#96)', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
    setSessionRenewal(null);
  });

  it('share the winner\'s session instead of both signing out', async () => {
    // One browser profile: both tabs read and write the same stored session.
    const device = new DeviceStorage();
    device.session = stored('at1', 'rt1', earlier());
    const a = new KoolbaseAuth(config(device));
    const b = new KoolbaseAuth(config(device));
    await a.setSession(device.session);
    await b.setSession(device.session);

    // The server renews rt1 once; the second use is refused.
    let spent = false;
    server((url, init) => {
      if (!url.endsWith('/refresh')) return { status: 500 };
      const rt = JSON.parse(String(init.body)).refresh_token;
      if (rt === 'rt1' && !spent) { spent = true; return { status: 200, body: wire('at2', 'rt2') }; }
      if (rt === 'rt2') return { status: 200, body: wire('at3', 'rt3') };
      return { status: 401, body: { code: 'invalid_refresh_token', error: 'x' } };
    });
    // Tab B sent rt1 just before A's renewal landed in storage.
    const bRefresh = (b as unknown as { authRequest: (p: string, o: unknown) => Promise<Response> });
    const original = bRefresh.authRequest.bind(b);
    let first = true;
    bRefresh.authRequest = async (p, o) => {
      if (p.endsWith('/refresh') && first) {
        first = false;
        await a.refresh();
      }
      return original(p, o);
    };
    const sessionB = await b.refresh('rt1');
    expect(sessionB.accessToken).toBe('at2');
    expect(b.currentUser?.id).toBe('u1');
    expect(a.currentUser?.id).toBe('u1');
    expect(device.session?.refreshToken).toBe('rt2');
  });
});
