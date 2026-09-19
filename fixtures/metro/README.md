# Metro certification fixture

`@koolbase/react-native` cannot be smoke-tested in plain Node. Its peer
dependencies — AsyncStorage, NetInfo — ship ESM builds with extensionless
relative imports that only Metro resolves, so `require('@koolbase/react-native')`
in Node fails inside *their* files and tells you nothing about ours. A green
Node test would be meaningless and a red one misleading.

Metro is the only authority. `certify.sh` is the cheapest honest form of it:
scaffold a blank Expo app, install the **packed tarballs**, and run a real
Metro bundle for Android and iOS. No device, no simulator, no Xcode.

```bash
npm run build
for p in core react-native js; do (cd packages/$p && npm pack --pack-destination /tmp/kbtar); done
bash fixtures/metro/certify.sh
```

## What it catches that nothing else does

- **Package exports under Metro.** Modern Metro resolves `exports` maps;
  older versions use `main`. Which branch it picks decides whether Hermes gets
  our CommonJS or our ESM build, and the two are not interchangeable there.
- **Tarball completeness.** A workspace install symlinks and can resolve files
  the published tarball omits. This installs what npm would serve.
- **The native peers resolving through our adapter.** `platform.ts` is the one
  file that imports AsyncStorage, NetInfo and `react-native`; if the seam is
  wrong, Metro says so here and nowhere else.
- **Bundling without `react-native-keychain`.** It is an optional peer and is
  deliberately not installed: a bundle must succeed without it, because that
  is how most apps start.

## What it does not do

It resolves and bundles; it does not run. Nothing here proves the SDK works on
a device — that needs a build and a phone, as the August device session did.
This is the gate that stops a packaging regression reaching someone who would
then have to debug Metro to find it.

## When to run it

Before publishing `@koolbase/react-native`, and after any change to the
platform seam, the build configuration, the `exports` map or the `files` list.
