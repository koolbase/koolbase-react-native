# Changelog

All notable changes to `@techfinityedge/koolbase-react-native` are documented
in this file. The format is based on [Keep a Changelog][kac], and this project
adheres to [Semantic Versioning][semver].

[kac]: https://keepachangelog.com/en/1.1.0/
[semver]: https://semver.org/

## 2.0.0 — 2026-05-22

### Breaking

- **Flat record shape.** Records are no longer wrapped in a `data` envelope on
  the wire — your fields come back top-level, with system metadata in a reserved
  `$`-prefixed namespace (`$id`, `$createdAt`, `$updatedAt`, `$collection`,
  `$createdBy`). The SDK maps this back into `KoolbaseRecord`, so you still read
  fields via `record.data.<field>`.
- Removed `KoolbaseRecord.projectId` and `KoolbaseRecord.collectionId`.
- Requires a Koolbase server on the flat record contract (shipped alongside this
  release). Older servers return the legacy envelope and are not compatible.

### Added

- `KoolbaseRecord.collection` — the record's collection name.

### Fixed

- `KoolbaseRecord.createdAt` / `updatedAt` are now reliably populated. Under the
  previous raw cast they were silently `undefined` (snake_case wire vs camelCase).

### Changed

- Realtime events and populated/related records now use the same flat shape.
- Offline cache is forward-compatible: existing entries stay readable (`id` and
  `data` are shape-stable) and refresh to the new shape on the next online read;
  pending offline writes are preserved.

## 1.11.0 — 2026-05-19

### Added

- **Sign in with Google** — production-ready end-user OAuth via
  `Koolbase.auth.signInWithGoogle({idToken, nonce?})`. Routes to the
  server endpoint at `/v1/sdk/auth/oauth/google` with RS256-only JWKS
  verification against Google's certs endpoint, multi-audience support
  (iOS / Android / web client IDs configured per environment),
  15-minute replay defense, and optional nonce check.
- `SignInWithGoogleParams` interface in `types.ts`.
- Three new typed errors in `auth-errors.ts`:
  `GoogleSignInNotConfiguredError`, `InvalidGoogleTokenError`,
  `GoogleEmailRequiredError`. Reuses existing `OAuthEmailConflictError`
  and `UserDisabledError`.

#### Example with `@react-native-google-signin/google-signin`

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

### Auto-link policy

Same as Apple Sign-In (v1.10.0). A new Google identity attaches to an
existing user only when BOTH the Google email AND the existing user's
email are verified, AND emails match (case-insensitive). Otherwise
sign-in either creates a new user (no email collision) or surfaces
`OAuthEmailConflictError`.

### Configuration required

Before users can sign in with Google, configure the provider for your
environment with the OAuth client IDs from Google Cloud Console (one
each for iOS, Android, and web). See the README for the SQL setup.

### Coming next

- **Dashboard UI** for OAuth config — replaces the SQL workflow

## 1.10.1 — 2026-05-19

### Documentation

- README rewritten to accurately reflect the v1.10.0 SDK surface. No SDK
  code changes; this release exists to refresh the README rendered on the
  npmjs.com package page.
- Removed fictional `Koolbase.auth.signInWithGoogle` reference. Google
  Sign-In is planned for v1.11.0 — noted explicitly in the OAuth section.
- Replaced the deprecated `KoolbaseAppleAuth.signIn(callback)` example
  with the new `Koolbase.auth.signInWithApple({identityToken, nonce?, fullName?})`
  v1.10.0 API using `@invertase/react-native-apple-authentication`.
- Added `Koolbase.auth.onAuthStateChange(listener)` example (v1.9.0 feature).
- Replaced the Firebase/Supabase comparison table with a Koolbase-only
  feature inventory.
- Bumped install snippet from `^1.8.0` to `^1.10.0`.

## 1.10.0 — 2026-05-19

### Added

- **Sign in with Apple** — production-ready end-user OAuth via
  `koolbase.auth.signInWithApple({identityToken, nonce?, fullName?})`.
  Routes to the new server endpoint at `/v1/sdk/auth/oauth/apple` with
  RS256-only JWKS verification, audience bound to your project's iOS
  Bundle ID, 15-minute replay defense, and optional nonce check.
- `AppleFullName` interface and `SignInWithAppleParams` interface in
  `types.ts`.
- Four new typed errors in `auth-errors.ts`:
  `AppleSignInNotConfiguredError`, `InvalidAppleTokenError`,
  `AppleEmailRequiredError`, `OAuthEmailConflictError`.

#### Example with `@invertase/react-native-apple-authentication`

```typescript
import appleAuth from '@invertase/react-native-apple-authentication';

// Get credential from native Apple Sign-In
const appleResponse = await appleAuth.performRequest({
  requestedOperation: appleAuth.Operation.LOGIN,
  requestedScopes: [appleAuth.Scope.EMAIL, appleAuth.Scope.FULL_NAME],
});

// Pass to Koolbase
const session = await koolbase.auth.signInWithApple({
  identityToken: appleResponse.identityToken!,
  nonce: appleResponse.nonce,
  fullName: appleResponse.fullName
    ? {
        givenName: appleResponse.fullName.givenName ?? undefined,
        familyName: appleResponse.fullName.familyName ?? undefined,
      }
    : undefined,
});
```

### Auto-link policy

A new Apple identity attaches to an existing user only when BOTH the
provider email AND the existing user's email are verified, AND emails
match (case-insensitive). Otherwise sign-in either creates a new user
(no email collision) or surfaces `OAuthEmailConflictError` — user signs
in with existing method, then links Apple from settings.

### Configuration required

Before users can sign in with Apple, configure the provider for your
environment via direct DB insert (dashboard UI lands in v1.10.x):

```sql
INSERT INTO project_oauth_configs (environment_id, provider, bundle_id, enabled)
VALUES ('<your-environment-id>', 'apple', 'com.yourapp.bundle', true);
```

The Bundle ID is the audience claim in identity tokens from native Apple
Sign-In and must match exactly.

### Still deprecated — `KoolbaseAppleAuth.signIn` and `oauthLogin`

These remain deprecated and throw `KoolbaseAuthError('not_implemented')`.
The v1.10.0 surface is `koolbase.auth.signInWithApple(...)` on the auth
instance — same place as all other auth methods.

### Coming next

- **Dashboard UI** for OAuth config (v1.10.x) — minimal Bundle-ID input,
  enable/disable toggle.
- **Google Sign-In** (v1.11.0) — same endpoint pattern at
  `/v1/sdk/auth/oauth/google`.
- **GitHub OAuth** (v1.12.0) — code-exchange flow.

## 1.9.0 — 2026-05-19

### 🚨 Fixed (critical)

v1.8.0 and earlier shipped with silent breakages on the SDK auth surface.
Anyone using `KoolbaseAuth` before v1.9.0 should upgrade immediately.

- **`x-api-key` header is now sent on every auth request.** Previously the
  SDK sent only `Content-Type`, causing the server's caller middleware to
  resolve every project-scoped call as anonymous — every `/v1/sdk/auth/*`
  endpoint returned 401.
- **Password reset endpoints were targeting wrong paths.** Both
  `forgotPassword` (was `/v1/sdk/auth/forgot-password`) and `resetPassword`
  (was `/v1/sdk/auth/reset-password`) silently 404'd on the server. Now
  corrected to `/password-reset` and `/password-reset/confirm`.
- **Session responses were not being mapped.** The server returns
  `access_token` / `refresh_token` / `expires_at` (snake_case); the SDK cast
  directly to camelCase types, so `session.accessToken` was `undefined` and
  the Authorization header silently sent `Bearer undefined`. Now mapped
  properly on every session-returning endpoint.
- **`register()` was discarding the session** the server returned; only the
  user object was kept. Now persists the full session.

### Added

- **Persistent sessions.** New `SecureAuthStorage` default backed by
  `react-native-keychain` (iOS Keychain + Android Keystore-backed
  encryption). The peer dependency is **optional** — apps without it
  installed see a clear warning and operate without persistence rather than
  crashing. Apps with custom requirements (Expo Go, compliance encryption,
  in-memory test mocks) can implement the `KoolbaseAuthStorage` interface
  and inject it via `KoolbaseConfig.authStorage`.
- **Offline-aware session restoration.** New `restoreSession()` method
  returning a `RestoreResult` enum:
  - `NoSession` → no persisted session, show login
  - `Restored` → ready, show authenticated UI
  - `Expired` → refresh token rejected, show login
  - `Offline` → network unreachable, optimistically authenticated

  Optimistic state is populated from disk *before* any network call, so
  authenticated UI renders immediately at app launch with no round-trip.
- **Auth state listener.** New `KoolbaseAuth.onAuthStateChange(listener)`
  API following the RN ecosystem convention (Firebase/Supabase style):
  fires immediately on subscribe with current state, then on every state
  change. Returns an unsubscribe function for cleanup.
- **Single-flight token refresh.** Concurrent callers hitting a stale token
  share one underlying refresh and receive the same result. Prevents the
  race where parallel refreshes each rotate the refresh token,
  invalidating peers mid-flight.
- **Typed error hierarchy.** 10 new typed errors for granular handling:
  `InvalidCredentialsError`, `EmailAlreadyInUseError`, `UserDisabledError`,
  `WeakPasswordError`, `SessionExpiredError`, `TokenRevokedError`,
  `AccountLockedError` (with forward-compatible `lockedUntil` field),
  `UnlockTokenInvalidError`, `RateLimitError`, `NetworkError`. All extend
  `KoolbaseAuthError` for generic catches.
- **Account unlock.** New `KoolbaseAuth.unlock(token)` method consumes the
  one-shot token from a brute-force unlock email and restores login access.
- **Device metadata.** Every auth request now carries seven identifying
  headers including a stable per-install UUID device label, SDK version,
  platform info, and app version. Helps server-side debugging and
  version-conditional logic.
- **Configurable timeout.** `KoolbaseConfig.authTimeout` (default 10000ms)
  sets a per-request timeout via `AbortController`.
- **Injectable fetch.** `KoolbaseConfig.fetch` accepts an alternate `fetch`
  implementation. Useful for testing (mock fetch), corporate proxies, or
  instrumented HTTP.
- **`koolbaseSdkVersion` constant** exported for runtime SDK version
  introspection.

### Changed

- **`logout()` returns `Promise<boolean>`** — `true` if the server-side
  logout call succeeded, `false` otherwise. Local session is always cleared
  regardless. Apps that don't care about the server signal can continue to
  ignore the return value.
- **`setSession()` is now async** (returns `Promise<void>`) so storage
  persistence completes before the call resolves. Source-compatible for
  callers that ignored the previous void return.
- **`register()` validates password length client-side** (must be ≥ 8
  characters) before hitting the network. Throws `WeakPasswordError`.

### Deprecated

- **`KoolbaseAuth.oauthLogin()` and `KoolbaseAppleAuth.signIn()`** now
  throw `KoolbaseAuthError('not_implemented')`. The earlier implementations
  routed through `/v1/auth/oauth` — the dashboard developer OAuth endpoint,
  which never created project-scoped end-user sessions. Apple Sign-In has
  therefore never actually worked for SDK consumers since it was first
  introduced. Proper OAuth (Apple, Google, GitHub) will ship in v1.10.0
  against new server endpoints at `/v1/sdk/auth/oauth/{provider}`. Use
  email/password authentication in the meantime.

### Peer dependencies

- `react-native-keychain >= 8.0.0` (**optional** —
  `peerDependenciesMeta.optional = true`)

### Migration

Most apps work without code changes after upgrading. To opt into
persistence, install the peer dependency:

```bash
npm install react-native-keychain
cd ios && pod install
```

Then call `restoreSession()` at app launch:

```typescript
useEffect(() => {
  koolbase.auth.restoreSession().then((result) => {
    if (result === RestoreResult.Restored) {
      navigate('Home');
    } else {
      navigate('Login');
    }
  });
}, []);
```

For apps using Apple Sign-In: temporarily switch to email/password until
v1.10.0 ships. The deprecated method now throws explicitly rather than
silently failing.

---

## 1.8.0

### Added

- **Functions:** Authenticated invocations now forward the signed-in user's
  session automatically.
  - When a user is signed in via `Koolbase.auth`, calls to
    `Koolbase.functions.invoke()` include their access token in the
    request.
  - Functions receive caller identity via `ctx.auth` — an object with
    `user_id` (string or null) and `is_authenticated` (boolean).
  - Unauthenticated invokes continue to work; Functions decide whether
    they require auth and respond with `AUTH_REQUIRED` if needed.
  - Token refresh is handled transparently — the next invoke after a
    refresh uses the fresh token without any client-side wiring.

Backwards compatible: no breaking changes. Existing code paths continue
to work.

---

## 1.7.0

### Added — Phone + OTP authentication

Sign users in with their phone number — for emerging markets and apps
where email isn't the primary identifier.

New methods on `Koolbase.auth`:

- `sendOtp({ phoneNumber })` — sends a 6-digit OTP to an E.164 phone
  number, returns the expiry timestamp.
- `verifyOtp({ phoneNumber, code })` — verifies the code and signs the
  user in (creates the account if new). Returns `PhoneVerifyResult` with
  an `isNewUser` flag for routing first-time users to onboarding.
- `linkPhone({ phoneNumber, code })` — links a phone number to an
  already-authenticated user.

New types: `OtpSendResult`, `PhoneVerifyResult`, `SendOtpParams`,
`VerifyOtpParams`, `LinkPhoneParams`.

`KoolbaseUser` now exposes `phoneNumber` and `phoneVerified` fields.

New errors (all extend `KoolbaseAuthError`): `InvalidPhoneNumberError`,
`OtpExpiredError`, `OtpInvalidError`, `OtpMaxAttemptsError`,
`OtpRateLimitError`, `PhoneAlreadyLinkedError`, `SmsConfigMissingError`.

Phone numbers must be in E.164 format (e.g. `+233244000000`). Configure
your SMS provider (Twilio, Africa's Talking, or Hubtel) in the Koolbase
dashboard before using.

---

## 1.6.1

### Changed

- README update — Logic Engine v2 operators.

---

## 1.6.0

### Added — Logic Engine v2

Richer conditions with new operators:

- `gte` — greater than or equals
- `lte` — less than or equals
- `contains` — string or list contains value
- `starts_with` — string starts with
- `ends_with` — string ends with
- `in_list` — value is in a list
- `not_in_list` — value is not in a list
- `between` — numeric value in range `[min, max]`
- `is_true` — value is boolean true
- `is_false` — value is boolean false
- `not_exists` — value is null or missing

All operators work with AND/OR condition groups.

---

## 1.5.0

### Added — Sign in with Apple

> **Note:** This functionality is deprecated as of v1.9.0 — it never
> created project-scoped end-user sessions. See the v1.9.0 entry above.

- Added `KoolbaseAppleAuth.signIn()` — Sign in with Apple for React Native
- Added `KoolbaseAuth.oauthLogin()` — unified OAuth login method
- Apple identity token verified server-side using Apple's JWKS endpoint
- Works with any Apple credential provider (bring your own apple-auth
  library)

#### Usage

```typescript
import { KoolbaseAppleAuth } from 'koolbase-react-native';

const session = await KoolbaseAppleAuth.signIn(async () => {
  const credential = await appleAuth.performRequest({
    requestedOperation: appleAuth.Operation.LOGIN,
    requestedScopes: [appleAuth.Scope.EMAIL, appleAuth.Scope.FULL_NAME],
  });
  return credential;
});
```

#### Setup required

Install `@invertase/react-native-apple-authentication` and configure your
App ID in the Apple Developer portal.

---

## 1.4.0

### Added — Koolbase Cloud Messaging

- Added `KoolbaseMessaging` — push notification delivery via FCM.
- Added `Koolbase.messaging.registerToken({ token, platform, userId? })`
  — register FCM device token.
- Added `Koolbase.messaging.send({ to, title, body, data? })` — send push
  notification to a specific device.
- `KoolbaseConfig` extended with `messagingEnabled` parameter (default
  `true`).
- Device ID automatically reused from analytics stable device ID
  (AsyncStorage).

#### Usage

```typescript
// After obtaining FCM token from @react-native-firebase/messaging
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

#### Setup required

Add your FCM server key as a project secret named `FCM_SERVER_KEY` in the
Koolbase dashboard.

---

## 1.3.1

### Changed

- Updated README — added Code Push, Analytics, Logic Engine sections,
  clearer get started guide.

---

## 1.3.0

### Added — Analytics

- Added `KoolbaseAnalytics` — event tracking with batched flush.
- Added `Koolbase.analytics` — top-level accessor.
- Added `Koolbase.analytics.track(eventName, properties)` — custom event
  tracking.
- Added `Koolbase.analytics.screenView(screenName, properties)` — screen
  view tracking.
- Added `Koolbase.analytics.identify(userId)` — attach authenticated user.
- Added `Koolbase.analytics.setUserProperty(key, value)` — user property.
- Added `Koolbase.analytics.setUserProperties(map)` — bulk user
  properties.
- Added `Koolbase.analytics.reset()` — clear identity on logout.
- Added `Koolbase.analytics.flush()` — manual flush.
- Added `Koolbase.analytics.dispose()` — flush and shut down.
- Auto events: `app_open`, `screen_view`, `session_end`.
- Batch flush: every 30s, on app background, on close, or at 20 events.
- Anonymous by default (stable `device_id` via AsyncStorage), attach
  `user_id` on `identify()`.
- `KoolbaseConfig` extended with `analyticsEnabled` and `appVersion`
  parameters.

### Added — Logic Engine v1

- Added `Koolbase.executeFlow(flowId, context)` — evaluate named flow
  from active bundle.
- Added `KoolbaseLogicEngine` — safe, deterministic flow evaluator.
- Supported node types: `if`, `sequence`, `event` (terminal), `set`.
- Supported operators: `eq`, `neq`, `gt`, `lt`, `and`, `or`, `exists`.
- Supported data sources: `context` (app-provided), `config` (bundle),
  `flags` (bundle).
- `BundlePayload` extended with `flows` and `screens` fields.
- Never throws — returns safe `FlowResult` on any error.

#### Usage

```typescript
// Analytics
await Koolbase.initialize({
  publicKey: 'pk_live_xxx',
  baseUrl: 'https://api.koolbase.com',
  appVersion: '1.0.0',
  analyticsEnabled: true,
});

Koolbase.analytics.track('purchase', { value: 1200, currency: 'GHS' });
Koolbase.analytics.screenView('checkout');
Koolbase.analytics.identify(user.id);
Koolbase.analytics.setUserProperty('plan', 'pro');

// Logic Engine
const result = Koolbase.executeFlow('on_checkout_tap', { plan: user.plan });
if (result.hasEvent) navigation.navigate(result.eventName!);
```

---

## 1.1.0

### Added — Offline-first database

- Database: offline-first support powered by AsyncStorage.
- Cache-first reads — returns local data instantly, refreshes from
  network in background.
- Optimistic writes — inserts saved locally first, synced when online.
- Auto-sync on network reconnect via NetInfo.
- `Koolbase.db.syncPendingWrites()` — manually trigger sync.
- `QueryResult.isFromCache` flag — know whether data came from cache or
  network.
- Write queue with max 3 retries before dropping failed writes.
- User-scoped cache — no cross-user data leakage on shared devices.
- `PendingWrite` type exported from package.

---

## 1.0.0

### Initial release

- Auth — register, login, logout, current user.
- Database — insert, query, get, update, delete, populate.
- Storage — upload, download, delete.
- Realtime — WebSocket subscriptions.
- Functions — invoke deployed functions.
- Feature flags and remote config.
- Version enforcement.
