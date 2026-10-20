import { koolbaseFetch, sessionFetch, setSessionRenewal } from '../src/network';

// #169: a failed request leaves one line in a development build -- method,
// path, status, reason -- and never the key, a token, the query or the body.
describe('a failed request', () => {
  const key = 'pk_live_doNotPrintMe0123456789';
  const token = 'eyJhbGciOiJIUzI1NiJ9.secret.token';
  const refusal = JSON.stringify({ code: 'invalid_public_key', error: "This app's Koolbase key isn't valid for this project." });
  let warn: jest.SpyInstance;
  const realFetch = global.fetch;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    global.fetch = realFetch;
    setSessionRenewal(null);
  });

  const init = (): RequestInit => ({
    method: 'POST',
    headers: { 'x-api-key': key, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ email: 'person@example.com' }),
  });

  it('prints its method, path, status and reason, and nothing else', async () => {
    global.fetch = jest.fn(async () => new Response(refusal, { status: 401 })) as typeof fetch;
    const res = await koolbaseFetch('https://api.koolbase.com/v1/sdk/auth/email/code?email=person%40example.com', init());
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line.startsWith('[Koolbase] POST /v1/sdk/auth/email/code -> 401 invalid_public_key: ')).toBe(true);
    for (const secret of [key, token, 'person', 'example.com', 'api.koolbase.com', '?']) {
      expect(line).not.toContain(secret);
    }
    // The caller still reads the whole answer.
    expect(await res.text()).toBe(refusal);
  });

  it('prints nothing for a success', async () => {
    global.fetch = jest.fn(async () => new Response('{}', { status: 200 })) as typeof fetch;
    await koolbaseFetch('https://api.koolbase.com/v1/sdk/x', init());
    expect(warn).not.toHaveBeenCalled();
  });

  it('prints nothing for a 401 that renewal answers', async () => {
    let n = 0;
    global.fetch = jest.fn(async () => (n++ === 0 ? new Response('{"code":"token_expired"}', { status: 401 }) : new Response('{}', { status: 200 }))) as typeof fetch;
    setSessionRenewal(async () => 'fresh-token');
    const res = await sessionFetch('https://api.koolbase.com/v1/sdk/records', init());
    expect(res.status).toBe(200);
    expect(warn).not.toHaveBeenCalled();
  });

  it('prints the 401 the caller receives when renewal cannot help', async () => {
    global.fetch = jest.fn(async () => new Response('{"code":"invalid_refresh_token"}', { status: 401 })) as typeof fetch;
    setSessionRenewal(async () => null);
    await sessionFetch('https://api.koolbase.com/v1/sdk/records', init());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toBe('[Koolbase] POST /v1/sdk/records -> 401 invalid_refresh_token');
  });
});
