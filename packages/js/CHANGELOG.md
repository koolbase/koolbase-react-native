# Changelog

All notable changes to `@koolbase/js` are documented in this file. The format
is based on [Keep a Changelog][kac], and this project adheres to
[Semantic Versioning][semver].

[kac]: https://keepachangelog.com/en/1.1.0/
[semver]: https://semver.org/

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

