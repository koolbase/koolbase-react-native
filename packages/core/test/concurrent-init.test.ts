import { Koolbase } from '../../js/src/index';
import { memoryPlatform } from '../src/platform';

// React strict mode calls effects twice, and so does any app that
// initializes from two components. The guard used to be a boolean checked
// before the first await and set after the last, so two overlapping calls
// both passed it and both built a whole SDK — two analytics flush timers,
// two sync engines over one queue, one of each orphaned.
//
// Comparing Koolbase.auth between callers does NOT catch this: it is a
// getter over a module-level field, so after two full runs both callers
// see the second instance and the first is invisible. Counting a side
// effect does. getOrCreateDeviceId misses its memo and writes once per
// initialize, so one write means one initialize.

describe('concurrent initialize', () => {
  it('runs the body once when called twice at once', async () => {
    const base = memoryPlatform();
    let deviceIdWrites = 0;
    const counting = {
      ...base,
      storage: {
        ...base.storage,
        setItem: async (k: string, v: string) => {
          if (k.includes('device')) deviceIdWrites++;
          return base.storage.setItem(k, v);
        },
      },
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => '', json: async () => ({}),
    }) as never;

    const config = {
      baseUrl: 'https://api.test',
      publicKey: 'pk',
      platform: counting,
    } as never;
    await Promise.all([
      Koolbase.initialize(config),
      Koolbase.initialize(config),
    ]);

    expect(deviceIdWrites).toBe(1);
  });
});
