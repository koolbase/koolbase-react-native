#!/usr/bin/env node
/**
 * Dual build: ESM and CommonJS from one TypeScript source.
 *
 * Node decides a .js file's module system from the nearest package.json's
 * "type" field, so each output directory gets a two-line package.json saying
 * what it contains. Without those, Node reads dist/esm/index.js as CommonJS
 * (the root package has no "type") and an `import` fails at the first
 * `export` statement — the classic dual-build trap, which no amount of
 * correct "exports" configuration fixes.
 *
 * Declarations are emitted for both, because a TypeScript consumer resolving
 * through "import" reads the ESM .d.ts and one resolving through "require"
 * reads the CJS one; a single shared .d.ts misreports the module system under
 * "moduleResolution": "node16" and newer.
 */

const { execSync } = require('node:child_process');
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const pkg = process.argv[2];
if (!pkg) {
  console.error('usage: node scripts/build-package.js <core|react-native|js>');
  process.exit(1);
}

const root = join(__dirname, '..', 'packages', pkg);
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

run('npx tsc -p tsconfig.cjs.json');
run('npx tsc -p tsconfig.esm.json');

for (const [dir, type] of [['cjs', 'commonjs'], ['esm', 'module']]) {
  const out = join(root, 'dist', dir);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'package.json'), JSON.stringify({ type }, null, 2) + '\n');
}

console.log(`built ${pkg}: dist/cjs (commonjs) + dist/esm (module)`);
