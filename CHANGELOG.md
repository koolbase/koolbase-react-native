## 1.7.0

### Phone + OTP authentication
Sign users in with their phone number — for emerging markets and apps where email isn't the primary identifier.

New methods on `Koolbase.auth`:
- `sendOtp({ phoneNumber })` — sends a 6-digit OTP to an E.164 phone number, returns the expiry timestamp.
- `verifyOtp({ phoneNumber, code })` — verifies the code and signs the user in (creates the account if new). Returns `PhoneVerifyResult` with an `isNewUser` flag for routing first-time users to onboarding.
- `linkPhone({ phoneNumber, code })` — links a phone number to an already-authenticated user.

New types: `OtpSendResult`, `PhoneVerifyResult`, `SendOtpParams`, `VerifyOtpParams`, `LinkPhoneParams`.

`KoolbaseUser` now exposes `phoneNumber` and `phoneVerified` fields.

New errors (all extend `KoolbaseAuthError`): `InvalidPhoneNumberError`, `OtpExpiredError`, `OtpInvalidError`, `OtpMaxAttemptsError`, `OtpRateLimitError`, `PhoneAlreadyLinkedError`, `SmsConfigMissingError`.

Phone numbers must be in E.164 format (e.g. `+233244000000`). Configure your SMS provider (Twilio, Africa's Talking, or Hubtel) in the Koolbase dashboard before using.

## 1.6.1

- README update — Logic Engine v2 operators

## 1.6.0

### Logic Engine v2 — Richer conditions

New operators:
- `gte` — greater than or equals
- `lte` — less than or equals
- `contains` — string or list contains value
- `starts_with` — string starts with
- `ends_with` — string ends with
- `in_list` — value is in a list
- `not_in_list` — value is not in a list
- `between` — numeric value in range [min, max]
- `is_true` — value is boolean true
- `is_false` — value is boolean false
- `not_exists` — value is null or missing

All operators work with AND/OR condition groups.

## 1.5.0

### Sign in with Apple

- Added `KoolbaseAppleAuth.signIn()` — Sign in with Apple for React Native
- Added `KoolbaseAuth.oauthLogin()` — unified OAuth login method
- Apple identity token verified server-side using Apple's JWKS endpoint
- Works with any Apple credential provider (bring your own apple-auth library)

### Usage

```typescript
import { KoolbaseAppleAuth } from 'koolbase-react-native';

const session = await KoolbaseAppleAuth.signIn(async () => {
  // Use @invertase/react-native-apple-authentication or any other library
  const credential = await appleAuth.performRequest({
    requestedOperation: appleAuth.Operation.LOGIN,
    requestedScopes: [appleAuth.Scope.EMAIL, appleAuth.Scope.FULL_NAME],
  });
  return credential;
});
```

### Setup required
Install @invertase/react-native-apple-authentication and configure your App ID in the Apple Developer portal.

## 1.4.0

### Koolbase Cloud Messaging

- Added `KoolbaseMessaging` — push notification delivery via FCM
- Added `Koolbase.messaging.registerToken({ token, platform, userId? })` — register FCM device token
- Added `Koolbase.messaging.send({ to, title, body, data? })` — send push notification to a specific device
- `KoolbaseConfig` extended with `messagingEnabled` parameter (default: true)
- Device ID automatically reused from analytics stable device ID (AsyncStorage)

### Usage
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

### Setup required
Add your FCM server key as a project secret named `FCM_SERVER_KEY` in the Koolbase dashboard.

## 1.3.1

- Updated README — added Code Push, Analytics, Logic Engine sections, clearer get started guide

## 1.3.0

### Analytics
- Added `KoolbaseAnalytics` — event tracking with batched flush
- Added `Koolbase.analytics` — top-level accessor
- Added `Koolbase.analytics.track(eventName, properties)` — custom event tracking
- Added `Koolbase.analytics.screenView(screenName, properties)` — screen view tracking
- Added `Koolbase.analytics.identify(userId)` — attach authenticated user
- Added `Koolbase.analytics.setUserProperty(key, value)` — user property
- Added `Koolbase.analytics.setUserProperties(map)` — bulk user properties
- Added `Koolbase.analytics.reset()` — clear identity on logout
- Added `Koolbase.analytics.flush()` — manual flush
- Added `Koolbase.analytics.dispose()` — flush and shut down
- Auto events: `app_open`, `screen_view`, `session_end`
- Batch flush: every 30s, on app background, on close, or at 20 events
- Anonymous by default (stable device_id via AsyncStorage), attach user_id on identify()
- `KoolbaseConfig` extended with `analyticsEnabled` and `appVersion` parameters

### Logic Engine v1
- Added `Koolbase.executeFlow(flowId, context)` — evaluate named flow from active bundle
- Added `KoolbaseLogicEngine` — safe, deterministic flow evaluator
- Supported node types: `if`, `sequence`, `event` (terminal), `set`
- Supported operators: `eq`, `neq`, `gt`, `lt`, `and`, `or`, `exists`
- Supported data sources: `context` (app-provided), `config` (bundle), `flags` (bundle)
- `BundlePayload` extended with `flows` and `screens` fields
- Never throws — returns safe `FlowResult` on any error

### Usage
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

## 1.1.0

- **Database:** Offline-first support powered by AsyncStorage
  - Cache-first reads — returns local data instantly, refreshes from network in background
  - Optimistic writes — inserts saved locally first, synced when online
  - Auto-sync on network reconnect via NetInfo
  - `Koolbase.db.syncPendingWrites()` — manually trigger sync
  - `QueryResult.isFromCache` flag — know whether data came from cache or network
  - Write queue with max 3 retries before dropping failed writes
  - User-scoped cache — no cross-user data leakage on shared devices
  - `PendingWrite` type exported from package

## 1.0.0

- Initial release
- Auth — register, login, logout, current user
- Database — insert, query, get, update, delete, populate
- Storage — upload, download, delete
- Realtime — WebSocket subscriptions
- Functions — invoke deployed functions
- Feature flags and remote config
- Version enforcement
