import 'fake-indexeddb/auto';
import { memoryPlatform, type PlatformAdapter, type PlatformStorage } from '../src/platform';
import { browserPlatform } from '../src/platform-browser';

// The adapter every test installs in beforeEach. KOOLBASE_TEST_PLATFORM=browser
// runs the identical suite on the browser adapter over fake-indexeddb, which is
// the cross-platform proof: same 60 assertions, different host.
let last: PlatformAdapter | null = null;

export async function testPlatform(): Promise<PlatformAdapter> {
  if (process.env.KOOLBASE_TEST_PLATFORM !== 'browser') return memoryPlatform();
  // A fresh database per test, matching memoryPlatform's isolation. The
  // previous adapter's connection must be closed first or deleteDatabase
  // blocks behind it and the next open never resolves.
  const prev = last?.storage as (PlatformStorage & { close?: () => Promise<void> }) | undefined;
  await prev?.close?.();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('koolbase');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // nothing else holds it once closed
  });
  last = browserPlatform();
  return last;
}
