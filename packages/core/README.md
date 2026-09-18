# @koolbase/core

The shared behaviour behind Koolbase's client SDKs. **Install a platform package,
not this one:**

- Browser — [`@koolbase/js`](https://www.npmjs.com/package/@koolbase/js)
- React Native — [`@koolbase/react-native`](https://www.npmjs.com/package/@koolbase/react-native)

Each of those depends on this package and composes it with a platform adapter
for its host: storage, connectivity, lifecycle, and session persistence. The
auth logic, database client, offline write queue, conflict resolution,
realtime, storage and functions clients all live here, once, and are proven by
one test suite run against every adapter.

This package has no runtime dependencies and makes no assumptions about its
host. If you are building a Koolbase SDK for a new platform, the
`PlatformAdapter` interface in `src/platform.ts` is the contract.

MIT
