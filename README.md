# @koolbase/react-native

[![npm](https://img.shields.io/npm/v/@koolbase/react-native.svg)](https://www.npmjs.com/package/@koolbase/react-native)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**From idea to app. And everything after.** Design your app, power it with a
complete backend, and keep shipping after release.

Auth, database, storage, realtime, functions, feature flags, remote config,
version enforcement, logic engine, analytics, and cloud messaging — one SDK,
one `initialize()` call.

---

## Get started in 2 minutes

1. Create a free account at [app.koolbase.com](https://app.koolbase.com)
2. Create a project and copy your public key from Environments
3. Install the SDK and its peer dependencies:

```bash
npm install @koolbase/react-native
npm install @react-native-async-storage/async-storage @react-native-community/netinfo
```

> The native modules are peer dependencies so exactly one copy of each exists in
> your app. Two copies of a native module is a runtime failure that looks like an
> SDK bug, which is why they are not bundled.

4. Initialize at app startup:

```typescript
import { Koolbase } from '@koolbase/react-native';

await Koolbase.initialize({
  publicKey: 'pk_live_xxxx',
  baseUrl: 'https://api.koolbase.com',
});
```

That's it. Every feature below is now available via `Koolbase.*`.

### Optional peer dependencies

| Package | Needed for |
|---|---|
| `react-native-keychain` | Persistent sessions in Keychain / Keystore. Without it the SDK warns once and runs without persistence. |
| `@invertase/react-native-apple-authentication` | Sign in with Apple |
| `@react-native-google-signin/google-signin` | Sign in with Google |
| `@react-native-firebase/messaging` | Push notification tokens |

> **Expo Go:** `react-native-keychain` and the native sign-in modules are not
> available there. Sessions still work — implement `KoolbaseAuthStorage` over
> `expo-secure-store` or `AsyncStorage` and pass it as `config.authStorage`.
> Native Apple/Google sign-in and remote push require a development build.

---

> **Auth is automatic (v3+).** Database, storage, and functions calls
> authenticate as the currently signed-in user — nothing to pass, no manual
> wiring. Sign in (or restore a session) and every request carries that
> identity. `owner` and `authenticated` collections require an active session.

---

## Authentication

Email and password, Apple Sign-In, Google Sign-In, and phone + OTP.

```typescript
await Koolbase.auth.register({ email: 'user@example.com', password: 'password' });

const session = await Koolbase.auth.login({
  email: 'user@example.com',
  password: 'password',
});

const me = Koolbase.auth.currentUser;

await Koolbase.auth.logout();

await Koolbase.auth.forgotPassword('user@example.com');

// Fires immediately with the current state, then on every change
const unsubscribe = Koolbase.auth.onAuthStateChange((user) => {
  console.log(user ? 'signed in' : 'signed out');
});
```

### Sessions across restarts

With `react-native-keychain` installed, sessions persist. Restore at launch
before rendering:

```typescript
import { RestoreResult } from '@koolbase/react-native';

const result = await Koolbase.auth.restoreSession();

switch (result) {
  case RestoreResult.Restored: navigate('Home'); break;
  case RestoreResult.Offline:  navigate('Home'); break; // optimistic, no network
  case RestoreResult.Expired:  navigate('Login'); break;
  case RestoreResult.NoSession: navigate('Login'); break;
}
```

Optimistic state is read from disk before any network call, so authenticated UI
renders with no round-trip.

### Sign in with Apple

```typescript
import appleAuth from '@invertase/react-native-apple-authentication';

const response = await appleAuth.performRequest({
  requestedOperation: appleAuth.Operation.LOGIN,
  requestedScopes: [appleAuth.Scope.EMAIL, appleAuth.Scope.FULL_NAME],
});

const session = await Koolbase.auth.signInWithApple({
  identityToken: response.identityToken!,
  nonce: response.nonce,
  fullName: response.fullName
    ? {
        givenName: response.fullName.givenName ?? undefined,
        familyName: response.fullName.familyName ?? undefined,
      }
    : undefined,
});
```

Configure Apple Sign-In for your environment with your iOS Bundle ID. Setup
guide at [docs.koolbase.com/auth/oauth](https://docs.koolbase.com/auth/oauth).

### Sign in with Google

```typescript
import { GoogleSignin } from '@react-native-google-signin/google-signin';

GoogleSignin.configure({
  webClientId: '<your-web-client-id>.apps.googleusercontent.com',
});

const userInfo = await GoogleSignin.signIn();

const session = await Koolbase.auth.signInWithGoogle({
  idToken: userInfo.idToken!,
});
```

Configure the OAuth client IDs from Google Cloud Console (one each for iOS,
Android, and web).

### Phone + OTP

```typescript
await Koolbase.auth.sendOtp({ phoneNumber: '+233200000000' });

await Koolbase.auth.verifyOtp({
  phoneNumber: '+233200000000',
  code: '123456',
});

// Or attach a phone to an account that already exists
await Koolbase.auth.linkPhone({
  phoneNumber: '+233200000000',
  code: '123456',
});
```

Configure your SMS provider (Twilio, Africa's Talking, or Hubtel) in the
dashboard under Phone Auth.

---

## Database

```typescript
await Koolbase.db.insert('posts', { title: 'Hello', published: true });

const { records } = await Koolbase.db.query('posts', {
  filters: { published: true },
  limit: 10,
  orderBy: 'created_at',
  orderDesc: true,
});

const post = records[0];
console.log(post.data.title);          // your fields live under .data
console.log(post.id, post.collection); // metadata

// Related records
const { records: withAuthor } = await Koolbase.db.query('posts', {
  populate: ['author_id:users'],
});

await Koolbase.db.update('record-id', { title: 'Updated' });
await Koolbase.db.delete('record-id');
```

### Upsert

Insert a record, or update the existing one matching a filter.

```typescript
const result = await Koolbase.db.upsert(
  'profiles',
  { user_id: userId },
  { weightKg: 70 },
);

console.log(result.created);   // true if inserted, false if updated
console.log(result.record.id);
```

> Online-only: deciding insert versus update needs the server's view, so unlike
> `insert` it is not queued offline and throws on network failure.

### Delete where

Bulk-delete every record matching a filter. Returns the number deleted.

```typescript
const deleted = await Koolbase.db.deleteWhere('sessions', {
  user_id: userId,
  status: 'expired',
});
```

> A non-empty filter is required. The collection's delete rule applies; under
> `owner` or `scoped` rules the delete is scoped to your own records.
> Online-only.

### Atomic batch writes

All operations commit together or none are applied.

```typescript
import { Koolbase, BatchOp } from '@koolbase/react-native';

const results = await Koolbase.db.batch([
  BatchOp.insert('orders', { total: 50, customer_id: customerId }),
  BatchOp.update(inventoryId, { stock: 9 }),
  BatchOp.upsert('counters', { match: { name: 'orders' }, data: { value: 1 } }),
  BatchOp.delete(cartItemId),
]);

// results[i] corresponds to operations[i]:
//   insert / update -> { type, record }
//   upsert          -> { type, record, created }
//   delete          -> { type, deleted: true }
```

Atomicity needs the server's authoritative view, so `batch()` is never queued
offline — it throws on network failure. A rejection throws a `KoolbaseDataError`
carrying the failing operation's details; nothing was persisted.

### Handling write conflicts

`insert`, `update`, and `upsert` are online-first: when the server is reachable
they throw on rejection.

```typescript
import { KoolbaseConflictError } from '@koolbase/react-native';

try {
  await Koolbase.db.insert('users', { email, name });
} catch (e) {
  if (e instanceof KoolbaseConflictError) {
    showError(`That ${e.field ?? 'value'} is already in use.`);
  } else {
    throw e;
  }
}
```

---

## Offline-first

Reads come from a local cache when the network is unavailable, and `insert`,
`update`, and `delete` are queued and sent when it returns.

```typescript
const { records, isFromCache } = await Koolbase.db.query('posts', { limit: 20 });
if (isFromCache) console.log('Served from local cache');

// Queued offline, applied on reconnect
await Koolbase.db.update(id, { title: 'Corrected' });
await Koolbase.db.delete(id);

// Sync happens on reconnect. To force it:
await Koolbase.db.syncPendingWrites();
```

A server-side rejection is never queued. A unique-constraint violation, a
validation failure, or a permission denial surfaces immediately — only a genuine
network failure defers.

### Showing what is waiting

```typescript
const pending = await Koolbase.db.pendingWrites();   // oldest first

if (pending.length) {
  showSyncBadge(pending.length);
}
```

Queues are per-user and survive logout by design, so unsynced edits sync
whenever that user next signs in on this device — possibly never. Warn before
signing out with a non-empty queue.

> Requires a signed-in user. Per-user surfaces refuse rather than falling back
> to a shared anonymous bucket, so a signed-out call throws instead of reporting
> a misleading zero.

### Editing offline requires having read the record

An update or delete is queued only if the SDK knows what the record looked like
when the change was made. Replaying a change without that means applying it
blindly: whatever else happened to the record meanwhile is overwritten,
silently, with nobody able to tell.

The SDK has that state if the record has been seen on this device — through a
query, a single read, a realtime event, or because it was created here and is
still queued. If not, the write is refused rather than queued:

```typescript
try {
  await Koolbase.db.update(id, { title: 'Corrected' });
} catch (e) {
  if (e instanceof KoolbaseOfflineBaselineUnavailableError) {
    // Never seen on this device. Read it, or make the change while online.
  }
}
```

That is deliberate rather than lenient. Queueing it anyway would mean most
offline updates are conflict-safe and some quietly are not, which is a worse
guarantee than a clear refusal.

### When a queued write cannot be applied

On replay the server applies a queued write only if the record still carries the
revision the change was based on. If something changed it meanwhile — another
device, another user, a Function — the write is refused and held for a decision.
It is not lost, and not applied, and it survives restarts.

```typescript
const conflicts = await Koolbase.db.conflicts();

for (const c of conflicts) {
  c.local;             // the change the user made
  c.server;            // the record as the server holds it now
  c.divergentFields;   // where they disagree
  c.operation;         // 'insert' | 'update' | 'delete'
  c.reason;            // why it is waiting

  await c.resolveWithLocal();        // reapply the user's change
  await c.resolveWithServer();       // keep the server's version
  await c.resolveWithMerge({ ... }); // something composed from both
  await c.abandon();                 // drop it, neither side wins
}
```

`reason` distinguishes two situations. `concurrent_modification` means the record
moved while the change was queued. `baseline_unavailable` means the change was
queued by a version of this SDK that did not record what it was based on — those
are migrated on upgrade rather than replayed, since there is nothing to check
them against.

A refused insert is a conflict too, and resolving it retries the insert, carrying
the conflict id as an idempotency key so a retry cannot double-write.

Resolving is itself conditional: if the record has moved again while someone was
deciding, resolution produces a new conflict rather than overwriting a change
nobody has seen.

> **These do not expire.** An app that never reads `conflicts()` accumulates them
> in local storage indefinitely, invisible to the user, with the changes they
> hold never applied. If you support offline editing, surface them somewhere.
> Automatic expiry would hide the problem while quietly losing the work.

---

## Search — semantic, lexical, and hybrid

Find records by meaning, by exact terms, or both. Declare a vector field on the
collection from the dashboard or CLI first, picking a dimension (384, 768, 1024,
or 1536).

```typescript
// Semantic (default) — vector search via HNSW + cosine. Fuzzy or conceptual
// queries where exact words need not match.
const result = await Koolbase.db.searchSemantic({
  collection: 'articles',
  field: 'content_embedding',
  queryText: 'how do I move quicker?',
  limit: 10,
});

// Lexical — BM25 over the field's source text. Exact terms, product codes,
// names, acronyms.
await Koolbase.db.searchSemantic({
  collection: 'articles',
  field: 'content_embedding',
  queryText: 'CVE-2024-1234',
  mode: 'lexical',
  limit: 10,
});

// Hybrid — both, fused with reciprocal rank fusion (k=60). Generally the
// strongest default.
await Koolbase.db.searchSemantic({
  collection: 'articles',
  field: 'content_embedding',
  queryText: 'production deploy pipeline',
  mode: 'hybrid',
  limit: 10,
});

for (const hit of result.hits) {
  console.log(`${hit.record.data.title}  ${hit.distance.toFixed(3)}`);
}
```

### Filtering weak matches

For `semantic` and `hybrid`, `minSimilarity` (0–100) drops results below a
threshold server-side:

```typescript
await Koolbase.db.searchSemantic({
  collection: 'articles',
  field: 'content_embedding',
  queryText: 'how do I move quicker?',
  mode: 'hybrid',
  minSimilarity: 70,
  limit: 10,
});
```

The server rejects `minSimilarity` on `lexical` mode — BM25 ranks are not
comparable to cosine similarity, and silently ignoring it would be confusing.

### Server-side embedding (recommended)

Configure an AI provider on the project once (Gemini's free tier works; OpenAI
is also supported), tag the vector field with provider, model, and source field,
and records are embedded as they are written. Lexical indexing happens on the
same write, so all three modes work with no extra setup.

```typescript
// Write records normally — vectors and lexical rows land within about a second
await Koolbase.db.insert('articles', {
  title: 'How to ship faster',
  content: 'Cut scope ruthlessly. Ship the smallest useful slice...',
});

// Backfill records that pre-date the auto-embed config
await Koolbase.db.embedText({
  collection: 'articles',
  recordId: article.id,
  vectorField: 'content_embedding',
});

// Or override the source, to combine fields
await Koolbase.db.embedText({
  collection: 'articles',
  recordId: article.id,
  vectorField: 'content_embedding',
  text: `${article.title}\n\n${article.summary}`,
});
```

### Client-side embedding

Pass a vector instead of text if you would rather control the model. Lexical and
hybrid modes require text, since BM25 has no notion of a vector query.

```typescript
await Koolbase.db.setVector(
  articleId,
  'embedding',
  await myEmbeddingModel.encode(article.content),
);

const v = await Koolbase.db.getVector(articleId, 'embedding');
console.log(`${v.vector.length}-dim, updated ${v.updatedAt}`);

await Koolbase.db.searchSemantic({
  collection: 'articles',
  field: 'embedding',
  queryVector: await myEmbeddingModel.encode(userQuery),
  limit: 10,
  where: { category: 'tech' },
});

await Koolbase.db.deleteVector(articleId, 'embedding');
```

### Behaviours worth knowing

- **Pass exactly one of `queryVector` or `queryText`.** Both or neither throws.
- **`queryVector` is semantic-mode only.** Lexical and hybrid need raw text.
- **Vector length must match the declared dimension**, or
  `KoolbaseVectorDimensionMismatchError`.
- **Online-only.** Vector operations are not cached or queued — similarity
  search has no useful offline semantics.
- **Read rules apply after retrieval.** Strict rules may return fewer than
  `limit` results.
- **`embedText` is async.** It returns once the job is queued; the vector lands
  within about a second.

See [the vector docs](https://docs.koolbase.com/database/vectors) for provider
setup and when to pick each mode.

---

## Storage

Presigned uploads and downloads backed by Cloudflare R2. Uploads are
safe-by-default: a path that is already taken throws rather than silently
replacing the file.

```typescript
const { object, downloadUrl } = await Koolbase.storage.upload({
  bucket: 'avatars',
  path: `user-${userId}.jpg`,
  file: { uri: imageUri, name: 'avatar.jpg', type: 'image/jpeg' },
});

// Replace whatever is there
await Koolbase.storage.upload({
  bucket: 'avatars',
  path: `user-${userId}.jpg`,
  file: { uri: imageUri, name: 'avatar.jpg', type: 'image/jpeg' },
  overwrite: true,
});

const url = await Koolbase.storage.getDownloadUrl('avatars', `user-${userId}.jpg`);

await Koolbase.storage.delete('avatars', `user-${userId}.jpg`);
```

### Handling upload conflicts

For user-supplied filenames, prompt before overwriting:

```typescript
import { KoolbaseStorageConflictError } from '@koolbase/react-native';

try {
  await Koolbase.storage.upload({
    bucket: 'documents',
    path: filename,
    file: { uri, name: filename, type: mimeType },
  });
} catch (e) {
  if (e instanceof KoolbaseStorageConflictError) {
    const ok = await confirm(`${e.path} already exists. Overwrite?`);
    if (ok) {
      await Koolbase.storage.upload({
        bucket: 'documents',
        path: filename,
        file: { uri, name: filename, type: mimeType },
        overwrite: true,
      });
    }
  } else {
    throw e;
  }
}
```

### Bucket limits

Buckets can carry a total size cap, a per-file cap, and a content-type
allowlist (`image/*` wildcards supported). Violations arrive as typed errors:

```typescript
import {
  KoolbaseStorageQuotaError,
  KoolbaseStorageFileTooLargeError,
  KoolbaseStorageMimeTypeError,
} from '@koolbase/react-native';

try {
  await Koolbase.storage.upload({
    bucket: 'user-photos',
    path: filename,
    file: { uri, name: filename, type: mimeType },
  });
} catch (e) {
  if (e instanceof KoolbaseStorageMimeTypeError) {
    showError('That file type is not allowed in this bucket.');
  } else if (e instanceof KoolbaseStorageFileTooLargeError) {
    showError('That file is too big — pick a smaller one.');
  } else if (e instanceof KoolbaseStorageQuotaError) {
    showError('This bucket is full — delete some files and try again.');
  } else {
    throw e;
  }
}
```

MIME enforcement runs at presign time, so no bytes move before rejection.
Size and quota enforcement run at confirm time, and the server removes the
underlying R2 object before returning the error.

### Public bucket URLs

Files in public buckets have a stable CDN URL — no network call, no expiry,
embeddable anywhere.

```typescript
import { KoolbaseStorage } from '@koolbase/react-native';

// From an object you already have
const url = KoolbaseStorage.publicUrlForObject(object, 'avatars');
// null for private-bucket objects; the CDN URL for public ones

if (url) {
  return <Image source={{ uri: url }} />;
}

// Build-time construction, no object on hand
const built = KoolbaseStorage.publicUrl({
  projectId: 'proj_abc',
  bucket: 'avatars',
  path: 'user-123.jpg',
});
// Always returns the pattern; the caller is responsible for knowing the file
// is public. A private-bucket path will 404.
```

URLs follow `https://cdn.koolbase.com/{project_id}/{bucket}/{path}` — long-lived
and edge-cached. For private buckets use `getDownloadUrl`, which returns a
one-hour presigned URL.

### Image transforms

Public URLs can be resized and reformatted at the edge with no preprocessing.

```typescript
const url = KoolbaseStorage.publicUrl({
  projectId: 'proj_abc',
  bucket: 'avatars',
  path: 'user-123.jpg',
  transform: { width: 200, height: 200, fit: 'cover', format: 'auto', quality: 85 },
});
```

Or store the option set server-side and reference it by name:

```typescript
const url = KoolbaseStorage.publicUrlWithPreset({
  projectId: 'proj_abc',
  presetName: 'thumbnail',
  bucket: 'avatars',
  path: 'user-123.jpg',
});

const fromObject = KoolbaseStorage.publicUrlForObjectWithPreset(
  object,
  'avatars',
  'thumbnail',
);
```

Options: `width` and `height` (1–2000), `format`
(`auto`/`webp`/`avif`/`jpeg`/`png`), `quality` (1–100), `fit`
(`scale-down`/`contain`/`cover`/`crop`/`pad`), `dpr` (1–3), and `gravity` (ten
anchor positions). Transformed responses are edge-cached for four hours, and
every account includes 5,000 unique transformations a month.

### Object versioning

On buckets with versioning enabled, overwrites preserve the prior content and
deletes are soft.

```typescript
const versions = await Koolbase.storage.listVersions('documents', 'contract.pdf');

for (const v of versions) {
  console.log(`${v.versionId}: size=${v.size} isCurrent=${v.isCurrent}`);
}

// Download a historical version
const url = await Koolbase.storage.getDownloadUrl(
  'documents',
  'contract.pdf',
  '019e98ed-eed6-7e71-...',
);

// Bring one back as current (the existing current is snapshotted first)
await Koolbase.storage.restoreVersion('documents', 'contract.pdf', '019e98ed-...');

// Hard-remove one history version, row and bytes
await Koolbase.storage.purgeVersion('documents', 'contract.pdf', 'old-version-id');

// Wipe the whole timeline for a path
await Koolbase.storage.delete('documents', 'contract.pdf', true);
```

- **Overwrite snapshots automatically.** The prior bytes become history; the
  upload becomes current.
- **Delete is soft.** The current content is snapshotted and a delete marker
  recorded, recoverable until force-purged.
- **Restore is itself versioned.** The restored row gets a fresh `versionId` and
  the target stays in history at its original id, so a restore can be undone.
- **Delete markers list but do not download.** `size === 0`,
  `isDeleteMarker === true`, and `getDownloadUrl` on one throws.

---

## Realtime

Subscribe to live changes on a collection. Uses the signed-in user's session, so
subscribe after sign-in.

```typescript
const unsubscribe = Koolbase.realtime.subscribe('messages', (event) => {
  if (event.type === 'deleted') {
    console.log('deleted', event.recordId);        // recordId on deletes
  } else {
    console.log(event.type, event.record!.data);   // record on created/updated
  }
});

unsubscribe();
```

The socket opens lazily, is shared across subscriptions, and reconnects with
backoff that doubles up to a minute and resets when a connection opens. The
project is taken from the session.

---

## Functions

Invoke deployed functions. A signed-in user's access token is forwarded
automatically, so the function sees the caller on `ctx.auth`.

```typescript
const result = await Koolbase.functions.invoke('send-welcome-email', {
  userId: '123',
});

if (result.success) console.log(result.data);
```

Inside the function:

```typescript
export async function handler(ctx) {
  const userId = ctx.auth?.user_id;
  if (!userId) {
    return { error: { code: 'AUTH_REQUIRED' }, status: 401 };
  }
  return { ok: true };
}
```

Failures are typed — `FunctionNotFoundError`, `FunctionPermissionError`,
`FunctionValidationError`, `FunctionQuotaExceededError`,
`FunctionExecutionError` — so handling never depends on message text. Token
refresh is transparent.

---

## Feature flags and remote config

```typescript
if (Koolbase.isEnabled('new_checkout')) { /* ... */ }

const timeout = Koolbase.configNumber('timeout_seconds', 30);
const apiUrl  = Koolbase.configString('api_url', 'https://api.myapp.com');
const dark    = Koolbase.configBool('force_dark_mode', false);
```

Rollout buckets are computed from a stable per-install device id, so a 10%
rollout is genuinely 10% of devices.

---

## Version enforcement

```typescript
const result = Koolbase.checkVersion('1.2.3');

if (result.status === 'force_update') {
  // block and show an update screen
}
```

---

## Logic engine

Conditional app behaviour defined as data, updatable without a release.

```typescript
const result = Koolbase.executeFlow('on_checkout_tap', {
  plan: user.plan,
  usage: user.usage,
});

if (result.hasEvent) {
  switch (result.eventName) {
    case 'show_upgrade': navigation.navigate('Upgrade'); break;
    case 'go_checkout':  navigation.navigate('Checkout'); break;
  }
}
```

Operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `starts_with`,
`ends_with`, `in_list`, `not_in_list`, `between`, `is_true`, `is_false`,
`exists`, `not_exists`, `and`, `or`.

Full docs at
[docs.koolbase.com/sdk/logic-engine](https://docs.koolbase.com/sdk/logic-engine).

---

## Analytics

Screen views, custom events, and user properties. DAU, WAU, MAU, funnels and
retention appear in the dashboard.

```typescript
await Koolbase.initialize({
  publicKey: 'pk_live_xxxx',
  baseUrl: 'https://api.koolbase.com',
  analyticsEnabled: true,
  appVersion: '1.0.0',
});

Koolbase.analytics.track('purchase', { value: 1200, currency: 'GHS' });
Koolbase.analytics.screenView('checkout');
Koolbase.analytics.identify(user.id);
Koolbase.analytics.setUserProperty('plan', 'pro');

// On sign-out
Koolbase.analytics.reset();
```

Events batch and flush every 30 seconds, on backgrounding, on close, or at 20
events.

---

## Cloud messaging

```typescript
await Koolbase.initialize({
  publicKey: 'pk_live_xxxx',
  baseUrl: 'https://api.koolbase.com',
  messagingEnabled: true,
});

const fcmToken = await messaging().getToken();

await Koolbase.messaging.registerToken({
  token: fcmToken,
  platform: 'android', // or 'ios'
});
```

Sending is server-initiated only. It needs a secret `kb_live_` key and must run
from your backend or a Koolbase Function — the publishable key ships inside your
bundle, so a client that could send would let anyone who extracts it push to
your users.

```bash
curl -X POST https://api.koolbase.com/v1/messaging/send \
  -H "Authorization: Bearer kb_live_..." \
  -H "Content-Type: application/json" \
  --data '{"project_id":"...","token":"...","title":"Your order is ready","body":"Pick up at counter 3"}'
```

---

## Error handling

Errors are selected from the server's stable error `code`, so handling never
depends on message text. Everything the SDK raises extends `KoolbaseError`.

### Raised by any subsystem

| Error | When |
|---|---|
| `KoolbaseUnauthenticatedError` | The server would not accept the caller's credentials (401) — expired session, revoked key, or none at all; it does not distinguish. A session stops working for the whole SDK at once, so this comes from database, storage, Functions and background sync alike. **The user is already signed out by the time you catch it** — route to login rather than retrying. |
| `KoolbaseOfflineBaselineUnavailableError` | An offline update or delete could not be queued: the record has never been seen on this device, so there is nothing to apply the change against. |

`KoolbasePermissionError` (403) is different: the credentials *were* accepted and
this caller may not proceed. Nobody is signed out — doing so for opening the
wrong record would be worse than the failure itself.

### Database

| Error | When |
|---|---|
| `KoolbaseConflictError` | A write violates a unique constraint (409). `.field` names the collision when the server reports it. |
| `KoolbaseNotFoundError` | The record or collection does not exist (404). |
| `KoolbaseValidationError` | The request was rejected as invalid (400). |
| `KoolbasePermissionError` | An access rule denied the operation (403). |
| `KoolbaseRateLimitError` | The caller is being rate-limited (429). |
| `KoolbaseVectorDimensionMismatchError` | A vector's length does not match the field's declared dimension. |

```typescript
import {
  KoolbaseConflictError,
  KoolbaseDataError,
  KoolbaseUnauthenticatedError,
} from '@koolbase/react-native';

try {
  await Koolbase.db.upsert('users', { email }, { name });
} catch (e) {
  if (e instanceof KoolbaseUnauthenticatedError) {
    goToLogin();                     // already signed out
  } else if (e instanceof KoolbaseConflictError) {
    showError(`That ${e.field ?? 'value'} is already taken.`);
  } else if (e instanceof KoolbaseDataError) {
    showError(e.message);
  }
}
```

> `insert`, `update`, and `delete` queue when the network is unreachable, but
> they still throw. A server that answered has refused, and that is surfaced
> rather than queued, since it would be refused again on every retry.
>
> What does not throw is a write refused during replay, hours after it was made:
> nobody is waiting on it, so it becomes a conflict you read from
> `Koolbase.db.conflicts()`.

### Storage

| Error | When |
|---|---|
| `KoolbaseStorageConflictError` | The path is taken and `overwrite` is false (409). `.path` names it. |
| `KoolbaseStorageNotFoundError` | The bucket or object does not exist (404). |
| `KoolbaseStorageValidationError` | Bad path or missing field (400). |
| `KoolbaseStoragePermissionError` | The caller may not perform the operation (403). |
| `KoolbaseStorageQuotaError` | The upload would exceed the bucket's total size cap. |
| `KoolbaseStorageFileTooLargeError` | The file exceeds the bucket's per-file cap. |
| `KoolbaseStorageMimeTypeError` | The content type is not in the bucket's allowlist. |
| `KoolbaseStorageMetadataInvalidError` | Object metadata failed validation. `.detail` names the key and rule. |

### Auth

`InvalidCredentialsError`, `EmailAlreadyInUseError`, `UserDisabledError`,
`WeakPasswordError`, `SessionExpiredError`, `TokenRevokedError`,
`AccountLockedError` (with `lockedUntil`), `UnlockTokenInvalidError`,
`RateLimitError`, `NetworkError`, plus the OAuth family
(`AppleSignInNotConfiguredError`, `InvalidAppleTokenError`,
`GoogleSignInNotConfiguredError`, `InvalidGoogleTokenError`,
`OAuthEmailConflictError`) and the phone family (`InvalidPhoneNumberError`,
`OtpExpiredError`, `OtpInvalidError`, `OtpMaxAttemptsError`,
`OtpRateLimitError`, `PhoneAlreadyLinkedError`, `SmsConfigMissingError`). All
extend `KoolbaseAuthError`.

---

## What's included

- Authentication: email and password, Apple, Google, phone + OTP, persistent
  sessions, auth state listener
- Database with populate for related records, atomic batches, upsert and bulk
  delete
- Offline-first cache, a durable write queue with baselines, and conflicts you
  resolve four ways
- Semantic, lexical and hybrid search over vectors, with server-side embedding
- Storage with presigned uploads, safe-by-default conflicts, bucket limits,
  image transforms, and object versioning
- Realtime subscriptions over WebSocket with backoff
- Functions with the caller's identity forwarded automatically
- Feature flags and remote config
- Version enforcement
- Logic engine — conditional flows as data
- Analytics — DAU, WAU, MAU, funnels, retention
- Cloud messaging — device token registration
- TypeScript-native with full type definitions

---

## Documentation

Full documentation at [docs.koolbase.com](https://docs.koolbase.com)

## Dashboard

Manage your projects at [app.koolbase.com](https://app.koolbase.com)

## Support

- [GitHub Issues](https://github.com/koolbase/koolbase-react-native/issues)
- [docs.koolbase.com](https://docs.koolbase.com)
- Email: <dev@koolbase.com>

## License

MIT
