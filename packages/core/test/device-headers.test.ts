import { DeviceMetadata } from '../src/device-metadata';
import { setPlatform } from '../src/platform';
import { testPlatform } from './platform';

// The exact header set this SDK sends.
//
// A browser refuses a request whose preflight does not list the headers it
// carries, and the server never sees it — nothing logged, no error raised,
// the only symptom in the console of whoever is using the SDK. That is what
// happened on 18 September 2026: the API's CORS allowance was missing all
// six of these, and every authenticated call from @koolbase/js failed on
// every endpoint from the moment the package was published.
//
// The API declares the allowed set in platform/clientheaders and derives its
// CORS list from it. This is the other end of that contract: adding a header
// here fails this test, which is the prompt to add it there first.
//
// Two headers are deliberately absent:
//   User-Agent — a browser forbids setting it, and sending it made every
//     request fail in the same silent way.
//   X-Koolbase-Device — the pre-1.9.0 device label. The server still reads
//     it for old installs; nothing new should send it.

const EXPECTED = [
  'x-koolbase-sdk',
  'x-koolbase-sdk-version',
  'x-koolbase-platform',
  'x-koolbase-platform-version',
  'x-koolbase-app-version',
  'x-koolbase-device-label',
].sort();

describe('device headers', () => {
  beforeEach(async () => {
    setPlatform(await testPlatform());
  });

  it('sends exactly the headers the API allows', async () => {
    const headers = await new DeviceMetadata('1.0.0').build();
    expect(Object.keys(headers).sort()).toEqual(EXPECTED);
  });

  it('sends no User-Agent', async () => {
    // A browser rejects the attempt outright. This is not a style
    // preference; setting it breaks every request on web.
    const headers = await new DeviceMetadata('1.0.0').build();
    const names = Object.keys(headers).map((k) => k.toLowerCase());
    expect(names).not.toContain('user-agent');
  });

  it('every header carries a value', async () => {
    // An empty header is sent and stored as nothing, which looks like an SDK
    // that never reported itself rather than one that reported blank.
    const headers = await new DeviceMetadata('1.0.0').build();
    for (const [name, value] of Object.entries(headers)) {
      expect({ name, empty: value === '' }).toEqual({ name, empty: false });
    }
  });
});
