# Changelog

Each version covers all three packages: @koolbase/core, @koolbase/react-native and
@koolbase/js. Earlier history: https://docs.koolbase.com/changelog

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
