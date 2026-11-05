import { Koolbase } from '../../js/src/index';

// R138: a device registers with the signed-in person's session (the API
// takes the owner from it, never the body); a browser registers as web;
// signing in or out registers the last token again. Through
// Koolbase.initializeForTesting, so the server the test gives sees it.

const user = { id: 'usr_t', project_id: 'prj_t', email: 'ama@example.com', full_name: 'Ama Mensah', verified: true, disabled: false, providers: [], created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' };
const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const registered: { auth: string | null; body: Record<string, unknown> }[] = [];
const server = async (url: string, init?: RequestInit): Promise<Response> => {
  const path = new URL(url).pathname;
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method === 'POST' && path === '/v1/messaging/register') {
    const h = new Headers(init?.headers);
    registered.push({ auth: h.get('authorization'), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return json(200, { registered: true });
  }
  if (method === 'POST' && path === '/v1/sdk/auth/login') return json(200, { access_token: 'at_1', refresh_token: 'rt_1', expires_at: '2099-01-01T00:00:00Z', user });
  if (path === '/v1/sdk/auth/me') return json(200, user);
  if (path === '/v1/sdk/auth/logout') return new Response(null, { status: 204 });
  return json(404, { error: 'not found', code: 'not_found' });
};

beforeEach(async () => {
  registered.length = 0;
  global.fetch = jest.fn(async () => { throw new Error('the global fetch was used'); }) as never;
  await Koolbase.initializeForTesting({ fetch: server as never });
});
afterEach(() => Koolbase.resetForTesting());

it('signed out: an ownerless device; a browser registers as web', async () => {
  expect(await Koolbase.messaging.registerToken({ token: 'fcm-w', platform: 'web' })).toBe(true);
  expect(registered).toHaveLength(1);
  expect(registered[0].auth).toBeNull();
  expect(registered[0].body).toEqual({ device_id: expect.any(String), token: 'fcm-w', platform: 'web' });
});

it('anything but android, ios or web is refused before sending', async () => {
  expect(await Koolbase.messaging.registerToken({ token: 'fcm-x', platform: 'windows' as never })).toBe(false);
  expect(registered).toHaveLength(0);
});

it('signing in registers the last token again with the session; signing out, without', async () => {
  await Koolbase.messaging.registerToken({ token: 'fcm-1', platform: 'android' });
  await Koolbase.auth.login({ email: 'ama@example.com', password: 'secret' });
  for (let i = 0; i < 20 && registered.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
  expect(registered).toHaveLength(2);
  expect(registered[1].auth).toBe('Bearer at_1');
  expect(registered[1].body.token).toBe('fcm-1');
  await Koolbase.auth.logout();
  for (let i = 0; i < 20 && registered.length < 3; i++) await new Promise((r) => setTimeout(r, 5));
  expect(registered).toHaveLength(3);
  expect(registered[2].auth).toBeNull();
});

it('signed in when it registers: the session goes with it', async () => {
  await Koolbase.auth.login({ email: 'ama@example.com', password: 'secret' });
  await Koolbase.messaging.registerToken({ token: 'fcm-2', platform: 'ios', userId: 'ignored' });
  const last = registered[registered.length - 1];
  expect(last.auth).toBe('Bearer at_1');
  expect(last.body).not.toHaveProperty('user_id');
});
