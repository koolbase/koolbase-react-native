// S1b: moving and copying a file. The request each sends, the file that
// comes back, and the refusals, typed.

import { KoolbaseStorage } from '../src/storage';
import * as errors from '../src/storage-errors';

const config = { publicKey: 'pk_test', baseUrl: 'https://api.test' } as never;
const g = globalThis as unknown as { fetch: unknown };
const realFetch = g.fetch;
afterEach(() => {
  g.fetch = realFetch;
});

const object = (path: string) => ({
  id: 'o2', project_id: 'p1', bucket_id: 'b2', r2_bucket: 'koolbase-storage', path, size: 4,
  content_type: 'image/png', metadata: {}, created_at: '2026-10-16T10:00:00Z', updated_at: '2026-10-16T10:00:00Z',
});

function answering(status: number, body: unknown, seen: { url?: string; body?: Record<string, unknown> } = {}) {
  g.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    seen.url = url;
    seen.body = JSON.parse(String(init.body));
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
  return seen;
}

describe('move and copy', () => {
  it('a move to another bucket names both, and returns the moved file', async () => {
    const seen = answering(201, object('2026/scan.png'));
    const moved = await new KoolbaseStorage(config, async () => 'tok').move({ bucket: 'inbox', from: 'scan.png', toBucket: 'vault', to: '2026/scan.png' });
    expect(seen.url).toBe('https://api.test/v1/sdk/storage/move');
    expect(seen.body).toEqual({ bucket: 'inbox', from: 'scan.png', to: '2026/scan.png', to_bucket: 'vault' });
    expect(moved).toMatchObject({ path: '2026/scan.png', bucketId: 'b2' });
  });

  it('a copy within a bucket sends no destination bucket', async () => {
    const seen = answering(201, object('copies/a.png'));
    await new KoolbaseStorage(config, async () => 'tok').copy({ bucket: 'media', from: 'a.png', to: 'copies/a.png', toBucket: 'media' });
    expect(seen.url).toBe('https://api.test/v1/sdk/storage/copy');
    expect(seen.body).toEqual({ bucket: 'media', from: 'a.png', to: 'copies/a.png' });
  });

  it('refusals arrive typed', async () => {
    const s = new KoolbaseStorage(config, async () => 'tok');
    const fail = async (status: number, body: unknown) => {
      answering(status, body);
      try {
        await s.move({ bucket: 'posters', from: 'gig.png', to: 'old/gig.png' });
      } catch (e) {
        return e;
      }
      throw new Error('expected a refusal');
    };
    const inUse = await fail(409, { error: 'Used by 2 records', code: 'file_in_use', details: { field: 'events.poster', records: 2 } });
    expect(inUse).toBeInstanceOf(errors.KoolbaseStorageFileInUseError);
    expect(inUse).toMatchObject({ field: 'events.poster', records: 2, code: 'file_in_use' });
    expect(await fail(409, { error: 'x', code: 'name_has_history' })).toBeInstanceOf(errors.KoolbaseStorageNameHasHistoryError);
    expect(await fail(409, { error: 'x', code: 'path_conflict', path: 'old/gig.png' })).toBeInstanceOf(errors.KoolbaseStorageConflictError);
    expect(await fail(413, { error: 'x', code: 'file_too_large' })).toBeInstanceOf(errors.KoolbaseStorageFileTooLargeError);
    expect(await fail(403, { error: 'x', code: 'not_allowed' })).toBeInstanceOf(errors.KoolbaseStoragePermissionError);
  });
});
