import { KoolbaseStorage } from '../src/storage';
import { KoolbaseStorageProjectIdentityError } from '../src/storage-errors';
import { KoolbaseFlags } from '../src/flags';

const config = { publicKey: 'pk_test', baseUrl: 'https://api.example.test' } as never;

describe('storage.publicUrlFor: the project identity from bootstrap', () => {
  it('throws the identity error and nudges a refresh while identity is missing', () => {
    let nudges = 0;
    const s = new KoolbaseStorage(config, async () => null, undefined, () => '', () => { nudges += 1; });
    expect(() => s.publicUrlFor({ bucket: 'avatars', path: 'me.png' })).toThrow(KoolbaseStorageProjectIdentityError);
    try { s.publicUrlFor({ bucket: 'avatars', path: 'me.png' }); } catch (e) { expect((e as { code?: string }).code).toBe('project_identity_unavailable'); }
    expect(nudges).toBe(2);
  });

  it('builds the CDN URL once identity is known, with or without a transform', () => {
    const s = new KoolbaseStorage(config, async () => null, undefined, () => 'p1', () => { throw new Error('no nudge expected'); });
    expect(s.publicUrlFor({ bucket: 'avatars', path: 'a b.png' })).toBe('https://cdn.koolbase.com/p1/avatars/a%20b.png');
    expect(s.publicUrlFor({ bucket: 'avatars', path: 'me.png', transform: { width: 64, height: 64, fit: 'cover' } }))
      .toBe('https://cdn.koolbase.com/cdn-cgi/image/width=64,height=64,fit=cover/p1/avatars/me.png');
  });

  it('flags read the project id from the bootstrap payload', () => {
    const f = new KoolbaseFlags(config, 'dev-1');
    expect(f.projectId()).toBe('');
    (f as unknown as { payload: unknown }).payload = { payload_version: '1', project_id: 'p9', flags: {}, config: {}, version: {} };
    expect(f.projectId()).toBe('p9');
  });
});
