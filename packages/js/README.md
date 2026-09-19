# @koolbase/js

[![npm](https://img.shields.io/npm/v/@koolbase/js.svg)](https://www.npmjs.com/package/@koolbase/js)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**From idea to app. And everything after.** Design your app, power it with a
complete backend, and keep shipping after release.

Koolbase for the browser: auth, database, storage, realtime, functions,
feature flags, remote config, and an offline write queue with conflict
resolution — one package, one `initialize()` call, TypeScript throughout.

Same core as [`@koolbase/react-native`](https://www.npmjs.com/package/@koolbase/react-native).
Same behaviour, proven by the same test suite on both hosts. The whole SDK
is about 16 kB gzipped.

---

## Get started

1. Create a free account at [app.koolbase.com](https://app.koolbase.com)
2. Create a project and copy your public key from Environments
3. Install:

```bash
npm install @koolbase/js
```

4. Initialize once at startup:

```typescript
import { Koolbase } from '@koolbase/js';

await Koolbase.initialize({
  publicKey: 'pk_live_xxxx',
  baseUrl: 'https://api.koolbase.com',
});
```

No native modules, no build step, nothing to configure. Works in any modern
browser and in frameworks that render in one — React, Vue, Svelte, Next.js on
the client side.

> **Auth is automatic.** Database, storage and function calls authenticate as
> the signed-in user — nothing to pass. Sign in (or restore a session) and every
> request carries that identity.

---

## Authentication

```typescript
await Koolbase.auth.register({ email: 'user@example.com', password: 'password' });

const session = await Koolbase.auth.login({
  email: 'user@example.com',
  password: 'password',
});

const me = Koolbase.auth.currentUser;

await Koolbase.auth.logout();

await Koolbase.auth.forgotPassword('user@example.com');

const unsubscribe = Koolbase.auth.onAuthStateChange((user) => {
  console.log(user ? 'signed in' : 'signed out');
});
```

### Sessions across page loads

Sessions persist in IndexedDB by default, so a refresh does not sign the user
out. Restore before rendering:

```typescript
import { RestoreResult } from '@koolbase/js';

const result = await Koolbase.auth.restoreSession();

switch (result) {
  case RestoreResult.Restored:  showApp(); break;
  case RestoreResult.Offline:   showApp(); break;   // optimistic, no network yet
  case RestoreResult.Expired:   showLogin(); break;
  case RestoreResult.NoSession: showLogin(); break;
}
```

### What browser storage does and does not protect

There is no keychain in a browser. IndexedDB, localStorage and every other
store a page can read are readable by any script running on that page — so an
XSS vulnerability in your app exposes the session. This is true of every
browser SDK from every vendor. The defences are a content-security policy and
short session lifetimes, not a storage backend.

If your app needs a different trade-off — an httpOnly cookie set by your own
backend, say — implement `KoolbaseAuthStorage` and pass it as
`config.authStorage`. The SDK will use yours instead of its own.

### Phone + OTP

```typescript
await Koolbase.auth.sendOtp({ phoneNumber: '+233200000000' });
await Koolbase.auth.verifyOtp({ phoneNumber: '+233200000000', code: '123456' });
```

Configure your SMS provider (Twilio, Africa's Talking, or Hubtel) in the
dashboard under Phone Auth.

### Google and Apple sign-in

The native sign-in flows are React Native features. In the browser, run the
provider's web OAuth flow yourself and pass the resulting ID token to
`Koolbase.auth.signInWithGoogle({ idToken })` or
`signInWithApple({ identityToken })` — the server-side verification is the
same.

---

## Database

```typescript
await Koolbase.db.insert('posts', { title: 'Hello', published: true });

const { records, total } = await Koolbase.db.query('posts', {
  filters: { published: true },
  limit: 10,
  orderBy: 'created_at',
  orderDesc: true,
});

const post = records[0];
console.log(post.data.title);          // your fields live under .data
console.log(post.id, post.collection); // metadata

await Koolbase.db.update('record-id', { title: 'Updated' });
await Koolbase.db.delete('record-id');
```

`total` is the size of the set you are authorized to read, on every page, so
pagination is exact.

Upsert, bulk delete, atomic batches, populate for related records, and
semantic / lexical / hybrid search over vectors all work exactly as in
`@koolbase/react-native` — see its README for the full reference; the API is
identical.

---

## Offline

Reads come from a local cache when the network is unavailable. `insert`,
`update` and `delete` queue and send when it returns.

```typescript
const { records, isFromCache } = await Koolbase.db.query('posts', { limit: 20 });

await Koolbase.db.update(id, { title: 'Corrected' });   // queued if offline
await Koolbase.db.syncPendingWrites();                   // or wait for reconnect

const pending = await Koolbase.db.pendingWrites();       // for a sync badge
const conflicts = await Koolbase.db.conflicts();         // writes the server refused
```

A write the server refuses on replay — because the record changed meanwhile —
becomes a conflict you resolve: `resolveWithLocal()`, `resolveWithServer()`,
`resolveWithMerge({...})`, or `abandon()`. Conflicts survive reloads and do not
expire; surface them if you support offline editing.

**Single tab, in this release.** Two tabs share one IndexedDB and one queue,
and both may replay the same write. Inserts are idempotent so the damage is
bounded, but a conflict resolved in one tab can be re-resolved in another.
Multi-tab coordination is on the roadmap; until then, treat the offline queue
as belonging to one tab.

---

## Storage

```typescript
const { object, downloadUrl } = await Koolbase.storage.upload({
  bucket: 'avatars',
  path: `user-${userId}.jpg`,
  file: fileFromInput,              // a File or Blob
});

const url = await Koolbase.storage.getDownloadUrl('avatars', `user-${userId}.jpg`);
await Koolbase.storage.delete('avatars', `user-${userId}.jpg`);
```

Safe-by-default: uploading to a path that is already taken throws
`KoolbaseStorageConflictError` unless you pass `overwrite: true`. Bucket size
caps, per-file caps and content-type allowlists arrive as typed errors. Public
buckets have stable CDN URLs with edge image transforms; versioned buckets keep
history. Same API as React Native.

---

## Realtime

```typescript
const unsubscribe = Koolbase.realtime.subscribe('messages', (event) => {
  if (event.type === 'deleted') console.log('deleted', event.recordId);
  else console.log(event.type, event.record!.data);
});
```

One WebSocket, shared across subscriptions, reconnecting with backoff. Events
are filtered server-side by the collection's read rule, so a subscriber sees
only what a query would return them.

---

## Functions

```typescript
const result = await Koolbase.functions.invoke('send-welcome-email', { userId });
if (result.success) console.log(result.data);
```

The signed-in user's token is forwarded automatically; the function reads the
caller on `ctx.auth`. Failures are typed: `FunctionNotFoundError`,
`FunctionPermissionError`, `FunctionValidationError`,
`FunctionQuotaExceededError`, `FunctionExecutionError`.

---

## Feature flags and remote config

```typescript
if (Koolbase.isEnabled('new_checkout')) { /* ... */ }

const timeout = Koolbase.configNumber('timeout_seconds', 30);
const apiUrl  = Koolbase.configString('api_url', 'https://api.myapp.com');
const dark    = Koolbase.configBool('force_dark_mode', false);

const v = Koolbase.checkVersion('1.2.3');
if (v.status === 'force_update') { /* block and prompt */ }
```

---

## Analytics

```typescript
Koolbase.analytics.track('purchase', { value: 1200, currency: 'GHS' });
Koolbase.analytics.screenView('checkout');
Koolbase.analytics.identify(user.id);
Koolbase.analytics.reset();   // on sign-out
```

Events batch and flush every 30 seconds, when the tab is hidden, and on
`pagehide`.

---

## Not in the browser package

Stated here so nothing is discovered as a method that fails:

- **Code push** — a native-bundle concept. The web already ships on deploy.
- **Push messaging** — FCM device tokens come from a native module. Use Web
  Push through your own service worker and your backend.
- **The native sign-in libraries** — `signInWithGoogle` and
  `signInWithApple` themselves are here and work; what a browser cannot do
  is fetch the credential from a native module. Run the provider's web
  OAuth flow and pass the ID token, as above.

---

## Error handling

Every error the SDK raises extends `KoolbaseError`. Authentication failures
(401) are `KoolbaseUnauthenticatedError` from any subsystem, and the user is
already signed out by the time you catch one. The full error reference is in
the [`@koolbase/react-native` README](https://www.npmjs.com/package/@koolbase/react-native#error-handling);
the classes are identical.

---

## Documentation

Full documentation at [docs.koolbase.com](https://docs.koolbase.com) ·
Dashboard at [app.koolbase.com](https://app.koolbase.com) ·
Issues at [github.com/koolbase/koolbase-react-native](https://github.com/koolbase/koolbase-react-native/issues) ·
Email <dev@koolbase.com>

## License

MIT
