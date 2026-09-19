import { KoolbaseAnalytics } from '../src/analytics';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

// Who an event says it came from.
//
// identify() existed and nothing errored when an app never called it, so
// every event landed with user_id null — retention, funnels and per-user
// analysis quietly worthless. Found in a real project as 53 events, 8
// registered users, and not one event carrying a user id. Flutter fixed it
// in 11.2.0; the TypeScript SDKs carried the bug until 19 Sep, because
// nothing here tested what an event actually contains.

const config = { baseUrl: 'https://api.test', publicKey: 'pk' } as never;

/** Capture what the analytics client posts, without a network. */
function captureFlush() {
  const sent: Array<Record<string, unknown>> = [];
  global.fetch = jest.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { events: Array<Record<string, unknown>> };
    sent.push(...body.events);
    return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
  }) as never;
  return sent;
}

describe('analytics identity', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('carries the signed-in user without the app calling identify', async () => {
    const sent = captureFlush();
    const analytics = new KoolbaseAnalytics(config, () => 'user-123');
    await analytics.init('1.0.0');

    analytics.track('purchase', { value: 10 });
    await analytics.flush();

    const purchase = sent.find((e) => e.event_name === 'purchase');
    expect(purchase).toBeDefined();
    expect(purchase!.user_id).toBe('user-123');
  });

  it('sends no user when nobody is signed in', async () => {
    const sent = captureFlush();
    const analytics = new KoolbaseAnalytics(config, () => null);
    await analytics.init('1.0.0');

    analytics.track('app_open');
    await analytics.flush();

    const open = sent.find((e) => e.event_name === 'app_open');
    expect(open).toBeDefined();
    expect(open!.user_id).toBeUndefined();
  });

  it('identify overrides the signed-in user', async () => {
    // An app with its own identity system says who the user is, and that
    // wins over the Koolbase session.
    const sent = captureFlush();
    const analytics = new KoolbaseAnalytics(config, () => 'koolbase-user');
    await analytics.init('1.0.0');

    analytics.identify('external-user');
    analytics.track('checkout');
    await analytics.flush();

    expect(sent.find((e) => e.event_name === 'checkout')!.user_id).toBe('external-user');
  });

  it('reset releases the override and falls back to the session', async () => {
    const sent = captureFlush();
    const analytics = new KoolbaseAnalytics(config, () => 'koolbase-user');
    await analytics.init('1.0.0');

    analytics.identify('external-user');
    analytics.reset();
    analytics.track('after_reset');
    await analytics.flush();

    // Not the override, and not nothing: whoever the session says is here.
    expect(sent.find((e) => e.event_name === 'after_reset')!.user_id).toBe('koolbase-user');
  });

  it('works without a getter at all', async () => {
    // The argument is optional, so an older composition root still compiles
    // and still sends events — just anonymous ones.
    const sent = captureFlush();
    const analytics = new KoolbaseAnalytics(config);
    await analytics.init('1.0.0');

    analytics.track('legacy');
    await analytics.flush();

    expect(sent.find((e) => e.event_name === 'legacy')!.user_id).toBeUndefined();
  });
});
