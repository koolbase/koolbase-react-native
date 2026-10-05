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
  sent: { action: string; collection: string }[] = [];
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
  actions(action: string) {
    return this.sent.filter((m) => m.action === action).map((m) => m.collection);
  }
}

const token = `h.${Buffer.from(JSON.stringify({ project_id: 'p1' })).toString('base64')}.s`;
const config = { baseUrl: 'https://api.test', publicKey: 'pk_test' } as any;
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const GRACE = 40;

describe('realtime connection', () => {
  const realWebSocket = (global as any).WebSocket;
  beforeEach(() => {
    FakeSocket.all = [];
    (global as any).WebSocket = FakeSocket;
    KoolbaseRealtime.idleGraceMs = GRACE;
  });
  afterEach(() => {
    (global as any).WebSocket = realWebSocket;
    KoolbaseRealtime.idleGraceMs = 1000;
    setLiveSource(null);
  });

  it('opens one connection for every subscription made while the token is on its way', async () => {
    const rt = new KoolbaseRealtime(config, async () => token);
    rt.subscribe('songs', () => {});
    rt.subscribe('songs', () => {});
    rt.subscribe('albums', () => {});
    rt.subscribe('songs', () => {});
    await settle();
    expect(FakeSocket.all).toHaveLength(1);
    FakeSocket.all[0].open();
    expect(FakeSocket.all[0].actions('subscribe').sort()).toEqual(['albums', 'songs']);
    rt.disconnect();
  });

  it('unsubscribes a collection only when its last subscriber leaves; a second unsubscribe does nothing', async () => {
    const rt = new KoolbaseRealtime(config, async () => token);
    const a = rt.subscribe('songs', () => {});
    const b = rt.subscribe('songs', () => {});
    await settle();
    const s = FakeSocket.all[0];
    s.open();
    a();
    expect(s.actions('unsubscribe')).toEqual([]);
    b();
    b();
    expect(s.actions('unsubscribe')).toEqual(['songs']);
    rt.disconnect();
  });

  it('closes the connection a moment after the last subscriber leaves, and does not reconnect', async () => {
    const rt = new KoolbaseRealtime(config, async () => token);
    const off = rt.subscribe('songs', () => {});
    await settle();
    const s = FakeSocket.all[0];
    s.open();
    off();
    expect(s.closed).toBe(false);
    await sleep(GRACE * 3);
    expect(s.closed).toBe(true);
    await sleep(GRACE * 3);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('a subscriber back within the moment keeps the same connection', async () => {
    const rt = new KoolbaseRealtime(config, async () => token);
    const off = rt.subscribe('songs', () => {});
    await settle();
    const s = FakeSocket.all[0];
    s.open();
    off();
    rt.subscribe('songs', () => {});
    await sleep(GRACE * 3);
    expect(FakeSocket.all).toHaveLength(1);
    expect(s.closed).toBe(false);
    rt.disconnect();
  });

  it('after the close, a new subscriber opens a fresh connection at once', async () => {
    const rt = new KoolbaseRealtime(config, async () => token);
    const off = rt.subscribe('songs', () => {});
    await settle();
    FakeSocket.all[0].open();
    off();
    await sleep(GRACE * 3);
    rt.subscribe('songs', () => {});
    await settle();
    expect(FakeSocket.all).toHaveLength(2);
    expect(FakeSocket.all[1].closed).toBe(false);
    rt.disconnect();
  });

  it('opens nothing when everyone left before the token arrived', async () => {
    let give!: (t: string | null) => void;
    const rt = new KoolbaseRealtime(config, () => new Promise<string | null>((resolve) => { give = resolve; }));
    const off = rt.subscribe('songs', () => {});
    off();
    give(token);
    await settle();
    expect(FakeSocket.all).toHaveLength(0);
    rt.disconnect();
  });

  it('a token that fails does not leave the client stuck', async () => {
    let calls = 0;
    const rt = new KoolbaseRealtime(config, async () => {
      calls += 1;
      if (calls === 1) throw new Error('refresh failed');
      return token;
    });
    rt.subscribe('songs', () => {});
    await settle();
    expect(FakeSocket.all).toHaveLength(0);
    // Stuck "connecting", this subscribe would open nothing.
    rt.subscribe('albums', () => {});
    await settle();
    expect(FakeSocket.all).toHaveLength(1);
    rt.disconnect();
  });
});
