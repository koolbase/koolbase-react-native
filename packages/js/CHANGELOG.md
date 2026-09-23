# Changelog

All notable changes to `@koolbase/js` are documented in this file. The format
is based on [Keep a Changelog][kac], and this project adheres to
[Semantic Versioning][semver].

[kac]: https://keepachangelog.com/en/1.1.0/
[semver]: https://semver.org/

## 12.2.0

### Added

- **Two-step sign-in (MFA).** Every sign-in method now throws `MfaRequiredError`
  carrying a `challengeToken` when the person's account has an authenticator on
  — including phone, Google and Apple, whose error parsers all map it, enforced
  by a source test for any parser added later. `verifyMfa({ challengeToken, code
  })` and `verifyRecoveryCode({ challengeToken, code })` finish sign-in and
  store the session, returning `{ session, recoveryCodesRemaining }` for the
  latter.
- `enrollMfa()`, `confirmMfaEnrollment(code)`, `mfaStatus()`, `stepUpMfa(…)`,
  `disableMfa()`, and `regenerateRecoveryCodes()` manage it. Six new error
  classes in the mapping table and fidelity list.

## 12.1.0

### Added

- **Sign in with an emailed code.** `auth.requestEmailCode({ email })` sends a
  six-digit code; `auth.signInWithEmailCode({ email, code })` signs in and
  stores the session exactly as `login()` does. An unknown address becomes an
  account only while the project accepts sign-ups. Each code works once and
  allows three attempts. The request resolves the same way whether or not the
  address has an account. A project can switch this off; requests then throw
  `EmailCodeDisabledError`.
- **Fiscal.** `KoolbaseFiscal` with `submit()` and `status()`, and
  `KoolbaseFiscalError`. A timeout on `submit` means poll `status()` with the
  same `clientRef` — do not submit again, or the sale may be recorded twice.
- **Reference errors are catchable.** `KoolbaseReferenceInvalidError`,
  `KoolbaseReferenceInUseError`, `KoolbaseDanglingReferencesError` (carrying
  the offending records) and `KoolbaseCollectionReferencedError`.

### Changed

- The OTP errors (`OtpInvalidError`, `OtpExpiredError`,
  `OtpMaxAttemptsError`) now come from the shared error mapping, so every path
  that returns them throws the class an app catches.
- `oauthLogin()`'s deprecation now points to `signInWithGoogle()` and
  `signInWithApple()`. It said OAuth was not yet shipped and to use email and
  password instead, which had long stopped being true.

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

### Added

- **Multiple tabs are coordinated.** Tabs on one origin share one IndexedDB
  and one offline queue. Two locks, through the Web Locks API, now keep them
  honest: a short exclusive lock around every read-modify-write of the
  offline state, so two tabs enqueueing at once cannot overwrite each other;
  and a lease on replaying the queue, held for a whole flush including its
  HTTP calls, so two tabs coming online together send each queued write once
  rather than once each. A tab that cannot take the lease skips its pass and
  rechecks once the holder is done, so a write queued during another tab's
  flush is not stranded. A tab that closes mid-flush releases its lock
  automatically. In a browser without Web Locks — none current — offline
  queueing refuses with an explicit error rather than risking a double send.

  Proven with a contended fake lock manager: two tabs, one queued write, one
  HTTP request. Exercised in Chrome with real Web Locks.

## 10.1.0

### Fixed

- **Uploads could not work from a browser.** `upload()` required
  `{ uri, name, type }` — a React Native shape — and fetched that URI to get
  the bytes. A browser `File` has no `uri`, so every upload from the web
  failed before it reached the network, while the README showed a file input
  as if it worked. `file` now accepts a `Blob` or `File` directly and the
  React Native form is unchanged. Round-tripped in a browser: upload,
  download, byte-for-byte comparison.

### Added

- **`storageTier()`** on the browser adapter — `'indexeddb'`,
  `'localstorage'` or `'memory'`. Storage is now chosen by *trying* each
  store rather than checking whether the API exists: Safari in private
  browsing exposes `indexedDB` and may refuse to open it, and a browser with
  site data blocked exposes `localStorage` and throws on write. A failure at
  any tier falls to the next, ending in memory with one console warning. An
  app can read the tier and tell the user their session will not survive a
  reload.

## 10.0.2

### Fixed

- **A Node process that initialized the SDK never exited.** The analytics
  flush interval, and a pending realtime reconnect, counted as work on Node's
  event loop, so a CLI, a test runner or an SSR build step hung after its last
  line. Both timers are now unref'd where the runtime supports it. A browser
  is unaffected: the page keeps itself alive regardless.

## 10.0.1

### Fixed

- **`restoreSession()` threw in Node.** With no `indexedDB`, the adapter fell
  through to `localStorage`, which does not exist on a server either — so a
  Next.js server render, or any tooling that imports the SDK, crashed with
  `ReferenceError: localStorage is not defined`. Storage now falls back to an
  in-memory store when neither is present, and a server render reports
  `NoSession` rather than failing.

  Note what this is not: server-side authentication. This package holds one
  session per process, which is correct for a browser tab and wrong for a
  server handling many users. It renders without crashing; it is not a way to
  sign users in on a server.

## 10.0.0

The first release. Numbered to match `@koolbase/react-native` and
`@koolbase/core`, which share one version and one core: this package is that
core composed for a browser, with sixty behavioural tests run against the
browser adapter before it shipped.

### What is here

- **Auth** — email and password, phone + OTP, session persistence across
  reloads, `restoreSession()`, `onAuthStateChange`, password reset, email
  verification. Google and Apple sign-in through their web OAuth flows,
  passing the ID token to the same `signInWithGoogle` / `signInWithApple`.
- **Database** — insert, query, update, delete, upsert, bulk delete, atomic
  batches, populate, and semantic / lexical / hybrid search.
- **Offline** — cached reads, a durable write queue with baselines,
  `pendingWrites()`, and conflicts you resolve four ways. Same semantics as
  React Native, same tests.
- **Storage** — presigned upload and download, safe-by-default paths, bucket
  limits as typed errors, public CDN URLs with image transforms, versioning.
- **Realtime** — one shared WebSocket, backoff on reconnect, events filtered
  by the collection's read rule.
- **Functions**, **feature flags**, **remote config**, **version
  enforcement**, **analytics**.

### What is not, by design

- **Code push** — a native-bundle concept; the web ships on deploy.
- **Push messaging** — FCM tokens come from a native module. Use Web Push
  through a service worker and your backend.
- **Native Google / Apple sign-in** — use the web OAuth flows.

### Known limitations in this release

- **Single tab.** Two tabs share one IndexedDB and one write queue. Inserts
  are idempotent so the damage is bounded, but a conflict resolved in one tab
  can be re-resolved in another. Multi-tab coordination is next.
- **Session storage is not a keychain.** IndexedDB is readable by any script
  on the page. Inject your own `KoolbaseAuthStorage` if your threat model
  needs an httpOnly cookie or similar; the README says more.

