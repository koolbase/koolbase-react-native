import { KoolbaseFlags } from '../src/flags';

const config = { publicKey: 'pk_test', baseUrl: 'https://api.example.test' } as never;

// The version policy exactly as the API sends it (bootstrap "version", Nov
// 2026): the app's own platform's policy, with store_url when one is set.
function withVersion(version: Record<string, unknown>): KoolbaseFlags {
  const f = new KoolbaseFlags(config, 'dev-1');
  (f as unknown as { payload: unknown }).payload = { payload_version: '1', flags: {}, config: {}, version };
  return f;
}

describe('checkVersion: the store link', () => {
  const store = 'https://apps.apple.com/app/id123';

  it('a forced update carries the store link', () => {
    const f = withVersion({ min_version: '2.0.0', latest_version: '2.1.0', force_update: false, update_message: 'Update', store_url: store });
    expect(f.checkVersion('1.9.0')).toEqual({ status: 'force_update', message: 'Update', latestVersion: '2.1.0', storeUrl: store });
  });

  it('a suggested update carries it too', () => {
    const f = withVersion({ min_version: '1.0.0', latest_version: '2.1.0', force_update: false, update_message: 'New', store_url: store });
    expect(f.checkVersion('2.0.0')).toEqual({ status: 'soft_update', message: 'New', latestVersion: '2.1.0', storeUrl: store });
  });

  it('no store link set: none in the result', () => {
    const f = withVersion({ min_version: '2.0.0', latest_version: '2.0.0', force_update: false, update_message: 'Update' });
    expect(f.checkVersion('1.0.0')).not.toHaveProperty('storeUrl');
  });

  it('up to date: no store link', () => {
    const f = withVersion({ min_version: '1.0.0', latest_version: '2.0.0', force_update: false, update_message: '', store_url: store });
    expect(f.checkVersion('2.0.0')).not.toHaveProperty('storeUrl');
  });

  it('an empty policy (a web app): up to date', () => {
    const f = withVersion({ latest_version: '', min_version: '', force_update: false, update_message: '' });
    expect(f.checkVersion('0.0.0').status).toBe('up_to_date');
  });
});
