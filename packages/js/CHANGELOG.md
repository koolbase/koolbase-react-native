# Changelog

All notable changes to `@koolbase/js` are documented in this file. The format
is based on [Keep a Changelog][kac], and this project adheres to
[Semantic Versioning][semver].

[kac]: https://keepachangelog.com/en/1.1.0/
[semver]: https://semver.org/

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

