# Koolbase SDKs

One TypeScript core, one platform adapter per host, one test suite that runs
against every adapter.

| Package | Install it for | |
|---|---|---|
| [`@koolbase/js`](packages/js) | the browser | `npm install @koolbase/js` |
| [`@koolbase/react-native`](packages/react-native) | React Native / Expo | `npm install @koolbase/react-native` |
| [`@koolbase/core`](packages/core) | nothing — a dependency of the two above | |

## Layout

```
packages/
  core/           shared behaviour; no host assumptions; the test suite
  react-native/   composes core with AsyncStorage, NetInfo, Keychain
  js/             composes core with IndexedDB and browser events
```

## Working on it

```bash
npm install
npm run build          # core, then react-native, then js
npm test               # the suite on the in-memory platform
npm run test:browser   # the same suite on the browser adapter over fake-indexeddb
```

A change to core is proven on both adapters before it lands. A change to an
adapter is proven by the same suite against that adapter.

## Versions

All three packages share one version, bumped together. A platform package pins
its core dependency to the exact same version.

MIT
