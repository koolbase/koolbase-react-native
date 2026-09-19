#!/usr/bin/env bash
# Metro certification for @koolbase/react-native.
#
# Plain Node cannot smoke-test this package: its peer dependencies ship ESM
# builds that only Metro resolves, so a Node failure inside AsyncStorage says
# nothing about our package. Metro is the only authority, and this is the
# cheapest honest form of it — a real bundle for a real platform, no device,
# no simulator, no Xcode.
#
# It tests the PACKED tarballs, not the workspace sources. A workspace install
# symlinks and can resolve files the published tarball omits; that difference
# is exactly where packaging bugs live.
#
# Run from the repo root after `npm run build`:
#     bash fixtures/metro/certify.sh            # uses /tmp/kbtar
#     bash fixtures/metro/certify.sh <tgz-dir>
#
# Exits non-zero if Metro cannot resolve or bundle the SDK.
set -euo pipefail

TAR_DIR=$(cd "${1:-/tmp/kbtar}" && pwd)
APP=/tmp/kbmetro
PLATFORMS="${PLATFORMS:-android ios}"

for t in koolbase-core koolbase-react-native; do
  ls "$TAR_DIR/$t"-*.tgz >/dev/null 2>&1 || {
    echo "missing $t tarball in $TAR_DIR — run: for p in core react-native js; do (cd packages/\$p && npm pack --pack-destination $TAR_DIR); done" >&2
    exit 1
  }
done

echo "--- scaffolding a blank Expo app (no prompts) ---"
rm -rf "$APP"
# --yes takes every default; the blank template is the smallest thing Metro
# will bundle. Scaffolding rather than committing an app keeps the fixture
# honest against whatever Expo and Metro are current.
# The bare template name makes create-expo-app ask which SDK to use, and a
# prompt in a script is a hang. Naming the published template package pins it
# and skips the question.
npx --yes create-expo-app@latest "$APP" --template expo-template-blank --no-install < /dev/null
cd "$APP"

echo "--- installing the app's own dependencies ---"
npm install --no-audit --no-fund --loglevel=error

echo "--- installing the packed SDK and its peers ---"
npm install --no-audit --no-fund --loglevel=error \
  "$TAR_DIR"/koolbase-core-*.tgz \
  "$TAR_DIR"/koolbase-react-native-*.tgz
# The peers the SDK declares. Keychain is optional and deliberately omitted:
# a bundle must succeed without it, since that is how most apps start.
npx --yes expo install @react-native-async-storage/async-storage @react-native-community/netinfo

echo "--- app code that touches every entry point ---"
cat > App.js <<'JS'
import { Text, View } from 'react-native';
import {
  Koolbase,
  KoolbaseAuth,
  KoolbaseDatabase,
  KoolbaseError,
  KoolbaseUnauthenticatedError,
  RestoreResult,
  SecureAuthStorage,
  reactNativePlatform,
} from '@koolbase/react-native';

// Referenced, not called: Metro must resolve and bundle every one of these,
// including the platform adapter that imports the native modules. Calling
// them would need a device; resolving them is what this certifies.
const surface = [
  typeof Koolbase.initialize,
  typeof KoolbaseAuth,
  typeof KoolbaseDatabase,
  typeof KoolbaseError,
  typeof KoolbaseUnauthenticatedError,
  typeof RestoreResult,
  typeof SecureAuthStorage,
  typeof reactNativePlatform,
].join(',');

export default function App() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>koolbase surface: {surface}</Text>
    </View>
  );
}
JS

FAILED=0
for platform in $PLATFORMS; do
  echo "--- metro bundle: $platform ---"
  if npx expo export --platform "$platform" --output-dir "dist-$platform" >"/tmp/metro-$platform.log" 2>&1; then
    echo "BUNDLE OK ($platform)"
  else
    echo "BUNDLE FAILED ($platform) — tail of /tmp/metro-$platform.log:"
    tail -25 "/tmp/metro-$platform.log"
    FAILED=1
  fi
done

if [ "$FAILED" -ne 0 ]; then
  echo
  echo "Metro could not bundle the packed SDK. This is a release blocker for"
  echo "@koolbase/react-native regardless of what Node or the browser said."
  exit 1
fi

echo
echo "--- what Metro produced ---"
for platform in $PLATFORMS; do
  # Hermes bytecode, so its contents are not greppable for a module name.
  # Size is the honest signal: a bundle that resolved the SDK is materially
  # larger than an empty app, and a missing file means the export silently
  # produced nothing.
  bundle=$(find "dist-$platform" -type f \( -name '*.hbc' -o -name '*.js' \) | head -1)
  if [ -z "$bundle" ]; then
    echo "$platform: NO BUNDLE PRODUCED"
    exit 1
  fi
  printf '%s: %s (%s bytes)\n' "$platform" "$(basename "$bundle")" "$(wc -c < "$bundle" | tr -d ' ')"
done

echo "METRO CERTIFICATION PASSED for $PLATFORMS"
