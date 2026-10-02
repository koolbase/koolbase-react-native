# Changelog

Each version covers all three packages: @koolbase/core, @koolbase/react-native and
@koolbase/js. Earlier history: https://docs.koolbase.com/changelog

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
