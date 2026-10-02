#!/usr/bin/env node
/**
 * The packages' entry points, checked on the BUILT packages (npm run build
 * first): what each entry pulls in, followed through every import and require
 * in dist/esm and dist/cjs, and real consumers compiled against them.
 *
 *   @koolbase/core, @koolbase/js         never reach react or react-native
 *   @koolbase/core/react, @koolbase/js/react   reach react, never react-native
 *   a React Native app's imports, unchanged from 12.9.0, still compile
 *   a DOM app compiles against @koolbase/js(+/react) without React Native's types
 *   the hooks of both packages are the same functions' types
 */
const { readFileSync, existsSync } = require('node:fs');
const { join, dirname, resolve } = require('node:path');
const { execSync } = require('node:child_process');

const root = join(__dirname, '..');
const dirs = { '@koolbase/core': 'packages/core', '@koolbase/react-native': 'packages/react-native', '@koolbase/js': 'packages/js' };
const problems = [];

function entryFile(spec, kind) {
  const m = /^(@koolbase\/[^/]+)(?:\/(.+))?$/.exec(spec);
  if (!m || !dirs[m[1]]) return null;
  const pj = JSON.parse(readFileSync(join(root, dirs[m[1]], 'package.json'), 'utf8'));
  const key = m[2] ? './' + m[2] : '.';
  const e = pj.exports && pj.exports[key];
  if (!e) { problems.push(`${spec}: no "${key}" in its exports`); return null; }
  return join(root, dirs[m[1]], e[kind === 'esm' ? 'import' : 'require'].default);
}

const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;
function reaches(spec, kind) {
  const start = entryFile(spec, kind);
  const bare = new Set(), seen = new Set(), todo = start ? [start] : [];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!existsSync(f)) { problems.push(`${spec} (${kind}): ${f} does not exist -- built?`); continue; }
    for (const m of readFileSync(f, 'utf8').matchAll(SPEC)) {
      const s = m[1];
      if (s.startsWith('.')) {
        let p = resolve(dirname(f), s);
        if (!p.endsWith('.js')) p = existsSync(p + '.js') ? p + '.js' : join(p, 'index.js');
        todo.push(p);
      } else {
        bare.add(s);
        const inner = entryFile(s, kind);
        if (inner) todo.push(inner);
      }
    }
  }
  return bare;
}
const has = (set, name) => [...set].some((s) => s === name || s.startsWith(name + '/'));

for (const kind of ['esm', 'cjs']) {
  for (const spec of ['@koolbase/core', '@koolbase/js']) {
    const r = reaches(spec, kind);
    if (has(r, 'react')) problems.push(`${spec} (${kind}) reaches react`);
    if (has(r, 'react-native')) problems.push(`${spec} (${kind}) reaches react-native`);
  }
  for (const spec of ['@koolbase/core/react', '@koolbase/js/react']) {
    const r = reaches(spec, kind);
    if (!has(r, 'react')) problems.push(`${spec} (${kind}) does not reach react`);
    if (has(r, 'react-native')) problems.push(`${spec} (${kind}) reaches react-native`);
  }
}

// The stub folders, for resolvers that ignore "exports".
for (const pkg of ['core', 'js']) {
  const stub = JSON.parse(readFileSync(join(root, 'packages', pkg, 'react', 'package.json'), 'utf8'));
  for (const k of ['main', 'module', 'types']) {
    if (!existsSync(join(root, 'packages', pkg, 'react', stub[k]))) problems.push(`packages/${pkg}/react: ${k} ${stub[k]} does not exist`);
  }
}

// Consumers, compiled.
const fx = join(root, 'scripts', 'entry-fixtures');
for (const cfg of ['tsconfig.rn.json', 'tsconfig.rn-node10.json', 'tsconfig.dom.json', 'tsconfig.same.json']) {
  try { execSync(`npx tsc -p ${join(fx, cfg)}`, { cwd: root, stdio: 'pipe' }); }
  catch (e) { problems.push(`${cfg}: does not compile\n${String(e.stdout || '')}${String(e.stderr || '')}`); }
}
const domFiles = execSync(`npx tsc -p ${join(fx, 'tsconfig.dom.json')} --listFilesOnly`, { cwd: root, encoding: 'utf8' });
if (/[\\/]node_modules[\\/]react-native[\\/]/.test(domFiles)) problems.push('the DOM consumer compiles against React Native\'s types');

if (problems.length) {
  console.error('check:entries FAILED\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('check:entries: core and js never reach React; their ./react entries reach React, never React Native (esm and cjs); the stubs resolve; a React Native app\'s 12.9.0 imports compile (bundler and node10); a DOM app compiles without React Native; both packages\' hooks are the same');
