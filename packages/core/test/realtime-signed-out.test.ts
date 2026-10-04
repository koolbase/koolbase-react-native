import { KoolbaseRealtime } from '../src/realtime';
import { setLiveSource } from '../src/live-source';

/** A stand-in for the browser's WebSocket: records what is sent; opens on demand. */
class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static all: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
}

const token = `h.${Buffer.from(JSON.stringify({ project_id: 'p1' })).toString('base64')}.s`;
const config = { baseUrl: 'https://api.test', publicKey: 'pk_test' } as any;
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('realtime signed out, and across sign-in / sign-out', () => {
  const realWebSocket = (global as any).WebSocket;
  let user: string | null;
  let tok: string | null;
  const rtFor = () => new KoolbaseRealtime(config, async () => tok, () => user);

  beforeEach(() => {
    FakeSocket.all = [];
    (global as any).WebSocket = FakeSocket;
    user = null;
    tok = null;
  });
  afterEach(() => {
    (global as any).WebSocket = realWebSocket;
    setLiveSource(null);
  });

  it('signed out: connects with the public key, and subscribes without a project id', async () => {
    const rt = rtFor();
    const off = rt.subscribe('songs', () => {});
    await settle();
    expect(FakeSocket.all).toHaveLength(1);
    const s = FakeSocket.all[0];
    expect(s.url).toBe('wss://api.test/v1/realtime/ws?public_key=pk_test');
    s.open();
    expect(s.sent).toEqual([{ action: 'subscribe', collection: 'songs' }]);
    off();
    expect(s.sent[1]).toEqual({ action: 'unsubscribe', collection: 'songs' });
    rt.disconnect();
  });

  it('signed out: events still reach the subscriber', async () => {
    const rt = rtFor();
    const seen: unknown[] = [];
    rt.subscribe('songs', (e) => seen.push(e));
    await settle();
    const s = FakeSocket.all[0];
    s.open();
    s.onmessage?.({ data: JSON.stringify({ type: 'db.record.deleted', payload: { collection: 'songs', record_id: 'r1' } }) });
    expect(seen).toEqual([{ type: 'deleted', collection: 'songs', recordId: 'r1' }]);
    rt.disconnect();
  });

  it('signed in with no usable token: opens nothing (tries again later), never public-only', async () => {
    user = 'u1';
    const rt = rtFor();
    rt.subscribe('songs', () => {});
    await settle();
    expect(FakeSocket.all).toHaveLength(0);
    rt.disconnect();
  });

  it('a token that throws: opens nothing, never public-only', async () => {
    const rt = new KoolbaseRealtime(config, async () => { throw new Error('refresh failed'); }, () => null);
    rt.subscribe('songs', () => {});
    await settle();
    expect(FakeSocket.all).toHaveLength(0);
    rt.disconnect();
  });

  it('sign-in replaces the signed-out connection and resubscribes everything', async () => {
    const rt = rtFor();
    rt.subscribe('songs', () => {});
    rt.subscribe('albums', () => {});
    await settle();
    const anon = FakeSocket.all[0];
    anon.open();

    user = 'u1';
    tok = token;
    rt.sessionChanged();
    expect(anon.closed).toBe(true);
    await settle();
    expect(FakeSocket.all).toHaveLength(2);
    const signedIn = FakeSocket.all[1];
    expect(signedIn.url).toBe(`wss://api.test/v1/realtime/ws?token=${encodeURIComponent(token)}`);
    signedIn.open();
    expect(signedIn.sent).toEqual([
      { action: 'subscribe', project_id: 'p1', collection: 'songs' },
      { action: 'subscribe', project_id: 'p1', collection: 'albums' },
    ]);
    rt.disconnect();
  });

  it('sign-out replaces the signed-in connection with a public-key one', async () => {
    user = 'u1';
    tok = token;
    const rt = rtFor();
    rt.subscribe('songs', () => {});
    await settle();
    const signedIn = FakeSocket.all[0];
    signedIn.open();

    user = null;
    tok = null;
    rt.sessionChanged();
    expect(signedIn.closed).toBe(true);
    await settle();
    const anon = FakeSocket.all[1];
    expect(anon.url).toBe('wss://api.test/v1/realtime/ws?public_key=pk_test');
    anon.open();
    expect(anon.sent).toEqual([{ action: 'subscribe', collection: 'songs' }]);
    rt.disconnect();
  });

  it('the same user again (a token refresh) keeps the connection', async () => {
    user = 'u1';
    tok = token;
    const rt = rtFor();
    rt.subscribe('songs', () => {});
    await settle();
    const s = FakeSocket.all[0];
    s.open();
    rt.sessionChanged();
    await settle();
    expect(FakeSocket.all).toHaveLength(1);
    expect(s.closed).toBe(false);
    rt.disconnect();
  });

  it('still signed out keeps the signed-out connection', async () => {
    const rt = rtFor();
    rt.subscribe('songs', () => {});
    await settle();
    FakeSocket.all[0].open();
    rt.sessionChanged();
    await settle();
    expect(FakeSocket.all).toHaveLength(1);
    rt.disconnect();
  });

  it('with nothing open, a session change opens nothing', async () => {
    const rt = rtFor();
    user = 'u1';
    tok = token;
    rt.sessionChanged();
    await settle();
    expect(FakeSocket.all).toHaveLength(0);
    rt.disconnect();
  });

  it('a session change while the token is on its way: one connection, for the new session', async () => {
    let give!: (t: string | null) => void;
    let calls = 0;
    const rt = new KoolbaseRealtime(config, () => {
      calls += 1;
      if (calls === 1) return new Promise<string | null>((resolve) => { give = resolve; });
      return Promise.resolve(token);
    }, () => user);
    rt.subscribe('songs', () => {});
    user = 'u1';
    rt.sessionChanged();
    await settle();
    give(null); // the old, signed-out answer arrives late
    await settle();
    expect(FakeSocket.all).toHaveLength(1);
    expect(FakeSocket.all[0].url).toContain('?token=');
    rt.disconnect();
  });
});
