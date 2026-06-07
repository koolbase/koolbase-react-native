# @techfinityedge/koolbase-react-native

[![npm](https://img.shields.io/npm/v/@techfinityedge/koolbase-react-native.svg)](https://www.npmjs.com/package/@techfinityedge/koolbase-react-native)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)

React Native SDK for [Koolbase](https://koolbase.com) — Backend as a Service built for mobile developers.

Auth, database, storage, realtime, functions, feature flags, remote config, version enforcement, code push, logic engine, analytics, and cloud messaging — one SDK, one `initialize()` call.

---

## Get started in 2 minutes

1. Create a free account at [app.koolbase.com](https://app.koolbase.com)
2. Create a project and copy your public key from Environments
3. Add the SDK:

```bash
   npm install @techfinityedge/koolbase-react-native
   # or
   yarn add @techfinityedge/koolbase-react-native
   # or
   pnpm add @techfinityedge/koolbase-react-native
   # or
   bun add @techfinityedge/koolbase-react-native
```

4. Initialize at app startup:

```typescript
   import { Koolbase } from '@techfinityedge/koolbase-react-native';

   await Koolbase.initialize({
     publicKey: 'pk_live_xxxx',
     baseUrl: 'https://api.koolbase.com',
   });
```

That's it. Every feature below is now available via `Koolbase.*`.

---

> **Auth is automatic (v3+).** Database, storage, and functions calls
> authenticate as the currently signed-in user — nothing to pass, no manual
> wiring. Log in (or restore a session) and every request carries that
> identity. `owner`/`authenticated` collections require an active session.

---

## Authentication

Email + password, Apple Sign-In, Google Sign-In, and phone + OTP — out of the box.

```typescript
// Register
await Koolbase.auth.register({ email: 'user@example.com', password: 'password' });

// Login
const session = await Koolbase.auth.login({ email: 'user@example.com', password: 'password' });

// Current user
const me = Koolbase.auth.currentUser;

// Logout
await Koolbase.auth.logout();

// Password reset
await Koolbase.auth.forgotPassword('user@example.com');

// Listen to auth state changes (fires immediately with current state)
const unsubscribe = Koolbase.auth.onAuthStateChange((user) => {
  console.log(user ? 'signed in' : 'signed out');
});
```

---

### OAuth — Apple

Apple Sign-In uses the native authentication flow via `@invertase/react-native-apple-authentication` as a peer dependency:

```typescript
import appleAuth from '@invertase/react-native-apple-authentication';
import { Koolbase } from '@techfinityedge/koolbase-react-native';

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

Configure Apple Sign-In for your environment with your iOS app's Bundle ID. Full setup guide at [docs.koolbase.com/auth/oauth](https://docs.koolbase.com/auth/oauth).

---

### OAuth — Google

Google Sign-In uses the native authentication flow via `@react-native-google-signin/google-signin` as a peer dependency:

```typescript
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { Koolbase } from '@techfinityedge/koolbase-react-native';

GoogleSignin.configure({
  webClientId: '<your-web-client-id>.apps.googleusercontent.com',
});

const userInfo = await GoogleSignin.signIn();

const session = await Koolbase.auth.signInWithGoogle({
  idToken: userInfo.idToken!,
});
```

Configure Google Sign-In for your environment with the OAuth client IDs from Google Cloud Console (typically one each for iOS, Android, and web). Full setup guide at [docs.koolbase.com/auth/oauth](https://docs.koolbase.com/auth/oauth).

---

### Phone + OTP

```typescript
// Send a one-time code
await Koolbase.auth.sendOtp({ phoneNumber: '+233200000000' });

// Verify and sign in
await Koolbase.auth.verifyOtp({
  phoneNumber: '+233200000000',
  code: '123456',
});

// Or link a phone to an existing account
await Koolbase.auth.linkPhone({
  phoneNumber: '+233200000000',
  code: '123456',
});
```

Configure your SMS provider (Twilio, Africa's Talking, or Hubtel) in the dashboard under Phone Auth.

---

## Database

```typescript
// Insert
await Koolbase.db.insert('posts', { title: 'Hello', published: true });

// Query
const { records } = await Koolbase.db.query('posts', {
  filters: { published: true },
  limit: 10,
  orderBy: 'created_at',
  orderDesc: true,
});

// Read fields off a record
const post = records[0];
console.log(post.data.title);          // your fields live under .data
console.log(post.id, post.collection); // metadata

// Populate related records
const { records: postsWithAuthor } = await Koolbase.db.query('posts', {
  populate: ['author_id:users'],
});

// Update / Delete
await Koolbase.db.update('record-id', { title: 'Updated' });
await Koolbase.db.delete('record-id');
```

---

### Handling unique-constraint conflicts

A write that would violate a unique constraint throws `KoolbaseConflictError`:

```ts
try {
  await Koolbase.db.upsert('users', { email }, { name });
} catch (e) {
  if (e instanceof KoolbaseConflictError) {
    showError('That email is already registered.');
  }
}
```

---

### Public bucket URLs

For files in public buckets, you can construct the stable CDN URL directly — no
network call, no expiry, embeddable anywhere a browser fetches a URL.

```typescript
import { KoolbaseStorage } from '@techfinityedge/koolbase-react-native';

// From a KoolbaseObject you already have (e.g. from upload() or another read)
const { object } = await Koolbase.storage.upload({
  bucket: 'avatars',
  path: `user-${userId}.jpg`,
  file: { uri: imageUri, name: 'avatar.jpg', type: 'image/jpeg' },
});

const url = KoolbaseStorage.publicUrlForObject(object, 'avatars');
// url is null for private-bucket objects; the CDN URL for public-bucket ones.

if (url) {
  // Safe to use — file lives in the public R2 bucket
  return <Image source={{ uri: url }} />;
}

// For build-time URL construction (no Object on hand)
const url = KoolbaseStorage.publicUrl({
  projectId: 'proj_abc',
  bucket: 'avatars',
  path: 'user-123.jpg',
});
// Always returns the URL pattern; caller is responsible for knowing
// the file lives in a public bucket. For files in private buckets,
// the resulting URL will 404.
```

URLs follow the pattern `https://cdn.koolbase.com/{project_id}/{bucket}/{path}` — long-lived, edge-cached, no authentication. For files in private buckets, use `getDownloadUrl` instead, which returns a 1-hour presigned URL.

---

### Image transforms

Public bucket URLs can be transformed at the edge — resize, reformat,
optimize — without any preprocessing. Two ways:

**Direct transforms** — pass a `transform` option to `publicUrl`:

```ts
const url = KoolbaseStorage.publicUrl({
  projectId: 'proj_abc',
  bucket: 'avatars',
  path: 'user-123.jpg',
  transform: {
    width: 200,
    height: 200,
    fit: 'cover',
    format: 'auto',
    quality: 85,
  },
});
```

**Named presets** — store an option set server-side (via the dashboard or
REST API), reference it by name:

```ts
const url = KoolbaseStorage.publicUrlWithPreset({
  projectId: 'proj_abc',
  presetName: 'thumbnail',
  bucket: 'avatars',
  path: 'user-123.jpg',
});

// Or from a KoolbaseObject instance:
const url = KoolbaseStorage.publicUrlForObjectWithPreset(object, 'avatars', 'thumbnail');
```

Available options: `width` and `height` (1–2000), `format`
(`auto`/`webp`/`avif`/`jpeg`/`png`), `quality` (1–100), `fit`
(`scale-down`/`contain`/`cover`/`crop`/`pad`), `dpr` (1–3), `gravity`
(`auto`/`center`/`top`/`bottom`/`left`/`right`/`top-left`/`top-right`/
`bottom-left`/`bottom-right`). Transformed responses are edge-cached for 4
hours; Cloudflare includes 5,000 unique transformations/month free per
account.

See the [Image Transforms docs](https://docs.koolbase.com/storage/image-transforms)
for the full reference.

---

### Upsert

Insert a record, or update the existing one matching a filter.

```ts
const result = await Koolbase.db.upsert(
  'profiles',
  { user_id: userId },
  { weightKg: 70 }
);

console.log(result.created); // true if inserted, false if updated
console.log(result.record.id);
```

> Online-only: needs the server's view to decide insert vs update, so unlike
> `insert` it isn't queued offline and throws on network failure.

### Delete where

Bulk-delete every record matching a filter. Returns the number deleted.

```ts
const deleted = await Koolbase.db.deleteWhere('sessions', {
  user_id: userId,
  status: 'expired',
});
```

> A non-empty filter is required. The collection's delete rule applies; for
> `owner`/`scoped` rules the delete is scoped to your own records. Online-only.

---

### Offline-first

```typescript
const { records, isFromCache } = await Koolbase.db.query('posts', { limit: 20 });
if (isFromCache) console.log('Served from local cache');

await Koolbase.db.syncPendingWrites();
```

---

### Atomic batch writes

Run multiple writes in a single server-side transaction. All operations commit together or none are applied — any failure rolls back the entire batch.

```ts
import { Koolbase, BatchOp } from '@techfinityedge/koolbase-react-native';

const results = await Koolbase.db.batch([
  BatchOp.insert('orders', { total: 50, customer_id: customerId }),
  BatchOp.update(inventoryId, { stock: 9 }),
  BatchOp.upsert('counters', {
    match: { name: 'orders' },
    data: { value: 1 },
  }),
  BatchOp.delete(cartItemId),
]);

// results[i] corresponds to operations[i]:
//   - insert / update: { type, record }
//   - upsert:          { type, record, created }   // created = true if inserted
//   - delete:          { type, deleted: true }
```

**Online-only by design.** Atomicity needs the server's authoritative view, so `batch()` is never queued offline — it throws on network failure (like `upsert` and `deleteWhere`). A server-side rejection throws a `KoolbaseDataError` with the failing operation's details; nothing was persisted.

---

### Handling write conflicts

`insert`, `update`, and `upsert` are online-first: when the server is reachable they throw a typed error on rejection. Catch `KoolbaseConflictError` to handle unique-constraint violations (e.g. a duplicate email):

```ts
import { KoolbaseConflictError } from '@techfinityedge/koolbase-react-native';

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

When the device is offline, these writes are queued and synced automatically when connectivity returns.

---

### Semantic search

Find records by meaning, not just field equality. Two paths: let Koolbase
embed text for you on the server (recommended — no client-side model
needed), or pass a precomputed vector.

Declare a vector field on the collection from the dashboard or CLI first
(picking a dimension; v1 supports 384, 768, 1024, and 1536).

**Server-side embedding (recommended).** Configure an AI provider on the
project once (Gemini's free tier works; OpenAI also supported), tag the
vector field with the provider/model/source_field, and Koolbase
auto-embeds records as they're inserted or updated:

```typescript
// One-time setup via dashboard. Then just write records normally:
await Koolbase.db.insert({
  collection: 'articles',
  data: {
    title: 'How to ship faster',
    content: 'Cut scope ruthlessly. Ship the smallest useful slice...',
  },
});

// Query by text — server embeds inline using the configured provider:
const result = await Koolbase.db.searchSemantic({
  collection: 'articles',
  field: 'content_embedding',
  queryText: 'how do I move quicker?',
  limit: 10,
});
for (const hit of result.hits) {
  console.log(`${hit.record.data.title}  ${hit.distance.toFixed(3)}`);
}

// Backfill records that pre-date the auto-embed config:
await Koolbase.db.embedText({
  collection: 'articles',
  recordId: article.$id,
  vectorField: 'content_embedding',
});

// Or override the source — useful for combining fields:
await Koolbase.db.embedText({
  collection: 'articles',
  recordId: article.$id,
  vectorField: 'content_embedding',
  text: `${article.title}\n\n${article.summary}`,
});
```

**Client-side embedding (advanced).** If you'd rather control the
embedding model yourself, pass a vector instead of text:

```typescript
// Set a vector you've encoded yourself
await Koolbase.db.setVector(
  articleId,
  'embedding',
  await myEmbeddingModel.encode(article.content),
);

// Read it back
const v = await Koolbase.db.getVector(articleId, 'embedding');
console.log(`${v.vector.length}-dim, updated ${v.updatedAt}`);

// Search with a precomputed vector
const result = await Koolbase.db.searchSemantic({
  collection: 'articles',
  field: 'embedding',
  queryVector: await myEmbeddingModel.encode(userQuery),
  limit: 10,
  where: { category: 'tech' },
});

// Remove a record's vector when no longer needed
await Koolbase.db.deleteVector(articleId, 'embedding');
```

A few behaviors worth knowing:

- **Pass exactly one of `queryVector` or `queryText`.** Supplying both
  or neither throws an `Error`.
- **Vector length must match the declared dimension.** Mismatches throw
  `KoolbaseVectorDimensionMismatchError`.
- **Online-only.** Vector operations are not cached locally or queued
  offline — HNSW similarity search has no useful offline semantics.
- **Read rule applies post-search.** `owner`/`scoped`/`conditional`
  records are filtered to the caller after the HNSW lookup, so strict
  rules may return fewer than `limit` results.
- **`embedText` is async.** Returns when the job is queued (~100ms).
  The vector lands within 1 second once the worker picks it up.
- **Higher dimensions coming.** `text-embedding-3-large` (3072 dim)
  supported once pgvector is upgraded. Use `dimensions=1536` Matryoshka
  truncation in the meantime.

See [Semantic search docs](https://docs.koolbase.com/database/vectors)
for setup, provider configuration, and embedding model recommendations.

---

## Storage

Upload and serve files via presigned URLs to Cloudflare R2. Uploads are
**safe-by-default** (v5+) — uploading to a path that's already taken throws
`KoolbaseStorageConflictError` instead of silently replacing the existing
file. Pass `overwrite: true` for true upsert semantics.

```typescript
// Upload — rejects if `user-${userId}.jpg` already exists
const { object, downloadUrl } = await Koolbase.storage.upload({
  bucket: 'avatars',
  path: `user-${userId}.jpg`,
  file: { uri: imageUri, name: 'avatar.jpg', type: 'image/jpeg' },
});

// Upload — silently replaces any existing object at this path
await Koolbase.storage.upload({
  bucket: 'avatars',
  path: `user-${userId}.jpg`,
  file: { uri: imageUri, name: 'avatar.jpg', type: 'image/jpeg' },
  overwrite: true,
});

// Get download URL
const url = await Koolbase.storage.getDownloadUrl('avatars', `user-${userId}.jpg`);

// Delete
await Koolbase.storage.delete('avatars', `user-${userId}.jpg`);
```

---

### Handling upload conflicts

For user-supplied filenames, prompt the user before overwriting:

```typescript
import { KoolbaseStorageConflictError } from '@techfinityedge/koolbase-react-native';

try {
  await Koolbase.storage.upload({
    bucket: 'documents',
    path: filename,
    file: { uri, name: filename, type: mimeType },
  });
} catch (e) catch (e) {
if (e instanceof KoolbaseStorageConflictError) {
const ok = await confirm(${e.path} already exists. Overwrite?);
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

See [Error handling](#error-handling) for the full set of storage errors.

---

### Handling bucket limits

Buckets can be configured at creation time with a total size cap
(`max_size_bytes`), a per-file cap (`max_file_size_bytes`), and a
content-type allowlist (`allowed_mime_types`, supports `image/*`-style
wildcards). The server surfaces violations as typed errors:

````typescript
import {
  KoolbaseStorageQuotaError,
  KoolbaseStorageFileTooLargeError,
  KoolbaseStorageMimeTypeError,
} from '@techfinityedge/koolbase-react-native';

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
````

MIME enforcement runs at presign time — no bytes are transferred before
rejection. File-size and quota enforcement run at confirm time; the
server cleans up the underlying R2 object before returning the error,
so nothing leaks.

---

### Object versioning

For buckets with versioning enabled, every overwrite preserves the prior
content as a history version, and deletes are soft (recoverable until
force-purged). Enable versioning on a bucket from the dashboard.

```typescript
// List all versions of a path, newest first
const versions = await Koolbase.storage.listVersions('documents', 'contract.pdf');

for (const v of versions) {
  console.log(`${v.versionId}: size=${v.size} isCurrent=${v.isCurrent}`);
}

// Download a specific historical version
const url = await Koolbase.storage.getDownloadUrl(
  'documents',
  'contract.pdf',
  '019e98ed-eed6-7e71-...',
);

// Bring a history version back as current
// (the existing current is snapshotted to history first)
const restored = await Koolbase.storage.restoreVersion(
  'documents',
  'contract.pdf',
  '019e98ed-eed6-7e71-...',
);

// Hard-remove a single history version (row + R2 bytes)
await Koolbase.storage.purgeVersion(
  'documents',
  'contract.pdf',
  'old-version-id',
);

// Wipe the entire timeline for a path - every version, every R2 key
await Koolbase.storage.delete('documents', 'contract.pdf', true);
```

A few behaviors worth knowing:

- **Overwrite snapshots automatically.** Upload to a path that already
  exists in a versioned bucket and the prior bytes are preserved as
  history; the upload becomes the new current.
- **Delete is soft by default.** On a versioned bucket, `delete`
  snapshots the current content and records a delete marker. The
  content is still recoverable via `restoreVersion` until force-purged.
- **Restore is itself a versioned event.** The previously-current row
  gets snapshotted before the target's bytes overwrite canonical. The
  restored row gets a fresh `versionId`; the target stays in history at
  its original id - so you can always undo a restore.
- **Delete markers can be listed but not downloaded.** A marker has
  `size === 0`, `isDeleteMarker === true`, and no bytes. Calling
  `getDownloadUrl` with a marker's `versionId` throws.

---

## Realtime

Subscribe to live changes on a collection. Uses the signed-in user's session, so
subscribe after login. Streams `created`, `updated`, and `deleted` events for
collections whose read rule is `public` or `authenticated`.

```ts
const unsubscribe = Koolbase.realtime.subscribe('messages', (event) => {
  // event.type -> 'created' | 'updated' | 'deleted'
  if (event.type === 'deleted') {
    console.log('deleted', event.recordId);   // recordId on deletes
  } else {
    console.log(event.type, event.record!.data); // record on created/updated
  }
});

unsubscribe();
```

The socket opens lazily, is shared, and reconnects automatically. The project is
taken from the user's session.

---

## Functions

Invoke deployed serverless functions. When a user is signed in via `Koolbase.auth`, their access token is automatically forwarded — the function receives the caller's identity via `ctx.auth`. No token handling on the client side.

```typescript
// Invoke a deployed function
const result = await Koolbase.functions.invoke('send-welcome-email', {
  userId: '123',
});
if (result.success) console.log(result.data);
```

Inside the function, read the caller:

```typescript
export async function handler(ctx) {
  const userId = ctx.auth?.user_id;
  if (!userId) {
    return { error: { code: 'AUTH_REQUIRED' }, status: 401 };
  }
  // Authenticated logic here
  return { ok: true };
}
```

Token refresh is transparent — the SDK reads the current token fresh on every invoke. Full docs at [docs.koolbase.com/functions/authentication](https://docs.koolbase.com/functions/authentication).

---

## Feature Flags & Remote Config

```typescript
if (Koolbase.isEnabled('new_checkout')) { /* ... */ }

const timeout = Koolbase.configNumber('timeout_seconds', 30);
const apiUrl = Koolbase.configString('api_url', 'https://api.myapp.com');
const dark = Koolbase.configBool('force_dark_mode', false);
```

---

## Version Enforcement

```typescript
const result = Koolbase.checkVersion('1.2.3');
if (result.status === 'force_update') {
  // block and show update screen
}
```

---

## Code Push

Push config overrides, feature flag overrides, and directive-driven behaviour without a store release.

```typescript
await Koolbase.initialize({
  publicKey: 'pk_live_xxxx',
  baseUrl: 'https://api.koolbase.com',
  codePushChannel: 'stable',
});

// Bundle values override Remote Config + Feature Flags transparently
const timeout = Koolbase.configNumber('api_timeout_ms', 3000);

// Directive handlers
Koolbase.codePush.onDirective('force_logout_all', (value) => {
  if (value) Koolbase.auth.logout();
});
Koolbase.codePush.applyDirectives();
```

---

### Mandatory updates

Mark a bundle **mandatory** in the dashboard (or via `PATCH /mandatory`) when every device must apply it before continuing — surfaced as a push callback and a pollable flag:

```typescript
await Koolbase.initialize({
  publicKey: 'pk_live_xxxx',
  baseUrl: 'https://api.koolbase.com',
  // Fires the moment a mandatory bundle is staged for the next launch
  onMandatoryUpdate: ({ version }) => {
    showRestartRequiredDialog(version);
  },
});

// Or poll it — e.g. on app resume — before letting the user proceed
if (Koolbase.codePush.hasMandatoryUpdate) {
  showRestartRequiredDialog();
}
```

A mandatory bundle still activates on the next cold launch like any other; the callback and flag just let you prompt the user to restart now instead of waiting.

---

## Logic Engine

Define conditional app behavior as data in your Runtime Bundle — no code changes required.

```typescript
const result = Koolbase.executeFlow('on_checkout_tap', {
  plan: user.plan,
  usage: user.usage,
});

if (result.hasEvent) {
  switch (result.eventName) {
    case 'show_upgrade': navigation.navigate('Upgrade'); break;
    case 'go_checkout': navigation.navigate('Checkout'); break;
  }
}
```

**v2 operators:** `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `starts_with`, `ends_with`, `in_list`, `not_in_list`, `between`, `is_true`, `is_false`, `exists`, `not_exists`, `and`, `or`

Full docs at [docs.koolbase.com/sdk/logic-engine](https://docs.koolbase.com/sdk/logic-engine).

---

## Analytics

Track screen views, custom events, and user behaviour. View DAU, WAU, MAU, funnels, and retention in the Koolbase dashboard.

```typescript
await Koolbase.initialize({
  publicKey: 'pk_live_xxxx',
  baseUrl: 'https://api.koolbase.com',
  analyticsEnabled: true,
  appVersion: '1.0.0',
});

// Custom events
Koolbase.analytics.track('purchase', { value: 1200, currency: 'GHS' });

// Screen views
Koolbase.analytics.screenView('checkout');

// User identity
Koolbase.analytics.identify(user.id);
Koolbase.analytics.setUserProperty('plan', 'pro');

// On logout
Koolbase.analytics.reset();
```

---

## Cloud Messaging

```typescript
await Koolbase.initialize({
  publicKey: 'pk_live_xxxx',
  baseUrl: 'https://api.koolbase.com',
  messagingEnabled: true,
});

// Register FCM token (after obtaining from @react-native-firebase/messaging)
const fcmToken = await messaging().getToken();
await Koolbase.messaging.registerToken({
  token: fcmToken,
  platform: 'android', // or 'ios'
});

// Send to a specific device
await Koolbase.messaging.send({
  to: deviceToken,
  title: 'Your order is ready',
  body: 'Pick up at counter 3',
  data: { order_id: '123' },
});
```

---

## Error handling

Koolbase throws typed errors selected from the server's stable error `code`, so
handling doesn't depend on message text.

### Database errors

All data-layer failures extend `KoolbaseDataError` (which extends `Error`):

| Error | When |
|---|---|
| `KoolbaseConflictError` | A write violates a unique constraint (409). Exposes `.field` — the field that collided, when the server reports it. |
| `KoolbaseNotFoundError` | The record or collection doesn't exist (404). |
| `KoolbaseValidationError` | The request was rejected as invalid (400). |
| `KoolbasePermissionError` | An access rule denied the operation (403). |
| `KoolbaseRateLimitError` | The caller is being rate-limited (429). |
| `KoolbaseVectorDimensionMismatchError` | A vector's length doesn't match the field's declared dimension (400, code `vector_dimension_mismatch`). |

```ts
import { KoolbaseConflictError, KoolbaseDataError } from '@techfinityedge/koolbase-react-native';

try {
  await Koolbase.db.upsert('users', { email }, { name });
} catch (e) {
  if (e instanceof KoolbaseConflictError) {
    showError(`That ${e.field ?? 'value'} is already taken.`);
  } else if (e instanceof KoolbaseDataError) {
    showError(e.message);
  }
}
```

> `query`, `get`, `upsert`, and `deleteWhere` throw these typed errors. `insert`,
> `update`, and `delete` are optimistic/offline-first — they queue and sync in
> the background, so their conflicts surface via the sync engine, not as a
> thrown error.

---

### Storage errors

All storage failures extend `KoolbaseStorageError` (which extends `Error`):

| Error | When |
|---|---|
| `KoolbaseStorageConflictError` | An upload targets a path that's already taken and `overwrite: false` (409, code `PATH_CONFLICT`). Exposes `.path` — the colliding path. |
| `KoolbaseStorageNotFoundError` | The bucket or object doesn't exist (404). |
| `KoolbaseStorageValidationError` | The request was rejected as invalid — bad path, missing field (400). |
| `KoolbaseStoragePermissionError` | The caller is not allowed to perform the operation (403). |

```ts
import {
  KoolbaseStorageConflictError,
  KoolbaseStorageError,
  KoolbaseStoragePermissionError,
} from '@techfinityedge/koolbase-react-native';

try {
  await Koolbase.storage.upload({
    bucket: 'avatars',
    path: 'me.png',
    file: { uri, name: 'me.png', type: 'image/png' },
  });
} catch (e) {
  if (e instanceof KoolbaseStorageConflictError) {
    // Already exists — prompt user to confirm overwrite
    promptOverwrite(e.path);
  } else if (e instanceof KoolbaseStoragePermissionError) {
    showError('You do not have permission to upload here.');
  } else if (e instanceof KoolbaseStorageError) {
    // Catch-all for any other storage error
    showError(e.message);
  } else {
    throw e;
  }
}
```

---

## What's included

- Authentication: email + password, Apple Sign-In, Google Sign-In, phone + OTP
- Database with offline-first cache, realtime subscriptions, populate for related records, semantic search over vectors
- Storage with presigned uploads and downloads, safe-by-default conflict handling, image transforms, object versioning (history + restore + soft-delete)
- Realtime subscriptions over WebSocket
- Authenticated functions (`ctx.auth` exposes the caller automatically)
- Feature flags and remote config
- Version enforcement
- Code push (config + flag overrides + directives, no store release)
- Logic engine (conditional flows as data, updatable OTA)
- Analytics (DAU/WAU/MAU, funnels, retention)
- Cloud Messaging (FCM token registration, targeted send, broadcast)
- TypeScript-native with full type definitions

---

## Documentation

Full documentation at [docs.koolbase.com](https://docs.koolbase.com)

## Dashboard

Manage your projects at [app.koolbase.com](https://app.koolbase.com)

## Support

- [GitHub Issues](https://github.com/kennedyowusu/koolbase-react-native/issues)
- [docs.koolbase.com](https://docs.koolbase.com)
- Email: <hello@koolbase.com>

## License

MIT
