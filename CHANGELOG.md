# Changelog

Each version covers all three packages: @koolbase/core, @koolbase/react-native and
@koolbase/js. Earlier history: https://docs.koolbase.com/changelog

## 12.13.0

- **Realtime for signed-out visitors.** With nobody signed in, live lists and live record views on a collection anyone can read (read rule `public`) now update live: the SDK connects with the project's public key. Any other collection behaves as a normal list or view until a user signs in. Needs the Koolbase API from 2026-10-04 or later.
- **Follows sign-in and sign-out.** Signing in, signing out or switching user replaces the realtime connection with one for the new session and resubscribes everything; a token refresh for the same user changes nothing. `KoolbaseRealtime.sessionChanged()` does this; `@koolbase/js` and `@koolbase/react-native` call it from `onAuthStateChange`.
- **Never public-only by mistake.** Signed in without a usable token right now, or a token that fails to refresh: the SDK tries again later, as before, rather than drop to public-only.
- **Tested.** The public-key connection and its messages, events reaching subscribers, no fallback while signed in, sign-in and sign-out replacing the connection, a refresh keeping it, nothing opened with nothing subscribed, and a session change while the token is on its way.

## 12.12.0

- **Live record views: `useRecord(collection, id, { live: true })`** (also `new KoolbaseRecordController(db, collection, id, { live: true })`). When Koolbase realtime reports a change to THIS record, it is read again silently -- no `refreshing` state -- and a burst of changes within 250 ms is one read. When it is deleted, the view is `notFound` at once, and a read still in flight is dropped. Changes to other records in the collection are ignored: no extra reads.
- **One connection.** Live records and live lists share the app's single realtime connection (12.11.1).
- **Needs a signed-in user**, as realtime does; until there is one, a live record view behaves as a normal one. With no id there is nothing to follow and nothing subscribes. Without the option nothing changes.
- **Tested.** A silent re-read on a change, other records ignored, one read for a burst, a delete at once and without a read, a delete dropping a pending re-read, no subscription unless live or without an id, dispose unsubscribing and cancelling, and a live view without a realtime client.

## 12.11.1

- **One realtime connection per app, closed when nothing needs it.** Subscriptions made while the session token was still being read -- two live lists on one screen, React's development double start -- each opened their own connection, and every one but the last stayed open for good. The client now claims the connection before reading the token, so they all share one.
- **An unused connection closes.** When the last subscriber leaves, the connection closes after a moment (`KoolbaseRealtime.idleGraceMs`, 1 s). A subscriber back within it -- navigating back to a screen -- keeps the same connection; one after it opens a fresh one at once. Nothing reconnects without a subscriber.
- **Sturdier.** A token that fails to load, or a connection that cannot be created, no longer leaves the client stuck; if everyone left before the token arrived, nothing is opened; unsubscribing twice is harmless.
- **Tested** with a stand-in WebSocket: one connection for many subscriptions, unsubscribing only when the last subscriber leaves, the close after the moment and no reconnect, reuse within the moment, a fresh connection after it, nothing opened for nobody, and recovery from a failed token.

## 12.11.0

- **Live lists: `useCollection(collection, { ..., live: true })`.** When Koolbase realtime reports a record created, updated or deleted in the collection, the list re-reads its first page silently, as it does after the app's own writes -- no `refreshing` state, and a burst of changes within 250 ms is one read. The list's own query is what re-runs, so filters, order, read rules and paging stay exactly right. Also on `KoolbaseCollectionController` (`CollectionQuery.live`).
- **Needs a signed-in user**, as realtime does. Until there is one, a live list behaves as a normal list. Without the option nothing changes, including the cache key of every existing query.
- **Tested.** A silent re-read on an event, one read for a burst, no subscription unless live, dispose unsubscribing and cancelling a pending re-read, a live list without a realtime client, and the query key.

## 12.10.0

- **`useCollection` and `useRecord` in the browser: `@koolbase/js/react`.** The same hooks React Native apps use, bound to `@koolbase/js`'s `Koolbase`: `import { useCollection, useRecord } from '@koolbase/js/react'`. A separate entry on purpose -- `import { Koolbase } from '@koolbase/js'` never loads React, and `react` is an optional peer dependency, so apps without React need nothing new.
- **One implementation.** The hooks move from `@koolbase/react-native` to `@koolbase/core/react` (not core's root entry), which both packages export. `@koolbase/react-native` exports `useCollection`, `useRecord`, `UseCollectionResult` and `UseRecordResult` exactly as before: no import changes.
- **Tested.** The hooks' first direct tests (loading, refresh, error, notFound, a changed query or id never showing the previous answer, unmount), and a check on the built packages that core and `@koolbase/js` never reach React, the React entries never reach React Native, and a 12.9.0 React Native app's imports still compile.

## 12.9.0

- **Storage: `publicUrlFor({ bucket, path, transform })`**, the CDN URL for a file in a public bucket using the project identity the SDK learned at bootstrap -- no `projectId` argument, as Flutter's `publicUrlFor`. While identity is unavailable (the first bootstrap has not completed) it throws `KoolbaseStorageProjectIdentityError` (code `project_identity_unavailable`) and nudges a background bootstrap refresh, so a later call in the same session succeeds.
- **Bootstrap at initialize**: `initialize` now fetches the bootstrap payload (flags, remote config, version policy, project identity) in the background, as the Flutter SDK does. It never blocks startup. Flags expose `projectId()` and `refresh()`.

## 12.8.0

- **Conditional writes.** `update(id, data, { expectedRevision })` and `delete(id, { expectedRevision })` apply only if the record still carries that revision; otherwise they throw `KoolbaseRevisionMismatchError`, as the Flutter SDK's `update` and `delete` do (`expected_revision` in the body and in the URL respectively). Without the option both behave exactly as before.
- **A write refused as stale refreshes the live lists.** On a revision mismatch the collection's open queries re-run (every one when the collection is not known), so a list already shows the newer data; the error is thrown unchanged.
- **Post-write refreshes run in the background**, as the Flutter SDK's do. 12.7.0 awaited them, so every write waited for every live list on its collection to reload before resolving.

## 12.7.0

- **Live lists refresh after a write.** Every open collection query (useCollection, KoolbaseCollectionController) re-runs after a successful insert, update, delete, upsert, batch or delete-where on its collection -- as the Flutter SDK's post-write refresh does. Silent (no `refreshing`), each query with its own filters, ordering and limit; a failure in one never stops the others. A delete of a record never read on this device refreshes every live query rather than guessing its collection. Until now a list kept what it loaded until the app was reloaded.

## 12.6.0

- **`useRecord` in `@koolbase/react-native`.** One record by id, as React state:
  `status` (`loading`, `loaded`, `notFound` or `error`), `record` and `refresh()`.
  `notFound` covers a missing id, a record that does not exist, one this user may not
  read (the API does not tell them apart), and a record from a different collection
  than the one asked for. A failed refresh keeps the record shown.
- `KoolbaseRecordController` in `@koolbase/core`: the same behaviour without React.

## 12.5.1

- `@koolbase/react-native` accepts `@react-native-async-storage/async-storage` 2.2 as well
  as 3.x, so it installs in an Expo SDK 57 app, which ships 2.2.0 (as does Expo Go, whose
  native module is fixed at that version). The SDK uses only `getItem`, `setItem`,
  `removeItem` and `getAllKeys`, which both provide.

## 12.5.0

- **`useCollection` in `@koolbase/react-native`.** A collection as React state:
  `status` (`loading`, `loaded` or `error`), `records`, `refresh()` and `loadMore()`,
  with `isFromCache`, `refreshing`, `loadingMore` and an exact `hasMore`. It shows the
  cached result first and replaces it when the server answers; a failed refresh keeps
  what is shown. Filters are equality only for now: `where: { field: value }`. Needs
  React 18 or later. If rows are added or removed on the server between pages, one can
  be skipped until `refresh()`, which reloads from the first page; none is shown twice.
- `KoolbaseCollectionController` in `@koolbase/core`: the same behaviour without React.
- `db.query(collection, { onRefresh })`: when a query is answered from the cache,
  `onRefresh` receives the server's result once the background refresh lands.
- Query cache keys no longer depend on the order of keys in the options: `{ a, b }` and
  `{ b, a }` share one cache entry. Entries cached by an earlier version are missed once
  and fetched again.

## 12.4.0

- **Analytics is now off by default.** Pass `analyticsEnabled: true` to `initialize` to
  send events. While it is off, `Koolbase.analytics` calls do nothing (the first logs how
  to turn it on), so apps that track events keep working. When it is on, the SDK also
  records `app_open`, `screen_view` and `session_end` automatically.
- `KoolbaseNetworkError.userMessage`: a short message that is safe to show to people
  ("We can't connect right now. Check your connection and try again."), alongside the
  detailed `message` for developers.

## 12.3.0

- `db.query(collection, { cache: 'network-only' })` skips the local cache and waits for
  the server; the result still refreshes the cache. For data changed by a Function, a
  server or another user.
- `db.invalidate(collection)` forgets this client's cached query results for a
  collection, so the next query waits for the server.
- Network failures throw `KoolbaseNetworkError` (still a `TypeError`), naming the host
  that could not be reached and, in a browser, the page's own address with a pointer to
  the project's Trusted Origins, instead of a bare "Failed to fetch".
- The browser adapter no longer warns about missing persistent storage outside a
  browser (Node, server rendering), where memory storage is expected.
