import {
  KoolbaseFiscal,
  KoolbaseFiscalError,
  decodeFiscalResponse,
  isFiscalized,
  isPending,
} from '../src/fiscal';
import { KoolbaseUnauthenticatedError } from '../src/errors';

// Fiscal — submitting sales to a tax authority.
//
// Ported from koolbase_flutter on 20 September 2026. The endpoints and the
// Flutter client had existed for months; there was no fiscal module in the
// TypeScript SDKs at all, so a web or React Native POS could not submit to
// GRA while the same business building in Flutter could. Found by a
// capability inventory, not by anyone noticing.
//
// The port carries SEMANTICS, not just shapes, and these tests pin the parts
// that would be easy to lose.

const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as never;

function client(overrides?: { onSessionExpired?: () => Promise<void> }) {
  return new KoolbaseFiscal(
    config,
    async () => 'access-token',
    overrides?.onSessionExpired
  );
}

function respond(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }) as never;
}

describe('fiscal', () => {
  it('submit sends the wire shape the server expects', async () => {
    respond(202, { intent_id: 'i1', status: 'queued' });

    await client().submit({
      deviceId: 'dev-1',
      clientRef: 'sale-42',
      payload: { total: 100 },
    });

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.test/v1/sdk/fiscal/submit');
    expect(JSON.parse(init.body)).toEqual({
      device_id: 'dev-1',
      client_ref: 'sale-42',
      payload: { total: 100 },
    });
  });

  it('202 is success, not failure', async () => {
    // The authority answers asynchronously: a sale is durably recorded the
    // moment submit returns, and fiscalization follows. Treating 202 as an
    // error would fail every sale that was actually accepted.
    respond(202, { intent_id: 'i1', status: 'queued' });
    const r = await client().submit({ deviceId: 'd', clientRef: 'c', payload: {} });
    expect(r.status).toBe('queued');
    expect(isPending(r)).toBe(true);
    expect(isFiscalized(r)).toBe(false);
  });

  it('status reads by the reference the sale was submitted under', async () => {
    respond(200, {
      intent_id: 'i1',
      status: 'fiscalized',
      certification: { ysdcrecnum: '123', qr_code: 'https://gra.test/v/123' },
    });

    const r = await client().status({ deviceId: 'dev-1', clientRef: 'sale-42' });

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('device_id=dev-1');
    expect(url).toContain('client_ref=sale-42');
    expect(isFiscalized(r)).toBe(true);
    // Jurisdiction-neutral: the SDK passes the authority's fields through
    // without naming them. Nothing here knows what ysdcrecnum is.
    expect(r.certification?.ysdcrecnum).toBe('123');
  });

  it('an unknown status parses as unknown rather than throwing', async () => {
    // Forward compatibility: a server that grows a state must not break
    // clients that predate it.
    respond(200, { intent_id: 'i1', status: 'something_new' });
    const r = await client().status({ deviceId: 'd', clientRef: 'c' });
    expect(r.status).toBe('unknown');
  });

  it('blocked carries its reason', async () => {
    // Blocked means a precondition failed BEFORE any fiscal number was
    // consumed, so resubmitting the same clientRef resumes it. Distinct from
    // attention, where the authority rejected a sealed document and an
    // operator has to resolve it.
    respond(200, {
      intent_id: 'i1',
      status: 'blocked',
      blocked_reason: 'device credential not enrolled',
    });
    const r = await client().status({ deviceId: 'd', clientRef: 'c' });
    expect(r.status).toBe('blocked');
    expect(r.blockedReason).toBe('device credential not enrolled');
    expect(isPending(r)).toBe(false);
  });

  it('401 fires the session hook and throws unauthenticated', async () => {
    const expired = jest.fn().mockResolvedValue(undefined);
    respond(401, { error: 'nope' });

    await expect(
      client({ onSessionExpired: expired }).submit({
        deviceId: 'd',
        clientRef: 'c',
        payload: {},
      })
    ).rejects.toBeInstanceOf(KoolbaseUnauthenticatedError);

    expect(expired).toHaveBeenCalled();
  });

  it('a non-2xx carries the server message and status', async () => {
    respond(422, { error: 'payload missing required field' });
    await expect(
      client().submit({ deviceId: 'd', clientRef: 'c', payload: {} })
    ).rejects.toMatchObject({
      message: 'payload missing required field',
      statusCode: 422,
    });
  });

  it('an unreadable body is an error naming the status', async () => {
    await expect(decodeFiscalResponse(500, '<html>gateway</html>'))
      .rejects.toBeInstanceOf(KoolbaseFiscalError);
  });

  it('a submit timeout says poll rather than resubmit', async () => {
    // The most consequential message in this module. A timed-out submit may
    // have fiscalized anyway — the request reached the server and the reply
    // was lost. Resubmitting blindly risks a duplicate sale; polling the
    // same clientRef is idempotent and tells you what happened.
    global.fetch = jest.fn().mockImplementation(() => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      return Promise.reject(e);
    }) as never;

    await expect(
      client().submit({ deviceId: 'd', clientRef: 'c', payload: {}, timeoutMs: 5 })
    ).rejects.toThrow(/poll status with the same clientRef/);
  });
});
