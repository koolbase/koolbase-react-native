import { koolbaseFetch, KoolbaseNetworkError } from '../src/network';

describe('koolbaseFetch', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    (global as any).fetch = realFetch;
    delete (globalThis as any).location;
  });

  it('turns a bare network failure into an actionable error that is still a TypeError', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await koolbaseFetch('https://api.example.test/v1/x').catch((e) => e);
    expect(err).toBeInstanceOf(KoolbaseNetworkError);
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toContain('https://api.example.test');
    expect(err.message).toContain('Failed to fetch');
  });

  it('names Trusted Origins, with the page origin, in a browser', async () => {
    (globalThis as any).location = { origin: 'https://shop.example.test' };
    (global as any).fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await koolbaseFetch('https://api.example.test/v1/x').catch((e) => e);
    expect(err.message).toContain('https://shop.example.test');
    expect(err.message).toContain('Trusted Origins');
  });

  it('passes responses and cancellations through unchanged', async () => {
    const res = { ok: true } as Response;
    (global as any).fetch = jest.fn().mockResolvedValue(res);
    await expect(koolbaseFetch('https://api.example.test')).resolves.toBe(res);
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    (global as any).fetch = jest.fn().mockRejectedValue(abort);
    await expect(koolbaseFetch('https://api.example.test')).rejects.toBe(abort);
  });
});
