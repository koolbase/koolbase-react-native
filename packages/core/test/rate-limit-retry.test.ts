import { RateLimitError, retryAfterOf } from '../src/auth-errors';

// #244: a rate-limited request says when to try again -- the body's
// retry_after, else the Retry-After header, else nothing (the producer is
// hatchway-api's respond.RateLimited, 244d1).
const res = (headers: Record<string, string> = {}) => ({ headers: { get: (n: string) => headers[n.toLowerCase()] ?? null } });

describe('RateLimitError.retryAfter', () => {
  it('reads the body first', () => {
    const body = { code: 'rate_limit', error: 'too many codes requested; try again later', retry_after: 462 };
    expect(retryAfterOf(res({ 'retry-after': '9' }), body)).toBe(462);
    expect(new RateLimitError(body.error, retryAfterOf(res(), body)).retryAfter).toBe(462);
  });
  it('else the header', () => {
    expect(retryAfterOf(res({ 'retry-after': '30' }), { code: 'rate_limit' })).toBe(30);
  });
  it('a server that says nothing: null, as before', () => {
    expect(retryAfterOf(res(), { error: 'too many requests' })).toBeNull();
    expect(new RateLimitError().retryAfter).toBeNull();
    expect(new RateLimitError()).toBeInstanceOf(RateLimitError);
  });
});
