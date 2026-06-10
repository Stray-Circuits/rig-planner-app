#!/usr/bin/env node
// Verifies the Android build container's pinned toolchain versions still
// satisfy what the project actually requires. Catches the class of drift
// where a dep bump silently raises a floor (e.g. Vite 8 raising Node to
// >=22.12) without anyone touching scripts/android/Dockerfile.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(repoRoot, rel), 'utf8');

// Tiny semver — only the shapes our inputs use: bare "X.Y.Z", "^X.Y.Z",
// ">=X.Y.Z", joined by " || ". Anything else throws so we notice.
function parseVersion(v) {
  const m = String(v).match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}
function cmp(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) throw new Error(`Cannot parse version "${version}"`);
  return range
    .split('||')
    .map((s) => s.trim())
    .some((clause) => {
      if (clause.startsWith('>=')) {
        const min = parseVersion(clause.slice(2).trim());
        return min !== null && cmp(v, min) >= 0;
      }
      if (clause.startsWith('^')) {
        const min = parseVersion(clause.slice(1).trim());
        if (min === null) return false;
        const upper = [min[0] + 1, 0, 0];
        return cmp(v, min) >= 0 && cmp(v, upper) < 0;
      }
      const exact = parseVersion(clause);
      if (exact === null)
        throw new Error(`Unsupported range clause "${clause}"`);
      return cmp(v, exact) === 0;
    });
}

const dockerfile = read('scripts/android/Dockerfile');
const arg = (name) => {
  const m = dockerfile.match(new RegExp(`^ARG\\s+${name}=(\\S+)`, 'm'));
  if (!m) throw new Error(`Missing ARG ${name} in scripts/android/Dockerfile`);
  return m[1];
};
const baseImageSdk = (() => {
  const m = dockerfile.match(
    /^FROM\s+ghcr\.io\/cirruslabs\/android-sdk:(\d+)/m,
  );
  if (!m)
    throw new Error(
      'Cannot find FROM ghcr.io/cirruslabs/android-sdk:NN in Dockerfile',
    );
  return Number(m[1]);
})();

const containerNode = arg('NODE_VERSION');
const containerRust = arg('RUST_VERSION');

const viteEngines = JSON.parse(read('node_modules/vite/package.json')).engines
  ?.node;
if (!viteEngines)
  throw new Error('vite is not installed or declares no engines.node');

const cargoToml = read('src-tauri/Cargo.toml');
const cargoRustMin = cargoToml.match(/^rust-version\s*=\s*"([\d.]+)"/m)?.[1];
if (!cargoRustMin)
  throw new Error('Cannot find rust-version in src-tauri/Cargo.toml');

const appGradle = read('src-tauri/gen/android/app/build.gradle.kts');
const compileSdk = Number(appGradle.match(/compileSdk\s*=\s*(\d+)/)?.[1]);
if (!Number.isFinite(compileSdk)) {
  throw new Error(
    'Cannot find compileSdk in src-tauri/gen/android/app/build.gradle.kts',
  );
}

const errors = [];

if (!satisfies(containerNode, viteEngines)) {
  errors.push(
    `Dockerfile NODE_VERSION=${containerNode} does not satisfy vite engines.node="${viteEngines}". ` +
      `Bump NODE_VERSION in scripts/android/Dockerfile.`,
  );
}

if (!satisfies(containerRust, `>=${cargoRustMin}`)) {
  errors.push(
    `Dockerfile RUST_VERSION=${containerRust} is below src-tauri/Cargo.toml rust-version=${cargoRustMin}. ` +
      `Bump RUST_VERSION in scripts/android/Dockerfile.`,
  );
}

if (baseImageSdk < compileSdk) {
  errors.push(
    `Dockerfile base image ships Android SDK ${baseImageSdk}, but compileSdk in ` +
      `src-tauri/gen/android/app/build.gradle.kts is ${compileSdk}. Bump the FROM tag in ` +
      `scripts/android/Dockerfile to ghcr.io/cirruslabs/android-sdk:${compileSdk} so the SDK ` +
      `is baked in instead of downloaded at build time.`,
  );
}

if (errors.length > 0) {
  console.error('Android build container pins are out of date:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('Android build container pins OK:');
console.log(
  `  NODE_VERSION=${containerNode} satisfies vite engines.node="${viteEngines}"`,
);
console.log(
  `  RUST_VERSION=${containerRust} satisfies Cargo.toml rust-version=${cargoRustMin}`,
);
console.log(`  Base image SDK ${baseImageSdk} >= app compileSdk ${compileSdk}`);
