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
npm install @techfinityedge/koolbase-react-native@^3.0.0
# or
yarn add @techfinityedge/koolbase-react-native@^3.0.0
```

**4. Initialize at app startup:**

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

### Phone + OTP

```typescript
// Send a one-time code
await Koolbase.auth.sendOtp({ phoneE164: '+233200000000' });

// Verify and sign in
await Koolbase.auth.verifyOtp({
  phoneE164: '+233200000000',
  code: '123456',
});

// Or link a phone to an existing account
await Koolbase.auth.linkPhone({
  phoneE164: '+233200000000',
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

### Handling unique-constraint conflicts

  A write that would violate a unique constraint throws `KoolbaseConflictError`:

  \`\`\`ts
  try {
    await koolbase.db.upsert('users', { email }, { name });
  } catch (e) {
    if (e instanceof KoolbaseConflictError) {
      showError('That email is already registered.');
    }
  }
  \`\`\`

### Upsert

Insert a record, or update the existing one matching a filter.

\`\`\`ts
const result = await Koolbase.db.upsert(
  'profiles',
  { user_id: userId },
  { weightKg: 70 }
);

console.log(result.created); // true if inserted, false if updated
console.log(result.record.id);
\`\`\`

> Online-only: needs the server's view to decide insert vs update, so unlike
> `insert` it isn't queued offline and throws on network failure.

### Delete where

Bulk-delete every record matching a filter. Returns the number deleted.

\`\`\`ts
const deleted = await Koolbase.db.deleteWhere('sessions', {
  user_id: userId,
  status: 'expired',
});
\`\`\`

> A non-empty filter is required. The collection's delete rule applies; for
> `owner`/`scoped` rules the delete is scoped to your own records. Online-only.

### Offline-first

```typescript
const { records, isFromCache } = await Koolbase.db.query('posts', { limit: 20 });
if (isFromCache) console.log('Served from local cache');

await Koolbase.db.syncPendingWrites();
```

---

## Storage

```typescript
const { url } = await Koolbase.storage.upload({
  bucket: 'avatars',
  path: `user-${userId}.jpg`,
  file: { uri: imageUri, name: 'avatar.jpg', type: 'image/jpeg' },
});

const downloadUrl = await Koolbase.storage.getDownloadUrl('avatars', `user-${userId}.jpg`);

await Koolbase.storage.delete('avatars', `user-${userId}.jpg`);
```

---

## Realtime

```typescript
const unsubscribe = Koolbase.realtime.subscribe('messages', (event) => {
  if (event.type === 'created') setMessages(prev => [event.record, ...prev]);
});

// Cleanup
unsubscribe();
```

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
| `KoolbaseConflictError` | A write violates a unique constraint (409). Exposes `.field`. |
| `KoolbaseNotFoundError` | The record or collection doesn't exist (404). |
| `KoolbaseValidationError` | The request was rejected as invalid (400). |
| `KoolbasePermissionError` | An access rule denied the operation (403). |
| `KoolbaseRateLimitError` | The caller is being rate-limited (429). |

```ts
import { KoolbaseConflictError, KoolbaseDataError } from '@techfinityedge/koolbase-react-native';

try {
  await koolbase.db.upsert('users', { email }, { name });
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

## What's included

- Authentication: email + password, Apple Sign-In, Google Sign-In, phone + OTP
- Database with offline-first cache, realtime subscriptions, and populate
- Storage with download URLs
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
