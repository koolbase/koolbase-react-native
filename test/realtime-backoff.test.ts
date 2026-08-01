import { KoolbaseRealtime } from '../src/realtime';

/**
 * Reconnect was a fixed three seconds, forever, with no ceiling. Fine while a
 * connection is merely interrupted and costly when it is not: a device with no
 * network, a wrong URL, or a session the server will not accept retried
 * indefinitely, draining battery and data the user cannot see or stop.
 */
describe('reconnect backoff', () => {
  const delays: number[] = [];

  beforeEach(() => {
    delays.length = 0;
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: any, ms?: number) => {
      delays.push(ms ?? 0);
      return 0 as unknown as NodeJS.Timeout;
    }) as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('doubles, and stops at a minute', () => {
    const rt = new KoolbaseRealtime(
      { baseUrl: 'https://api.test', publicKey: 'pk' } as any,
      async () => 'token'
    );
    // A listener is required, or reconnect is skipped entirely.
    (rt as any).listeners.set('things', [() => {}]);

    for (let i = 0; i < 8; i++) {
      (rt as any).reconnectTimer = null;
      (rt as any).scheduleReconnect();
    }

    expect(delays.slice(0, 5)).toEqual([3000, 6000, 12000, 24000, 48000]);
    expect(delays.every((d) => d <= 60000)).toBe(true);
    expect(delays[delays.length - 1]).toBe(60000);
  });

  it('does not schedule anything with no listeners', () => {
    const rt = new KoolbaseRealtime(
      { baseUrl: 'https://api.test', publicKey: 'pk' } as any,
      async () => 'token'
    );
    (rt as any).scheduleReconnect();
    expect(delays).toHaveLength(0);
  });
});
