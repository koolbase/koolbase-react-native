import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Koolbase } from '../../js/src/index';

// R49: Koolbase.initializeForTesting runs the real SDK against the server a
// test gives it. Every request must reach that server: the global fetch
// throws, so anything that bypasses it fails here.

const user = { id: 'usr_t', project_id: 'prj_t', email: 'ama@example.com', full_name: 'Ama Mensah', verified: true, disabled: false, providers: [], created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' };
const session = (n: number) => ({ access_token: `at_${n}`, refresh_token: `rt_${n}`, expires_at: '2099-01-01T00:00:00Z', user });

let expired = false;
const calls: string[] = [];
const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const server = async (url: string, init?: RequestInit): Promise<Response> => {
  const path = new URL(url).pathname;
  const method = (init?.method ?? 'GET').toUpperCase();
  calls.push(`${method} ${path}`);
  if (method === 'POST' && path === '/v1/sdk/auth/login') return json(200, session(1));
  if (path === '/v1/sdk/auth/refresh') return expired ? json(401, { error: 'invalid or expired refresh token', code: 'invalid_refresh_token' }) : json(200, session(2));
  if (path === '/v1/sdk/auth/me') return expired ? json(401, { error: 'authentication required', code: 'unauthenticated' }) : json(200, user);
  if (path === '/v1/sdk/auth/logout') return new Response(null, { status: 204 });
  return json(404, { error: 'not found', code: 'not_found' });
};

beforeEach(() => {
  expired = false;
  calls.length = 0;
  global.fetch = jest.fn(async () => { throw new Error('the global fetch was used: a request bypassed the server the test gave'); }) as never;
});
afterEach(() => Koolbase.resetForTesting());

describe('initializeForTesting (R49)', () => {
  it('signs in against the server it is given, and signs out', async () => {
    await Koolbase.initializeForTesting({ fetch: server });
    await Koolbase.auth.login({ email: 'ama@example.com', password: 'secret' } as never);
    expect(Koolbase.auth.currentUser?.email).toBe('ama@example.com');
    expect(calls).toContain('POST /v1/sdk/auth/login');
    await Koolbase.auth.logout();
    expect(Koolbase.auth.currentUser).toBeNull();
    expect(calls).toContain('POST /v1/sdk/auth/logout');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('a renewal the server refuses ends the session, as session_ended', async () => {
    await Koolbase.initializeForTesting({ fetch: server });
    await Koolbase.auth.login({ email: 'ama@example.com', password: 'secret' } as never);
    expired = true;
    await expect(Koolbase.auth.refresh()).rejects.toBeTruthy();
    expect(Koolbase.auth.currentUser).toBeNull();
    expect(Koolbase.auth.lastSignOutReason).toBe('session_ended');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('after a reset, the next one starts from nothing', async () => {
    await Koolbase.initializeForTesting({ fetch: server });
    await Koolbase.auth.login({ email: 'ama@example.com', password: 'secret' } as never);
    Koolbase.resetForTesting();
    expect(() => Koolbase.auth).toThrow();
    await Koolbase.initializeForTesting({ fetch: server });
    expect(Koolbase.auth.currentUser).toBeNull();
  });
});

describe('the two platform packages, the same test mode', () => {
  // React Native's package cannot load under node; its test mode must be
  // the web package's, word for word, so what runs here is what it runs.
  const block = (pkg: string) => {
    const s = readFileSync(join(__dirname, '..', '..', pkg, 'src', 'index.ts'), 'utf8');
    const a = s.indexOf('  async initializeForTesting(');
    const b = s.indexOf('  get auth(): KoolbaseAuth');
    return s.slice(a, b).replace('    _messaging = null;\n', '');
  };
  it('initializeForTesting and resetForTesting are identical', () => {
    expect(block('react-native')).toBe(block('js'));
    expect(block('js')).toContain('await Koolbase.initialize({');
  });
  it('both install config.fetch for every request', () => {
    for (const pkg of ['js', 'react-native']) {
      expect(readFileSync(join(__dirname, '..', '..', pkg, 'src', 'index.ts'), 'utf8')).toContain('setFetch(config.fetch ?? null);');
    }
  });
});
