#!/usr/bin/env node
//
// Set the project's release version across every source-of-truth file.
//
// Usage:
//   pnpm version:set 1.2.3
//
// Writes:
//   - package.json                "version": "1.2.3"
//   - src-tauri/Cargo.toml        version = "1.2.3"
//
// Does NOT touch:
//   - src-tauri/tauri.conf.json   reads version from "../package.json"
//   - src-tauri/gen/android/...   versionName synced by Tauri, versionCode
//                                 derived in build.gradle.kts from versionName
//
// Refuses if a git tag `v<x.y.z>` already exists — that tag is our marker for
// "this version shipped to Google Play", so re-using the semver would also
// re-use the computed Android versionCode (MAJOR*10000+MINOR*100+PATCH) and
// Play Console would reject the upload.
//
// Prerelease suffixes (e.g. -rc.1) are NOT accepted: the Android versionCode
// formula strips them, so 1.2.3-rc.1 and 1.2.3 would map to the same code and
// collide on Play Store. If we ever want a prerelease workflow, the formula
// has to encode the suffix into the integer first.
//
// Leaves changes staged but uncommitted. Suggested next steps are printed.

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function tagExists(tag) {
  try {
    const out = execSync(`git tag -l ${tag}`, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    return out.trim() === tag;
  } catch {
    return false;
  }
}

const version = process.argv[2];
if (!version) die('usage: pnpm version:set <x.y.z>');

const match = version.match(SEMVER_RE);
if (!match)
  die(
    `"${version}" is not valid semver (expected x.y.z; prereleases not supported — ` +
      `they collide on the derived Android versionCode)`,
  );
const [, majorStr, minorStr, patchStr] = match;
const [major, minor, patch] = [majorStr, minorStr, patchStr].map(Number);
if (major > 99 || minor > 99 || patch > 99) {
  die(
    `each semver component must be ≤ 99 (Android versionCode formula caps there)`,
  );
}

const tag = `v${version}`;
if (tagExists(tag)) {
  die(
    `git tag ${tag} already exists — that release has shipped to Google Play.\n` +
      `  bump to the next version instead; re-uploading the same versionCode is rejected.`,
  );
}

// package.json: write only the version field, preserve the rest verbatim.
const pkgPath = resolve(REPO_ROOT, 'package.json');
const pkgRaw = readFileSync(pkgPath, 'utf8');
const pkgUpdated = pkgRaw.replace(
  /^(\s*"version":\s*")[^"]*(",?\s*)$/m,
  (_m, prefix, suffix) => `${prefix}${version}${suffix}`,
);
if (pkgUpdated === pkgRaw)
  die('failed to update package.json — version field not found');
writeFileSync(pkgPath, pkgUpdated);

// Cargo.toml: write only the [package].version line; first `version = "..."`
// in the file is the package version (Cargo TOML convention).
const cargoPath = resolve(REPO_ROOT, 'src-tauri/Cargo.toml');
const cargoRaw = readFileSync(cargoPath, 'utf8');
const cargoUpdated = cargoRaw.replace(
  /^(version\s*=\s*")[^"]*(")/m,
  (_m, prefix, suffix) => `${prefix}${version}${suffix}`,
);
if (cargoUpdated === cargoRaw)
  die('failed to update Cargo.toml — version line not found');
writeFileSync(cargoPath, cargoUpdated);

const androidVersionCode = major * 10000 + minor * 100 + patch;

console.log(`version: ${version}`);
console.log(`android versionCode (derived): ${androidVersionCode}`);
console.log();
console.log('wrote:');
console.log('  package.json');
console.log('  src-tauri/Cargo.toml');
console.log();
console.log('next:');
console.log(`  git add package.json src-tauri/Cargo.toml`);
console.log(`  git commit -m "chore: release ${tag}"`);
console.log(`  git tag -a ${tag} -m "Release ${tag}"`);
console.log(`  git push && git push --tags`);
console.log(`  pnpm android:container:build:release`);
console.log(`  gh release create ${tag} --generate-notes`);
