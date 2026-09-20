# Changelog

All notable changes to `@koolbase/react-native` are documented
in this file. The format is based on [Keep a Changelog][kac], and this project
adheres to [Semantic Versioning][semver].

[kac]: https://keepachangelog.com/en/1.1.0/
[semver]: https://semver.org/

## 12.0.0

### Breaking

- **Fourteen error classes now report the code the server actually sends.**

  `error.code` is a public field, and on these fourteen classes it carried a
  value the Koolbase API has never emitted. Catching by type has always
  worked and is unaffected — no class, constructor or export has changed.
  Only the string in `code` moves.

  If you compare `error.code` against a literal, update these comparisons.
  If you assert on `code` in tests, or build fixtures from these values, the
  same applies.

  | Class | Was | Now |
  |---|---|---|
  | `EmailAlreadyInUseError` | `email_taken` | `email_in_use` |
  | `UserDisabledError` | `user_disabled` | `account_disabled` |
  | `SessionExpiredError` | `session_expired` | `invalid_refresh_token` |
  | `UnlockTokenInvalidError` | `unlock_token_invalid` | `invalid_unlock_token` |
  | `OtpRateLimitError` | `otp_rate_limit` | `rate_limit` |
  | `PhoneAlreadyInUseError` | `phone_taken` | `phone_in_use` |
  | `SmsConfigMissingError` | `sms_config_missing` | `sms_not_configured` |
  | `AppleNotConfiguredError` | `apple_not_configured` | `oauth_not_configured` |
  | `InvalidAppleTokenError` | `invalid_apple_token` | `invalid_oauth_token` |
  | `AppleEmailRequiredError` | `apple_email_required` | `oauth_email_required` |
  | `GoogleEmailRequiredError` | `google_email_required` | `oauth_email_required` |
  | `GoogleNotConfiguredError` | `google_not_configured` | `oauth_not_configured` |
  | `InvalidGoogleTokenError` | `invalid_google_token` | `invalid_oauth_token` |

  The Apple and Google pairs are the clearest case: the SDK split them by
  provider while the server has always sent one unified code for both.

  Why this was invisible: the mapping tests checked which class a server code
  produces, never what code that class reports. Both directions are now
  asserted, so a class cannot report a code the API does not send.

  **Nothing that worked before breaks in behaviour.** A comparison against
  the old value could never have matched a real response — but it can match a
  mock, which is why this is a major release rather than a patch.

### Added

- **Account settings.** A web application could not offer one: these existed
  on the server and in the Flutter SDK, and not here.

  - `auth.getCurrentUser()` — the signed-in user, fetched fresh rather than
    from the cached session, and persisted so `currentUser` stops being
    stale.
  - `auth.updateProfile({ fullName?, avatarUrl? })` — only the fields given
    are sent, so passing one leaves the other untouched.
  - `auth.changePassword({ currentPassword, newPassword })` — the current
    password is required: a stolen session should not be enough to lock the
    real owner out. A wrong one throws `CurrentPasswordIncorrectError`.
  - `auth.deleteAccount()` — deletes the caller only; there is no user id to
    pass, which is the security property. It does **not** delete the
    account's records in your collections. Subscribe a Function to
    `auth.user.deleted` and clean up there.

- **Session management.** Three endpoints had been live on the server the
  whole time and no SDK exposed any of them.

  - `auth.listSessions()` — where the user is signed in. Each entry carries
    the device label, IP, user agent and timestamps, and `isCurrent` marks
    this device. Token hashes are never included.
  - `auth.revokeSession(id)` — sign one out. Revoking the current session
    ends this one too; the next request's 401 clears it locally. A UI that
    knows a row is current should call `logout()` instead.
  - `auth.revokeAllOtherSessions()` — sign out every other device, keeping
    this one, and return how many ended. What "sign out my other devices"
    means after a lost phone.

- **`auth.auditLog({ limit?, offset? })`** — the account's own security
  history, for a "recent activity" screen: sign-ins, failures, lockouts,
  password changes, verification. The server sanitizes each event against a
  per-type field allowlist, so an entry carries what its type may say and
  nothing more. Returns a page with the total across all pages.

- **`db.aggregate(request)`** — count and total over a whole collection.

  Not a paged query you add up in the client: the server aggregates the
  entire authorized set with the read rule applied inside the query. And
  never a bare number — collections are schemaless, so a sum that quietly
  skipped three malformed rows would be a wrong number that looks right.
  Every result carries its `accounting`: how many records contributed to each
  measure, how many were skipped, and why.

  ```ts
  const r = await Koolbase.db.aggregate({
    collection: 'orders',
    groupBy: { field: 'created_at', bucket: 'month', timezone: 'Africa/Accra' },
    measures: [{ aggregate: 'sum', field: 'total', as: 'revenue' }],
  })

  if (r.accounting.revenue.skipped > 0) {
    // some orders had a total that was not a number — say so
  }
  ```

  A calendar bucket requires a timezone and the types enforce it: midnight
  means nothing without one, and Accra and UTC disagree about which day a
  23:30 sale belongs to.

### Changed

- **`x-koolbase-platform-version` falls back to `unknown`** rather than being
  sent empty. The browser version is read from the user agent, which
  recognises Chrome, Firefox, Safari and Edge — so Brave, Opera, Samsung
  Internet and in-app webviews reported nothing. An empty header stored
  against a session is indistinguishable from an SDK that never reported
  itself; `unknown` says the SDK spoke and could not identify the host.

### Fixed

- The six `x-koolbase-*` identity headers are now pinned by a test against
  the set the API allows. They are sent on every request, and a browser
  refuses a request whose preflight does not list them — which is how every
  authenticated call from `@koolbase/js` came to be blocked on 18 September.
  The API derives its CORS allowance from one declaration now, and this test
  is the other end of that contract.

## 11.4.0

### Added

- **`auth.resendVerificationEmailToAddress(email)`** — ask for a new
  verification email with no session.

  A project requiring verified contact issues no session until the account
  verifies, and refuses login until then. So a user whose verification email
  went to spam, or who waited past the 24-hour link expiry, could not sign in
  to ask for another one — `resendVerificationEmail()` needs the session they
  cannot get. There was no way back except contacting the project's
  developer.

  Returns nothing and throws only on a malformed request. The server answers
  identically whether the address has an account, has none, or is already
  verified, because anything else would let anyone discover who has signed
  up — so show the same "check your email" either way, and never say "we sent
  it". The per-account cooldown and daily cap still apply; they are simply
  not reported, for the same reason.

  `resendVerificationEmail()` is unchanged, for a signed-in user who can
  safely be told more.

## 11.3.0

### Fixed

- **Thirty error codes the API emits were not mapped**, so they arrived as
  generic errors and an app's `instanceof` branch silently never ran. The
  worst of them is `revision_mismatch`: the server attaches the current
  record and both revisions to that 409 specifically so a conflict can be
  resolved without a second fetch, and no app could reach any of it.
  `KoolbaseRevisionMismatchError` now carries `expectedRevision`,
  `currentRevision` and `current` as typed fields.

  Also now catchable: `plan_limit_reached` (as `KoolbasePlanLimitError`,
  shared across database, storage and functions, carrying resource, limit
  and plan), `insufficient_scope`, `idempotency_key_reused` /
  `idempotency_conflict`, `batch_failed`, `duplicate_values`,
  `identity_not_found`, `provider_identity_already_linked`,
  `vector_field_exists`, `field_not_auto_embed`, `invalid_embedding_config`,
  `provider_not_configured`, `provider_invalid`, `upload_url_failed`,
  `slug_taken`, `invitation_invalid`, `project_invalid`, `invalid_body`,
  `no_changes`, the four seed codes, and the generic conflict codes.

- **Two mappings were for codes the API does not emit.** `session_expired`
  and `token_revoked` were handled as though the server sent them; it sends
  `invalid_refresh_token`, which already maps to `SessionExpiredError`.
  Removed, along with three message-substring guesses at revocation.
  `TokenRevokedError` stays as a class: explicit revocation is worth
  distinguishing from expiry, but only once the server can establish it —
  a generic 401 cannot, and the SDK must not infer it.

- **`restoreSession` no longer clears the stored session on
  `InvalidCredentialsError`.** It means "these credentials are wrong", which
  during a restore points at the project key or the request rather than the
  user's session — and deleting the refresh token on that reading signs
  someone out with no way back. Only a refused refresh clears it now.

- **Errors report the code the server sent.**
  `KoolbaseIdempotencyKeyReusedError` hardcoded one code while serving two.

### Why these were missing

The API wrote error codes through four different helpers, so no single search
found them all, and the comparison against what these SDKs map took four grep
patterns and still missed several. The API now declares every code as a
constant in one file, with a test that fails the build on a literal — so the
comparison is exact. That is how these thirty were found, and three codes
nobody had written down anywhere.

Every surface here has a test asserting each code maps to its own class and
reports its own code, so the next one added to the API without a case here
fails the build rather than a user's upload.

## 11.2.0

### Fixed

- **A function that timed out was indistinguishable from one that threw.** A
  504 fell into the generic 5xx branch and arrived as
  `FunctionExecutionError`. Those need different answers — a timeout means
  retry, raise the function's timeout at deploy, or move the slow part
  elsewhere; an exception means fix the code. The server has always told them
  apart. Now `FunctionTimeoutError`, and 429 gets `FunctionRateLimitError`
  rather than falling through untyped.

- **`upload_expired` and `cap_below_usage` were unmapped in storage.** The
  first matters: a presigned upload URL has a lifetime, and a user who picks a
  file, gets distracted and confirms twenty minutes later hit it as a generic
  failure. It is a retry, not a failure — presign again and send the same
  bytes. Now `KoolbaseUploadExpiredError`.

- **Four database codes were unmapped**: `ambiguous_match`,
  `constraint_exists`, `constraint_not_found`, `insufficient_authority`. The
  first is the one an app hits — an upsert whose filter matched more than one
  record is refused rather than resolved, because picking one would be a
  silent guess about which row the caller meant.

- **Errors report the code the server sent, not their category.**
  `KoolbaseNotFoundError` and `KoolbaseValidationError` each hardcoded one
  code while being used for several, so a `collection_not_found` response
  produced an error reporting `not_found`. Catching the class works as
  before; reading `e.code` now gives the server's answer.

### Why these were missing

The API writes error codes through four different helpers, so no single
search finds them all — which is how twenty-two codes across four surfaces
went unmapped without anyone noticing. Each surface now has a test asserting
every known code maps to its own class, so a new one added without a case
here fails the build rather than a user's upload.

## 11.1.0

### Fixed

- **Fourteen error codes the API emits were not mapped**, so they arrived as
  a generic error and an app's `instanceof` branch silently never ran. The
  most consequential is `contact_not_verified` — in a project with verified
  contact required, a user who registers, does not click the link, and comes
  back is the *commonest* auth failure there is, and it had no type. Now:

  | Code | Class |
  |---|---|
  | `contact_not_verified`, `email_not_verified` | `ContactNotVerifiedError` |
  | `signups_disabled` | `SignupsDisabledError` |
  | `weak_password` | `WeakPasswordError` (existed, never mapped from the server) |
  | `account_exists` | `AccountExistsError` |
  | `token_expired` | `TokenExpiredError` |
  | `token_used` | `TokenAlreadyUsedError` |
  | `invalid_token` | `UnlockTokenInvalidError` |
  | `invalid_password` | `CurrentPasswordIncorrectError` |
  | `oauth_only_account` | `OAuthOnlyAccountError` |
  | `unsupported_oauth_provider` | `UnsupportedOAuthProviderError` |
  | `session_required` | `SessionRequiredError` |
  | `insufficient_authority` | `InsufficientAuthorityError` |
  | `last_credential` | `LastCredentialError` |
  | `hide_requires_verification` | `HideRequiresVerificationError` |

  `CurrentPasswordIncorrectError` is named for the operation rather than the
  code: the server calls it `invalid_password`, which reads like a rejected
  new password and means the opposite.

- **`WeakPasswordError` carries the server's message** when there is one. The
  SDK checks length before sending; a project may require more, and "must be
  at least 8 characters" would then be both wrong and unhelpful. Its
  constructor argument is optional, so existing code is unaffected.

### Why these were missing

Nothing inside the SDK can tell that a code fell through — the generic error
is a valid object and the app's branch simply does not run. There is now a
test that asserts every code maps to its own class, so a new code added to the
API without a case here fails the build rather than a user's password reset.

## 11.0.0

### Read before upgrading

**`register()` returns a result, not a user.** One line changes in your app,
and the reason is a bug this fixes.

Registration succeeding and authentication succeeding are different outcomes.
A project with `require_verified_contact` enabled creates the account and
issues **no session** — the user verifies their email before their first
sign-in. The server has always answered that case correctly: 201 with
`verification_required`, deliberately not an error, because reporting failure
for a signup that worked is worse than either alternative.

The SDK ignored that field. It built a session from a response body with no
tokens in it, persisted it, and answered `currentUser` with a user whose every
authenticated request went out as `Bearer undefined` and came back 401 —
signed in as far as the app could tell, and unable to do anything. Silent, and
only in the configuration that requires verification.

```ts
// Before
const user = await Koolbase.auth.register({ email, password });

// After
const result = await Koolbase.auth.register({ email, password });
switch (result.status) {
  case 'authenticated':
    // result.session is live, the user is signed in
    break;
  case 'verification_required':
    // the account exists, result.session is null, they verify first
    break;
}
```

A discriminated union rather than a nullable session, so there is no path
where an app reads `result.user` and assumes it is signed in. That is how the
bug worked, and a nullable field would have allowed it at one remove.

### Fixed

- **A session is never fabricated from a response without tokens.** Every
  path that builds one — register, login, refresh, Google, Apple — now refuses
  a body claiming authentication while omitting a token, throwing
  `MalformedSessionResponseError`. Distinct from `verification_required`,
  which is a legitimate session-less success: this is a protocol violation and
  says so.

- **A pending signup no longer touches existing state.** It persists nothing,
  fires no auth-state change, and leaves a session already on the device
  alone — registering a second account does not sign out the first.

### Migration

Assign the result, switch on `status`. If your project does not require
verified contact, the `authenticated` branch is the only one you will see —
but write both, because turning that setting on later should not break your
signup flow.

## 10.4.0

### Added

- **`auth.verifyEmail(token)`** — complete email verification with a token
  from a verification link. The endpoint and the Flutter SDK have had this;
  the TypeScript SDKs did not, so an app's verify-email page had nothing to
  call.

- **`auth.resendVerificationEmail()`** — re-send the verification email to a
  signed-in but unverified user. Returns `{ alreadyVerified, expiresAt,
  cooldownUntil }`; an already-verified account is a no-op that says so
  rather than an error, which is what a resend button needs when the user
  verified in another tab.

  The server throttles this, and the refusal now arrives typed:
  `VerificationResendCooldownError` carries `cooldownUntil` so you can show a
  countdown, and `VerificationResendDailyCapError` is separate because the
  remedy differs — wait seconds versus wait until tomorrow.

## 10.3.0

### Fixed

- **Analytics events carried no user unless the app called `identify()`.**
  Nothing errored when it never did, so every event landed anonymous and
  retention, funnels and per-user analysis were quietly worthless — found in
  a real project as 53 events, 8 registered users, and not one event carrying
  a user id. The SDK already knows who is signed in; it now says so. The
  Flutter SDK fixed this in 11.2.0 and the TypeScript SDKs did not, until now.

  `identify()` still wins for an app with its own identity system, and
  `reset()` releases that override and falls back to the Koolbase session.

  If you have been calling `identify()` yourself, nothing changes. If you have
  not, your events will start carrying users — which is the point, though it
  means your analytics before and after this version are not comparable.

## 10.2.0

### Changed

- The platform seam gains a locking contract. React Native satisfies it by
  running the function: one process, one store, nothing to coordinate.

## 10.1.0

### Changed

- `UploadOptions.file` accepts a `Blob` in addition to `{ uri, name, type }`.
  The React Native path is unchanged; the union exists because the same core
  now serves a browser, where a `File` is the only form the bytes come in.

## 10.0.2

### Fixed

- **A Node process that initialized the SDK never exited.** The analytics
  flush interval, and a pending realtime reconnect, counted as work on Node's
  event loop, so a CLI, a test runner or an SSR build step hung after its last
  line. Both timers are now unref'd where the runtime supports it. A browser
  is unaffected: the page keeps itself alive regardless.

## 10.0.1

No changes to this package. Released to keep the version aligned with
`@koolbase/core` and `@koolbase/js`, which carry a fix for running outside a
browser.

## 10.0.0

### Read before upgrading

**The package is now a thin layer over `@koolbase/core`.** The SDK's behaviour
— auth, database, offline queue, conflicts, realtime, storage, functions —
moved into a shared core that `@koolbase/react-native` and the new
`@koolbase/js` both compose. Your imports do not change: everything the core
exports is re-exported here. What changes is that the same sixty tests that
proved the offline path on a device now run against both hosts, so a fix in
one is a fix in the other.

**Code push is gone.** `Koolbase.codePush`, `codePushChannel`,
`onMandatoryUpdate`, `KoolbaseCodePush`, `BundleManifest` and `BundlePayload`
are removed. Code push is a Flutter feature, where it patches the Dart VM; the
React Native version pushed config and flag overrides, which Remote Config and
Feature Flags already do without a bundle. If you set `codePushChannel`, delete
the line; the flag and config reads keep working from the remote values.

**`Koolbase.executeFlow` and the logic engine are gone.** Flows only ever
arrived through code-push bundles, so with no bundle the method could only
return an empty result. Removed rather than left as a call that does nothing.

**`KoolbaseAppleAuth` is gone.** Deprecated since 1.9.0, throwing
`not_implemented` since then. `Koolbase.auth.signInWithApple(...)` is the
Apple flow and is unchanged.

### Changed

- **Host access goes through a platform adapter.** AsyncStorage, NetInfo,
  AppState and Platform are consumed by one file, `platform.ts`, and nothing
  else in the SDK imports a native module. `KoolbaseConfig.platform` accepts
  a custom adapter — for tests, or for a host this package does not cover.

- **The default session storage is decided by the platform.** Keychain when
  `react-native-keychain` is installed, as before; the choice is now made by
  the adapter rather than hard-coded in auth.

- **The device label persists through the platform's storage** rather than a
  direct keychain call. Behaviour is the same on a device with keychain; on
  one without, the label now survives restarts where it used to be regenerated
  each session.

### Removed

- `jszip` — code push was its only user. This package's core now has no
  runtime dependencies.

### Migration

Delete any `codePushChannel` or `onMandatoryUpdate` from your `initialize()`
config, and any `Koolbase.codePush` or `Koolbase.executeFlow` calls. That is
the whole migration; everything else is source-compatible.

## 9.2.0

### Read before upgrading

**`delete()` can now fail.** It previously returned `Promise<void>` with no throw
path: a delete the server refused — no permission, wrong project, record already
gone — reported success to the caller, and nothing anywhere reported otherwise.
It now throws. Code that called it without a `catch` will surface an error where
it never did before, which is the point, and still a change.

**A rejected credential is no longer a `KoolbaseDataError`.** It is
`KoolbaseUnauthenticatedError`, a sibling under the new shared root. Code
catching `KoolbaseDataError` to handle a dead session will stop matching.

### Fixed

- **`delete()` queued the write before attempting it, and never removed it.** A
  delete that succeeded stayed in the queue and replayed later — against a
  record that may since have been recreated under the same id.

- **Five data methods could not clear a rejected session.** `upsert`,
  `deleteWhere`, `batch`, `setVector`, and `deleteVector` each built their own
  request, so whether a 401 signed you out depended on which method you called.
  All now go through one path.

- **A 401 was treated as an unreachable network** by `update`, `delete`, and
  `upsert`, so the write was queued and an optimistic record returned — telling
  the app the change had succeeded. Anything the server answered with is now
  surfaced, because it will be refused again on every retry.

- **A 401 carrying a body `code` did not clear the session.** Responses were
  mapped by their body's `code` field before their status, so a server answering
  a rejected credential with `code: 'validation_error'` produced a data error and
  left the dead session in place — the app kept making calls that could only
  fail. Status is now authoritative: a 401 is an authentication failure whatever
  the body says.

- **Offline insert chains broke at the server boundary.** A record created
  offline got a `local_` id, and any queued update or delete addressed that id —
  which ceased to exist the moment the insert replayed and the server assigned a
  real one. The follow-up writes failed against a record that was sitting right
  there. Ids are now UUID v4 from the moment of creation, client-side, and the
  id travels with the queued insert, so a chain of edits made offline replays
  exactly as it was made.

- **Every cold `query()` hit the network twice.** The stale-while-revalidate
  refresh was fired before the cache was consulted, so a query with nothing
  cached issued the background request and the real one. Doubled reads on every
  first load, against your quota.

- **Signed-out state read as empty state.** Per-user caches and queues fell back
  to a shared anonymous bucket when no user was present, so a signed-out call
  reported zero pending writes rather than refusing — a sync indicator could show
  "all synced" over a queue that was merely out of reach. Per-user surfaces now
  refuse without a user.

- **A replayed write left the cache it invalidated behind.** Replay updated the
  server and stopped there: a record deleted offline stayed in every cached query
  result after its delete succeeded, and an updated one kept its pre-edit values
  until something else evicted it. Replay now maintains the cache at the point of
  success.

- **A terminally rejected insert left its optimistic record standing.** When the
  server refused a queued insert for good — no permission, validation — the write
  left the queue but the optimistic record stayed in every cached result it had
  been written into. The app displayed a record that does not exist and never
  will. Terminal rejection now evicts it.

- **Realtime reconnected every three seconds forever**, with no backoff and no
  ceiling. A device with no network, a wrong URL, or a dead session drained
  battery and data invisibly. It now doubles to a minute and resets when a
  connection opens.

- **`clearUserCache` deleted the write queue along with the cache.** Nothing
  called it, which is the only reason it had not lost anyone's work.

### Added

- **One exception hierarchy.** `KoolbaseError` is the root; the data, storage,
  auth, and Function families sit beneath it, so `catch (e) { if (e instanceof
  KoolbaseError) }` covers any SDK failure.

- **`KoolbaseUnauthenticatedError`** — raised by any surface. A session stops
  working for the whole SDK at once, not one subsystem at a time. Named for what
  the server reports: a 401 covers an expired session, a revoked key, and
  missing credentials, and it does not distinguish them.

- **`auth.clearStoredSession()`** — discards a session already known to be
  unusable, without a server call.

- **Typed Function failures.** `FunctionNotFoundError`,
  `FunctionPermissionError`, `FunctionValidationError`,
  `FunctionQuotaExceededError`, `FunctionExecutionError`. Every failed
  invocation used to be a bare `Error`, matchable only on message text.

- The package's first tests: 60, covering the paths above.

### Added — the queue is observable

- **`db.pendingWrites()`** — changes made offline, waiting to be sent, oldest
  first. For sync indicators and for warning a user about to log out with
  unsynced edits: queues are per-user and survive logout by design, so those
  edits sync whenever that user next signs in on this device — possibly never.
  `conflicts()` got this treatment; the queue, the same durable state one step
  earlier, now has it too.
- The returned shape deliberately excludes replay internals (baselines,
  revisions). What is public is what an app needs to display.
- **Renamed:** the old exported `PendingWrite` interface — the 9.1.x queue-entry
  shape, which no API ever returned — is no longer public. The name now refers
  to the observable queue entry above. The old shape survives internally only
  for the legacy-queue migration.

### Added — offline editing that cannot overwrite silently

Offline `update` and `delete` used to be queued without recording what the change
was based on, so replay applied them blindly and overwrote anything that had
changed meanwhile. Now:

- A write is queued only when the SDK knows what the record looked like at the
  time — from a query, a read, a realtime event, or a still-queued insert.
  Otherwise it throws `KoolbaseOfflineBaselineUnavailableError` rather than
  queueing something that cannot be replayed safely.

- Replay sends the revision the change was based on, so the server applies it
  only if the record still carries that revision. Nothing can land between the
  client deciding a write is safe and the server applying it.

- A refused write becomes a durable conflict rather than a retry, readable from
  `Koolbase.db.conflicts()` and resolvable four ways. Conflicts survive
  restarts, and do not expire: an app that never reads them accumulates them
  invisibly, so surface them if you support offline editing.

- A refused insert is now a conflict you can resolve. It was recorded as an
  `update`, and resolution had no branch for an insert at all, so the one class
  of conflict that loses a record outright was the one class you could not act
  on. A rejected insert now holds its operation, and resolving it retries the
  insert, carrying the conflict id as the idempotency key so a retry cannot
  double-write.

- A resolution the server refuses no longer disappears. The conflict is updated
  with what the server returned and stands, rather than being cleared on the
  assumption the resolution landed.

- Writes queued by an earlier version are migrated on first sync. Inserts replay
  normally; updates and deletes have no baseline, so they are preserved as
  conflicts marked `baseline_unavailable` rather than replayed blindly or
  dropped. The migration never touches the network, so its outcome does not
  depend on whether the device happened to be online at startup.

- Records reach a per-record cache from every path that returns one — queries,
  reads, writes, batch results, search hits, and realtime events — so anything
  the SDK has fully seen can be edited offline.

## 9.1.0

### Fixed

- **Device identity is now a single shared, persisted value across the SDK.**
  Feature flags, code push, and messaging were each initialized with a
  hardcoded `'rn-device'` string instead of a real device id. This silently
  broke three things: every device collided on one messaging registration row
  (only the last-registered device per project received push); every device
  produced the same feature-flag rollout bucket (a 10% rollout was on for
  everyone or no one, never 10%); and code-push targeting collided the same
  way. A single `getOrCreateDeviceId()` now generates a persisted UUID v4 once
  (crypto-backed where the runtime provides it) and all subsystems share it.

### Removed

- **`Koolbase.messaging.send()` and `SendOptions`.** Sending push notifications
  is server-initiated only — it requires a secret `kb_live_` key and must run
  on your backend or in a Koolbase Function, never in the app. The publishable
  key the SDK holds ships in your bundle; a client that could send would let
  anyone extracting it push to your users. The API already rejected
  publishable-key sends with 401, so this method never delivered. Move sends to
  your backend. `registerToken` is unchanged.

### Note

- On upgrade, devices are assigned a proper unique id and will re-register
  with messaging once. No action needed. Feature-flag rollout buckets will
  change (correctly) — a device that happened to fall in or out of a rollout
  under the old constant behaviour may now flip, matching its true bucket.

## 9.0.0

### Breaking changes

- **Package renamed** from `@techfinityedge/koolbase-react-native` to `@koolbase/react-native` for brand consistency with the rest of the Koolbase SDKs and tooling. This is the only change in this release — the API surface, behavior, and exports are identical to 8.0.0.
- **Migration:** replace the dependency in `package.json` (`@techfinityedge/koolbase-react-native` → `@koolbase/react-native`) and update every import path accordingly. No code changes beyond the import specifier are required. The old package is deprecated on npm and will receive no further updates.

## 8.0.0

### Breaking changes

- None. `mode` and `minSimilarity` are both optional; existing
  `searchSemantic` callers continue to work unchanged. Major bump
  reflects the conceptual expansion of the search contract (three
  retrieval modes instead of one), not API-breaking removals.

### Added

- `KoolbaseDatabase.searchSemantic` accepts a new `mode` parameter of
  type `SearchMode`. Three retrieval strategies are supported:
  - `'semantic'` (default) — pure vector search via HNSW on cosine
    distance. Best for fuzzy / conceptual queries.
  - `'lexical'` — pure BM25 over the field's source text via Postgres
    `ts_rank_cd`. Best for exact terms, codes, names, acronyms.
  - `'hybrid'` — vector + lexical fused with reciprocal rank fusion
    (k=60). Generally the strongest default for production search.
- `KoolbaseDatabase.searchSemantic` accepts a new `minSimilarity`
  parameter (0..100, optional). Server-side filter that drops results
  below the given similarity percentage before they cross the wire.
  Saves bandwidth on weak matches. Only valid for semantic and hybrid
  modes; the server rejects it on lexical mode (BM25 ranks aren't
  comparable to cosine similarity).
- New `SearchMode` type exported from `@koolbase/react-native`.

### Server requirements

- Requires Koolbase API release with hybrid search shipped (June 8 2026
  or later).
- Lexical and hybrid modes require the vector field to have a
  `source_field` configured. The lexical sidecar table populates
  automatically on record write via the same hook that drives auto-embed.

## 7.0.0

### Breaking changes

- `KoolbaseDatabase.searchSemantic`: the `queryVector` parameter is now optional.
  Existing callers continue to work unchanged — the breaking aspect is that
  the SDK now validates that exactly one of `queryVector` / `queryText` is
  supplied, and throws `Error` otherwise.

### Added

- `KoolbaseDatabase.searchSemantic` accepts a new `queryText` parameter. When
  supplied, the server embeds it inline using the vector field's configured
  provider (Gemini or OpenAI) before running HNSW lookup. No client-side
  embedding model required for typical search use cases.
- `KoolbaseDatabase.embedText` queues an embedding job for a specific record's
  vector field. Used for backfilling vectors on records that pre-date the
  auto-embed hook, or for embedding text other than the record's
  configured source field.

### Server requirements

- Requires Koolbase API release `771728d` or later (Phase 2 Stage A3a).
- Auto-embed on record write is automatic once a vector field has its
  `embedding_provider`, `embedding_model`, and `source_field` configured
  (see [docs](https://docs.koolbase.com/database/vectors)).

## 6.0.0

### Added — database

- **Semantic search via vector similarity.** Query records by meaning,
  not just by field equality. Companion to the server-side vector
  primitive shipped in Koolbase Phase 1 AI on June 6 2026.
  - `KoolbaseDatabase.setVector(recordId, field, vector)` writes (or
    replaces) a vector for a record on the named field. The field must
    already be declared on the collection via the dashboard or CLI;
    the vector's length must match the field's declared dimension.
  - `KoolbaseDatabase.getVector(recordId, field)` reads a stored vector
    back as `KoolbaseVector` — `{ recordId, fieldName, vector,
    createdAt, updatedAt }`.
  - `KoolbaseDatabase.deleteVector(recordId, field)` removes a record's
    vector slot. Does NOT remove the field declaration itself — the
    field stays settable on other records.
  - `KoolbaseDatabase.searchSemantic({ collection, field, queryVector,
    limit, where })` runs an HNSW similarity search ranking records by
    cosine distance to the query vector. The collection's read rule is
    applied after the lookup; `where` is an optional equality filter
    map. Returns `SemanticSearchResult` — `{ hits, total }` where each
    hit carries `record` and `distance`.

- New typed exports: `KoolbaseVector`, `KoolbaseSemanticHit`,
  `SemanticSearchResult`, `KoolbaseVectorDimensionMismatchError`.

### Fixed — docs

- Database errors table in `README.md` previously listed storage error
  rows (copy-paste bug). Now lists the actual database error subclasses.

### Notes

- Vector fields must be declared ahead of time via the Koolbase
  dashboard or CLI; the React Native SDK does not declare schema
  (mirrors how collections and storage buckets are declared).
- Supported dimensions in this release: 384, 768, 1024, 1536. Higher
  dimensions (e.g. OpenAI text-embedding-3-large at 3072) will be
  supported in a future release once pgvector is upgraded — in the
  meantime, use the model's `dimensions=1536` parameter (Matryoshka
  truncation) for full compatibility.
- Vector operations are online-only. They're not cached locally or
  queued offline because HNSW similarity search has no useful offline
  semantics, so deferred writes could corrupt the user's view of what's
  persisted.
- Semantic search respects the collection's read rule the same way
  `query()` does — `owner`/`scoped`/`conditional` records are filtered
  to the caller after the HNSW lookup, so strict rules may return fewer
  than `limit` results.

### Migration

Purely additive — no existing methods, types, or exports changed.
Upgrading from 5.x requires only `yarn upgrade
@koolbase/react-native` (or the equivalent npm/pnpm/bun
command) and rebuilding (`yarn build`).

### Added — storage

- Object versioning (Gap #6). When a bucket has versioning enabled (via
  the dashboard or the buckets PATCH endpoint), every overwrite preserves
  the prior bytes as a history version and deletes become soft —
  recoverable until force-purged.
  - `KoolbaseStorage.listVersions(bucket, path)` returns the full timeline
    newest-first. Each `KoolbaseObjectVersion` carries `versionId`, `size`,
    `etag`, `metadata`, `createdAt`, plus the flags `isCurrent` (the row
    that lives in `storage_objects` right now) and `isDeleteMarker` (a
    soft-delete tombstone with no fetchable bytes). Returns an empty array
    for a path with no current row and no history.
  - `KoolbaseStorage.getVersion(bucket, path, versionId)` fetches metadata
    for a single version. Works against the current row or any history
    row — check `isCurrent` to disambiguate.
  - `KoolbaseStorage.getDownloadUrl(bucket, path, versionId?)` now accepts
    an optional `versionId` argument. Omit to download the current bytes;
    pass a `versionId` to download that historical version directly.
    Throws for delete markers (no bytes exist).
  - `KoolbaseStorage.restoreVersion(bucket, path, versionId)` brings a
    history version back as the new current. The previously-current row
    is snapshotted into history first, so restore is itself a versioned
    event you can undo. The restored row gets a freshly-minted
    `versionId`; the target stays in history at its original id.
  - `KoolbaseStorage.purgeVersion(bucket, path, versionId)` hard-removes
    a single history row plus its `.versions/` R2 bytes (or just the row,
    for delete markers). Refuses the current version.
  - `KoolbaseStorage.delete(bucket, path, forcePurge?)` now accepts an
    optional `forcePurge` argument. With `forcePurge: true` against a
    versioned bucket, wipes the entire timeline for a path — every row,
    every R2 key. The default (`false`) is the soft-delete behavior:
    snapshots current to history and records a delete marker.

- New typed export: `KoolbaseObjectVersion`.

### Notes

- Versioning is opt-in per bucket. Buckets created before the feature
  shipped — and any bucket with versioning off — keep the legacy
  hard-overwrite, hard-delete semantics. No behavioral change for
  non-versioned buckets.
- Delete markers can appear in `listVersions` results. Filter
  client-side (`v => !v.isDeleteMarker`) if your UI only wants
  restorable versions.
- `restoreVersion` against the already-current version, or against a
  delete marker, throws. `getDownloadUrl` with a delete marker's
  `versionId` throws.
- Backwards-compatible: all new APIs are additive. Existing
  `getDownloadUrl(bucket, path)` and `delete(bucket, path)` calls
  produce identical wire requests as before.
- Pairs with `koolbase_flutter` v6.5.0 (published earlier today). Same
  client surface (`listVersions` / `getVersion` / `getDownloadUrl` with
  `versionId` / `restoreVersion` / `purgeVersion` / `delete` with
  `forcePurge`), same semantics.

## 5.4.0

### Added — storage

- Edge image transforms (Gap #8). Two complementary forms:
  - `KoolbaseStorage.publicUrl({ ..., transform })` accepts an
    optional `KoolbaseImageTransform` object — width, height,
    format, quality, fit, dpr, gravity. The resulting URL hits
    Cloudflare's image pipeline at
    `cdn.koolbase.com/cdn-cgi/image/<opts>/...` and serves a
    resized, re-encoded copy of the source.
  - `KoolbaseStorage.publicUrlWithPreset({ projectId, presetName,
    bucket, path })` resolves a named preset stored server-side
    (managed via the dashboard or REST API) at
    `cdn.koolbase.com/p/{project_id}/{preset_name}/{bucket}/{path}`.
    Edit the preset once on the server and every URL using it
    updates as the edge cache rolls over.
  - `KoolbaseStorage.publicUrlForObjectWithPreset(obj, bucket,
    presetName)` — instance-style variant when you already have a
    `KoolbaseObject` in hand.
- New typed exports: `KoolbaseImageTransform`, `KoolbaseImageFormat`
  (`'auto' | 'webp' | 'avif' | 'jpeg' | 'png'`), `KoolbaseImageFit`
  (`'scale-down' | 'contain' | 'cover' | 'crop' | 'pad'`),
  `KoolbaseImageGravity` (10 anchor positions). Out-of-range numeric
  values clamp silently to Cloudflare's valid ranges (width/height
  1–2000, quality 1–100, dpr 1–3).

### Notes

Cloudflare bills unique transformations per calendar month; every
Koolbase account includes 5,000 free. Transformed responses are
edge-cached for 4 hours.

### Compatibility

No breaking changes. All new APIs are additive; existing `publicUrl`
calls without `transform` produce the exact same URL they did in 5.3.0.

## 5.3.0

### Added — storage

- Public bucket CDN URLs (Gap #2 SDK polish).
  - `KoolbaseObject` gains an `r2Bucket: string` field identifying
    which physical R2 bucket holds the object's bytes. Always
    populated. `'koolbase-storage-public'` means the object has a
    stable CDN URL; anything else (typically `'koolbase-storage'`)
    means it's in private storage and reads go through a presigned
    URL via `getDownloadUrl`.
  - `KoolbaseStorage.publicUrl({ projectId, bucket, path })` — static
    method that builds the CDN URL pattern unconditionally. Use for
    build-time URL generation where you have the inputs but don't
    need (or want) a check that the file is actually in a public
    bucket.
  - `KoolbaseStorage.publicUrlForObject(obj, bucket)` — static method
    that returns the stable CDN URL when the object lives in the
    public R2 bucket, `null` otherwise. Use this when you have a
    `KoolbaseObject` instance and want a safe URL — returns `null`
    rather than a URL that 404s for private or legacy public-bucket
    files.

### Internal

- Storage object JSON mapper extended to surface the server's
  `r2_bucket` field as `r2Bucket` on the typed `KoolbaseObject`.
  Defaults to `'koolbase-storage'` when the field is absent (older
  cached responses, non-Koolbase JSON) so existing code keeps
  decoding without crashes.

### Compatibility

No breaking changes. `getDownloadUrl` already returns the CDN URL
for objects in public buckets since the server-side Gap #2 deploy on
Jun 2 2026 — this release just makes that URL constructible without
a network round-trip.

## 5.2.0

### Added — storage

- Custom object metadata. Attach arbitrary key/value pairs to stored
  objects at upload time, mutate via merge semantics post-upload, read
  alongside any `KoolbaseObject`.
  - `KoolbaseStorage.upload({ metadata })` accepts an optional
    `metadata: Record<string, string>` field on `UploadOptions`. Set
    at confirm time; REPLACES prior metadata on the `overwrite: true`
    path (matches GCS semantics — a new upload at a path produces a
    new object, not a patch of the old).
  - New `KoolbaseStorage.updateMetadata(bucket, path, metadata)`
    method with merge semantics: keys with a non-null string value
    are set/updated, keys with `null` are deleted, keys absent from
    the payload are untouched. One call handles add, update, and
    delete atomically.
  - `KoolbaseObject` gains a `metadata: Record<string, string>` field.
    Always non-null — empty object `{}` when no metadata is set —
    so callers can treat it as a guaranteed record without null
    checks. Defensive decode handles missing/null `metadata` field
    gracefully so older cached responses don't crash the mapper.
- New `KoolbaseStorageMetadataInvalidError` (extends
  `KoolbaseStorageError`) thrown for server-side validation
  failures (HTTP 400, code `metadata_invalid`). Its `detail` field
  names the failing key and rule (e.g. `key "bad key": must match
  [a-z0-9_]+`, `exceeds 50 keys (got 53)`) so callers can surface
  actionable errors without guessing what shape rule was violated.
- Mapper recognizes `metadata_invalid` and extracts `detail` from the
  response body.

### Notes

- Validation rules (enforced server-side): ≤50 keys per object, ≤8KB
  total (sum of all key + value lengths), keys 1–64 chars matching
  `[a-z0-9_]+`, values ≤1024 chars, leading underscore reserved for
  system keys.
- Backwards-compatible: pure additive surface. v5.1.1 → v5.2.0. Existing
  `upload()` callers without `metadata` continue working unchanged;
  catching `KoolbaseStorageError` still catches the new metadata error.
- Pairs with `koolbase_flutter` v6.2.0 (published earlier today). Same
  client surface (`upload({ metadata })`, `updateMetadata`), same error
  type semantics, same merge contract.

## 5.1.1

### Fixed — storage

- Storage error mapper now switches on lowercase wire codes
  (`path_conflict`, `quota_exceeded`, `file_too_large`, `mime_not_allowed`)
  after the server normalized storage codes to lowercase snake_case.
  Without this patch, v5.1.0 customers see generic `KoolbaseStorageError`
  instead of the typed subclass for storage limit errors. No semantic
  changes beyond the case match. Pairs with `koolbase_flutter` v6.1.1.

## 5.1.0

### Added — storage

- Three new typed errors covering the bucket-limit failure modes
  introduced server-side in Storage #2. All extend
  `KoolbaseStorageError`, so existing `instanceof KoolbaseStorageError`
  catch-all blocks continue to work; check the specific type to branch
  on the kind of limit hit.
  - `KoolbaseStorageQuotaError` — 409 + `QUOTA_EXCEEDED`, thrown when
    an upload would push the bucket past its `max_size_bytes` cap.
  - `KoolbaseStorageFileTooLargeError` — 413 + `FILE_TOO_LARGE`, thrown
    when a single file exceeds the bucket's `max_file_size_bytes` cap.
  - `KoolbaseStorageMimeTypeError` — 415 + `MIME_NOT_ALLOWED`, thrown
    when an upload's content-type isn't in the bucket's
    `allowed_mime_types` allowlist (supports `type/*` wildcards).
- Mapper (`koolbaseStorageError` / `koolbaseStorageErrorFromResponse`)
  recognizes the new codes via code-first lookup and the new HTTP
  statuses (413, 415) via status fallback.

### Notes

- Backwards-compatible: pure additive surface. v5.0.0 → v5.1.0.
- Status-fallback for 409 remains `KoolbaseStorageConflictError` (path
  collisions are the more common case); modern servers always emit
  `code`, so the ambiguity only affects very old API responses.
- Pairs with `koolbase_flutter` v6.1.0 (published earlier today). Same
  three error types, same code-first mapper extension.

## 5.0.0

### Breaking — storage

- **Storage URLs realigned to current server contract.** The v3.0.0 security
  audit updated auth headers but left storage calling the old pre-refactor
  endpoints (`/v1/sdk/storage/{bucket}/upload`, `/download`, `/delete`),
  which the server no longer routes. **Storage uploads have been
  non-functional since v3.0.0.** v5.0.0 realigns to the current contract:
  `/v1/sdk/storage/upload-url`, `/confirm`, `/download-url`, `/object`.
- **3-step upload flow.** `upload()` now does presign → R2 PUT (raw binary, not
  multipart) → confirm, matching Koolbase Flutter SDK v6.0.0. Confirmation
  records the object in `storage_objects`, populates `etag`/`size`, and
  prevents the orphan reaper from deleting your file. Previous "uploads"
  bypassed confirm entirely and would have been swept on the next reaper pass.
- **`upload()` return shape changed.** Returns `UploadResult { object, downloadUrl }`
  instead of `{ url }`. `object` is the full `KoolbaseObject` metadata
  (id, size, content type, timestamps, etc.).
- **Safe-by-default uploads.** `UploadOptions` now accepts an `overwrite?: boolean`
  field, defaulting to `false`. Uploads to a path where an object already
  exists are **rejected** with a new `KoolbaseStorageConflictError` instead
  of silently overwriting. Pass `overwrite: true` to opt into the previous
  replacing behavior.
- **Storage operations now throw typed `KoolbaseStorageError` subtypes**
  instead of generic `Error` — catching `Error` still works, but catching
  the specific subclasses (or the `KoolbaseStorageError` base) gives you
  cleaner branching.

### Added

- `KoolbaseStorageError` — base class for all storage failures, mirroring
  the `KoolbaseDataError` pattern from the database layer.
- `KoolbaseStorageConflictError` (`code: PATH_CONFLICT`) — thrown when an
  upload would replace an existing object and `overwrite: false`. Exposes
  the colliding `path` from the server response.
- `KoolbaseStorageNotFoundError`, `KoolbaseStorageValidationError`,
  `KoolbaseStoragePermissionError` — typed errors for the other storage
  error classes (404, 400, 403). Storage operations now throw these
  instead of a generic `Error`.
- `koolbaseStorageError(status, body)` and
  `koolbaseStorageErrorFromResponse(res)` — code-first response-to-error
  mappers, matching the `database-errors` module pattern.
- `KoolbaseObject` and `UploadResult` types in `types.ts` — full object
  metadata is now part of the public surface.

### Migration

**If your app uploads to deterministic paths** (e.g. `avatars/${userId}.png`)
**and relied on the upload silently replacing the previous file:**

```typescript
// Before — silent overwrite
await Koolbase.storage.upload({
  bucket: 'avatars',
  path: 'me.png',
  file: { uri, name, type: 'image/png' },
});

// After — explicit overwrite
await Koolbase.storage.upload({
  bucket: 'avatars',
  path: 'me.png',
  file: { uri, name, type: 'image/png' },
  overwrite: true,
});
```

**If you want a conflict prompt** (recommended for user-supplied filenames):

```typescript
try {
  await Koolbase.storage.upload({
    bucket: 'documents',
    path: filename,
    file: { uri, name, type },
  });
} catch (e) {
  if (e instanceof KoolbaseStorageConflictError) {
    const ok = await confirm(`${e.path} already exists. Overwrite?`);
    if (ok) {
      await Koolbase.storage.upload({
        bucket: 'documents',
        path: filename,
        file: { uri, name, type },
        overwrite: true,
      });
    }
  } else {
    throw e;
  }
}
```

**If you used `const { url } = await upload(...)`:**

```typescript
// Before
const { url } = await Koolbase.storage.upload({ ... });

// After
const { object, downloadUrl } = await Koolbase.storage.upload({ ... });
const url = downloadUrl;  // if you only want the download URL
```

**If you catch generic `Error` from storage operations**, consider catching
`KoolbaseStorageError` (or specific subclasses) for cleaner branching:

```typescript
try {
  await Koolbase.storage.upload({ ... });
} catch (e) {
  if (e instanceof KoolbaseStorageConflictError) {
    // Path already exists — prompt user
  } else if (e instanceof KoolbaseStorageNotFoundError) {
    // Bucket missing or deleted
  } else if (e instanceof KoolbaseStoragePermissionError) {
    // Caller not authorized
  } else if (e instanceof KoolbaseStorageError) {
    // Any other storage error
    showError(e.message);
  } else {
    throw e;
  }
}
```

### Server requirements

- Requires a Koolbase server build with `PATH_CONFLICT` 409 support and the
  `upload-url` / `confirm` / `download-url` / `object` routes (shipped
  alongside this release).

### Verification recommended

Storage in v3.0.0–v4.2.1 was non-functional. v5.0.0 is the first working
upload path since the security audit. **Test uploads end-to-end on a real
iOS and Android device after upgrading** — RN's `fetch` Blob-PUT behavior
can vary subtly by platform.

## 4.2.1

### Fixed

- Realtime now delivers `deleted` events. v4.1.0 dropped them because `RealtimeEvent` required a `record`, which deletes don't carry. `record` is now optional and `recordId` is provided on deletes — bringing React Native to parity with Flutter.

## 4.2.0

### Fixed

- Realtime now works. The client previously hit the wrong endpoint, authenticated with the public key instead of the user session, never sent a subscribe message, and parsed the wrong event shape — so it delivered nothing. Rewritten to the real protocol: connects with the signed-in user's session, subscribes per collection, streams `created`/`updated` events, and reconnects automatically.

### Changed

- `Koolbase.realtime.subscribe(collection, cb)` no longer needs a project — it's derived from the user's session.

## 4.0.0

### Changed

- **BREAKING:** `insert` and `update` are now online-first with an offline fallback. When the server is reachable they await the response and throw typed errors on rejection — a unique-constraint conflict throws `KoolbaseConflictError` (with the offending `field`), matching `upsert`. Only a genuine network failure falls back to the optimistic local-cache + sync-queue path. Previously these methods swallowed all server errors and `insert` always returned a local-id optimistic record.

### Migration

- Wrap `insert`/`update` in `try/catch` to handle conflicts (`catch (e) { if (e instanceof KoolbaseConflictError) … }`). If you relied on the returned id beginning with `local_`, treat the returned record's `id` as authoritative instead — when online it is now the server id.

## 3.1.0

### Added

- `batch()` method on `KoolbaseDatabase` for atomic multi-operation writes — runs `insert` / `update` / `delete` / `upsert` in a single server-side transaction. Closes the parity gap with `koolbase_flutter` 5.0.0, where `batch()` shipped on the Flutter side only. Online-only by design; throws on network failure rather than queuing.
- `BatchOp` factory and `BatchResult` interface exported from `types`.

## 3.0.0

### BREAKING — security

- Data-plane requests (database, storage, functions, offline sync) now
  authenticate with the signed-in user's access token (Authorization: Bearer)
  instead of the x-user-id header. The header is no longer sent or trusted.
  Requires the matching Koolbase server build.
- End-user identity flows automatically from the active session — nothing to
  pass on db/storage calls. owner/authenticated collections require an active
  session.

### Added

- KoolbaseAuth.validAccessToken() — returns a currently-valid token,
  refreshing near expiry; the data-plane clients pull from it per request so
  identity follows the live session.

### Fixed

- Offline writes are now replayed with the user's identity (previously synced
  anonymously through the sync engine).

## 2.4.0

- **Code Push — mandatory bundles.** The SDK now honors a bundle's `mandatory` flag. When a mandatory bundle is staged:
  - `Koolbase.codePush.hasMandatoryUpdate` returns `true` — read it on app resume to gate your UI.
  - The optional `onMandatoryUpdate` callback on the config passed to `Koolbase.initialize()` fires with `{ version, bundleId }` so you can prompt the user to restart.
- No breaking changes.

## 2.3.0

- Auth errors are now selected from the server's stable error `code` (with
  status/message fallback for older servers), retiring message string-matching.
- New typed data-layer errors — KoolbaseNotFoundError, KoolbaseValidationError,
  KoolbasePermissionError, KoolbaseRateLimitError — plus a shared
  KoolbaseDataError base. query/get/upsert/deleteWhere now throw these
  (code-first) instead of a generic Error.
- KoolbaseConflictError now exposes the collided `field` and extends
  KoolbaseDataError.

## 2.2.0

- Added `KoolbaseConflictError`, thrown by `upsert` on a unique-constraint violation (HTTP 409). insert/update are optimistic/offline-first and surface conflicts at sync time, not as a thrown error.

## 2.1.0

- Added `Koolbase.db.upsert(collection:, match:, data:)` — insert-or-update by a match filter; returns `KoolbaseUpsertResult { record, created }`. Online-only.
- Added `Koolbase.db.deleteWhere(collection:, filters:)` — bulk delete by filter; returns the number of records deleted. Online-only.

## 2.0.0

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

## 1.11.0

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

## 1.10.1

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

## 1.10.0

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

## 1.9.0

### Fixed (critical)

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

## 1.6.1

### Changed

- README update — Logic Engine v2 operators.

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

## 1.3.1

### Changed

- Updated README — added Code Push, Analytics, Logic Engine sections,
  clearer get started guide.

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

## 1.0.0

### Initial release

- Auth — register, login, logout, current user.
- Database — insert, query, get, update, delete, populate.
- Storage — upload, download, delete.
- Realtime — WebSocket subscriptions.
- Functions — invoke deployed functions.
- Feature flags and remote config.
- Version enforcement.
