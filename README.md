# Koolbase SDKs

One TypeScript core, one platform adapter per host, one test suite that runs
against every adapter.

Documentation: https://docs.koolbase.com

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

All three packages share one version, bumped together. A platform package pins its core
dependency to the exact same version. Changes are listed in [CHANGELOG.md](CHANGELOG.md);
earlier history is at https://docs.koolbase.com/changelog.

## Releasing

1. On a branch: bump the version in all three `packages/*/package.json` (and the platform
   packages' `@koolbase/core` dependency), add a `## x.y.z` section to `CHANGELOG.md`, and
   open a pull request.
2. Merge it. The release workflow tags `vx.y.z` and creates the GitHub release from that
   changelog section. It stops if the three versions disagree.
3. From the merged `main`: `npm run build`, then publish in dependency order:
   `@koolbase/core`, then `@koolbase/react-native`, then `@koolbase/js`, each with
   `npm publish -w <name> --access public`.
4. A new version can take a few minutes to appear on npm. Don't publish it again while it
   propagates: npm refuses a version it has already received.

MIT
