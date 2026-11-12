import { KoolbaseFlags } from '../src/flags';

// onRemoteChange (G7): a screen reading flags or config is told when a
// bootstrap brings them, so it draws again once they arrive.
describe('KoolbaseFlags.subscribe', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  function answering(body: unknown, status = 200) {
    global.fetch = jest.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  }

  const payload = {
    payload_version: '1', project_id: 'p1',
    flags: { new_menu: { enabled: true, rollout_percentage: 100, kill_switch: false } },
    config: { announcement: 'Closed on Friday' }, version: {},
  };

  it('tells each listener once per bootstrap, after the values are there', async () => {
    const f = new KoolbaseFlags({ publicKey: 'pk_test', baseUrl: 'https://api.test' } as never, 'device-1');
    const seen: string[] = [];
    f.subscribe(() => seen.push(`a:${f.getString('announcement')}:${f.isEnabled('new_menu')}`));
    f.subscribe(() => seen.push('b'));
    expect(f.getString('announcement', 'none')).toBe('none');
    answering(payload);
    await f.koolbaseFetch('1.0.0', 'web');
    expect(seen).toEqual(['a:Closed on Friday:true', 'b']);
    await f.refresh();
    expect(seen.length).toBe(4);
  });

  it('stops telling one that unsubscribed, and a throwing listener stops nobody', async () => {
    const f = new KoolbaseFlags({ publicKey: 'pk_test', baseUrl: 'https://api.test' } as never, 'device-1');
    const seen: string[] = [];
    const stop = f.subscribe(() => seen.push('gone'));
    f.subscribe(() => { throw new Error('mine'); });
    f.subscribe(() => seen.push('kept'));
    stop();
    answering(payload);
    await f.koolbaseFetch('1.0.0', 'web');
    expect(seen).toEqual(['kept']);
  });

  it('a failed bootstrap tells nobody and keeps what was there', async () => {
    const f = new KoolbaseFlags({ publicKey: 'pk_test', baseUrl: 'https://api.test' } as never, 'device-1');
    const seen: string[] = [];
    f.subscribe(() => seen.push('told'));
    answering({ error: 'down' }, 503);
    await f.koolbaseFetch('1.0.0', 'web');
    expect(seen).toEqual([]);
    expect(f.getString('announcement', 'fallback')).toBe('fallback');
  });
});
