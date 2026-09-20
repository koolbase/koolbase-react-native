import { KoolbaseAuth } from '../src/auth';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

// The account's own security log — sign-ins, failures, lockouts, password
// changes — for a "recent activity" screen.
//
// The endpoint existed and no SDK exposed it. The server sanitizes each
// event against a per-type field allowlist, so a lockout can name the
// attempted address while a successful login carries nothing extra; the SDK
// passes through whatever survived that filter rather than deciding again.

const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as never;
const user = { id: 'u1', email: 'a@b.test', verified: true };
const session = { access_token: 'at', refresh_token: 'rt', expires_at: '2026-12-01T00:00:00Z', user };

function respond(body: unknown, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as never;
}

async function signedIn(): Promise<KoolbaseAuth> {
  respond(session);
  const auth = new KoolbaseAuth(config);
  await auth.login({ email: 'a@b.test', password: 'password123' });
  return auth;
}

describe('audit log', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('maps the server shape and keeps the page counts', async () => {
    const auth = await signedIn();
    respond({
      events: [
        {
          id: 'e1',
          event_type: 'auth.account.locked',
          occurred_at: '2026-09-19T22:00:00Z',
          ip: '1.2.3.4',
          user_agent: 'Chrome',
          event_data: { lock_level: 'account', attempted_email: 'a@b.test' },
        },
      ],
      total: 41,
      limit: 50,
      offset: 0,
    });

    const page = await auth.auditLog();
    expect(page.events[0].eventType).toBe('auth.account.locked');
    expect(page.events[0].occurredAt).toBe('2026-09-19T22:00:00Z');
    expect(page.events[0].eventData.attempted_email).toBe('a@b.test');
    // total is across all pages: an app needs it to offer "show more".
    expect(page.total).toBe(41);
  });

  it('an event with no data is an empty object, not undefined', async () => {
    // auth.login.success carries nothing. A caller reading eventData.x
    // should get undefined, not a crash on undefined.x.
    const auth = await signedIn();
    respond({
      events: [
        {
          id: 'e2',
          event_type: 'auth.login.success',
          occurred_at: '2026-09-19T22:00:00Z',
          event_data: null,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    const page = await auth.auditLog();
    expect(page.events[0].eventData).toEqual({});
    expect(page.events[0].ip).toBeUndefined();
  });

  it('passes limit and offset as query parameters', async () => {
    const auth = await signedIn();
    respond({ events: [], total: 0, limit: 10, offset: 20 });
    await auth.auditLog({ limit: 10, offset: 20 });

    const calls = (global.fetch as jest.Mock).mock.calls;
    const url = String(calls[calls.length - 1][0]);
    expect(url).toContain('limit=10');
    expect(url).toContain('offset=20');
  });

  it('sends no query string when nothing was asked for', async () => {
    const auth = await signedIn();
    respond({ events: [], total: 0, limit: 50, offset: 0 });
    await auth.auditLog();

    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(String(calls[calls.length - 1][0])).toMatch(/\/audit$/);
  });

  it('an empty log is an empty page, not a throw', async () => {
    const auth = await signedIn();
    respond({ total: 0, limit: 50, offset: 0 });
    await expect(auth.auditLog()).resolves.toMatchObject({ events: [], total: 0 });
  });
});
