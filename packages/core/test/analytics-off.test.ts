import { disabledAnalytics } from '../src/analytics';

describe('disabledAnalytics', () => {
  it('does nothing, and says once how to turn analytics on', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    const a: any = disabledAnalytics();
    expect(() => a.track('signup', { plan: 'free' })).not.toThrow();
    await a.flush();
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toContain('analyticsEnabled: true');
    expect(a.then).toBeUndefined();
    info.mockRestore();
  });
});
