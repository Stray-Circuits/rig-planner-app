#!/usr/bin/env node
//
// Set the project's release version across every source-of-truth file.
//
// Usage:
//   pnpm version:set 1.2.3            # bump to 1.2.3, refuse if v1.2.3 tagged
//   pnpm version:set --check-current  # exit non-zero if package.json's current
//                                      version is invalid or already tagged
//                                      (used by build.sh --release as a
//                                      single-source tag check)
//
// Writes:
//   - package.json                "version": "1.2.3"
//   - src-tauri/Cargo.toml        version = "1.2.3"
//   - src-tauri/Cargo.lock        (best-effort via `cargo update -p
//                                  rig-planner-app`; warns if cargo missing
//                                  so Docker-only hosts still complete)
//
// Does NOT touch:
//   - src-tauri/tauri.conf.json   reads version from "../package.json"
//   - src-tauri/gen/android/...   versionName + versionCode read from
//                                 package.json by build.gradle.kts
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
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// Validate a version string and return {major, minor, patch}. Returns null on
// failure with the reason in `reason`. Called from both the bump path and the
// --check-current path so the rules don't drift.
function parseSemver(s) {
  if (typeof s !== 'string' || s === '') {
    return { ok: false, reason: 'version is missing or not a string' };
  }
  const m = s.match(SEMVER_RE);
  if (!m) {
    return {
      ok: false,
      reason: `"${s}" is not valid semver (expected x.y.z; prereleases not supported — they collide on the derived Android versionCode)`,
    };
  }
  const [, ma, mi, pa] = m;
  const [major, minor, patch] = [ma, mi, pa].map(Number);
  if (major > 99 || minor > 99 || patch > 99) {
    return {
      ok: false,
      reason: `"${s}" components must each be ≤ 99 (Android versionCode formula caps there)`,
    };
  }
  return { ok: true, major, minor, patch };
}

// argv-array invocation, not shell — no interpolation of `tag` into a string
// that's later parsed by the shell.
function tagExists(tag) {
  try {
    const out = execFileSync('git', ['tag', '-l', tag], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    return out.trim() === tag;
  } catch {
    return false;
  }
}

const arg = process.argv[2];
if (!arg) die('usage: pnpm version:set <x.y.z> | --check-current');

// --check-current: read the version from package.json, validate it, exit
// non-zero if `v<version>` is already tagged. Used by build.sh --release so
// the "refuse to rebuild a shipped version" rule lives in one place.
if (arg === '--check-current') {
  const pkgPath = resolve(REPO_ROOT, 'package.json');
  let current;
  try {
    current = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  } catch (err) {
    die(`failed to read/parse package.json: ${err.message}`);
  }
  const parsed = parseSemver(current);
  if (!parsed.ok) {
    die(`package.json version is invalid: ${parsed.reason}`);
  }
  const currentTag = `v${current}`;
  if (tagExists(currentTag)) {
    die(
      `refusing to proceed — ${currentTag} is already tagged in git.\n` +
        `  that version has shipped; bump first with: pnpm version:set <next-x.y.z>`,
    );
  }
  process.exit(0);
}

const version = arg;
const parsed = parseSemver(version);
if (!parsed.ok) die(parsed.reason);
const { major, minor, patch } = parsed;

const tag = `v${version}`;
if (tagExists(tag)) {
  die(
    `git tag ${tag} already exists — that release has shipped to Google Play.\n` +
      `  bump to the next version instead; re-uploading the same versionCode is rejected.`,
  );
}

// package.json: parse as JSON, mutate the version field, rewrite. Using a
// real parser instead of a regex eliminates the fragility around formatting
// (multi-line entries, prettier reflows, future nested "version" keys).
const pkgPath = resolve(REPO_ROOT, 'package.json');
const pkgRaw = readFileSync(pkgPath, 'utf8');
const pkgJson = JSON.parse(pkgRaw);
pkgJson.version = version;
writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2) + '\n');

// Cargo.toml: scope the version replacement to the [package] section so a
// future [workspace.package] or other section's `version =` line can't be
// mistaken for the package version.
const cargoPath = resolve(REPO_ROOT, 'src-tauri/Cargo.toml');
const cargoRaw = readFileSync(cargoPath, 'utf8');
const cargoSections = cargoRaw.split(/^(?=\[)/m);
const packageSectionIdx = cargoSections.findIndex((s) =>
  s.startsWith('[package]'),
);
if (packageSectionIdx === -1)
  die('failed to find [package] section in Cargo.toml');
const oldSection = cargoSections[packageSectionIdx];
const newSection = oldSection.replace(
  /^(version\s*=\s*")[^"]*(")/m,
  (_m, prefix, suffix) => `${prefix}${version}${suffix}`,
);
if (newSection === oldSection)
  die('failed to update Cargo.toml — version line not found in [package]');
cargoSections[packageSectionIdx] = newSection;
writeFileSync(cargoPath, cargoSections.join(''));

// Cargo.lock: sync the lockfile so the freshly tagged commit isn't left with
// a stale entry. Best-effort: if cargo is unavailable (Docker-only host) or
// the run fails, warn instead of dying — the manifests are already bumped,
// and the next containerized `cargo build` will sync Cargo.lock automatically.
// Capture stderr so the warning surfaces the real cause instead of a generic
// "is cargo on PATH?" guess.
let cargoLockSynced = false;
try {
  execFileSync('cargo', ['update', '-p', 'rig-planner-app', '--offline'], {
    cwd: resolve(REPO_ROOT, 'src-tauri'),
    stdio: 'pipe',
  });
  cargoLockSynced = true;
} catch (err) {
  const stderr = (err.stderr || '').toString().trim();
  const cause =
    err.code === 'ENOENT'
      ? 'cargo not on PATH (Docker-only hosts can ignore this)'
      : stderr || err.message;
  console.warn(
    `warning: Cargo.lock not synced: ${cause}\n` +
      `  the next containerized build will sync it; or run manually:\n` +
      `    cd src-tauri && cargo update -p rig-planner-app --offline`,
  );
}

console.log(`version: ${version}`);
// versionCode is authoritative in src-tauri/gen/android/app/build.gradle.kts.
// We mirror the formula here for advisory printing — if you change the formula,
// keep both sides in sync.
const advisoryAndroidVersionCode = major * 10000 + minor * 100 + patch;
console.log(
  `android versionCode (advisory; Gradle computes): ${advisoryAndroidVersionCode}`,
);
console.log();
console.log('wrote:');
console.log('  package.json');
console.log('  src-tauri/Cargo.toml');
if (cargoLockSynced) console.log('  src-tauri/Cargo.lock');
console.log();
console.log('next:');
const staged = cargoLockSynced
  ? 'package.json src-tauri/Cargo.toml src-tauri/Cargo.lock'
  : 'package.json src-tauri/Cargo.toml  # remember to also stage Cargo.lock after the next cargo build';
console.log(`  git add ${staged}`);
console.log(`  git commit -m "chore: release ${tag}"`);
console.log(`  git tag -a ${tag} -m "Release ${tag}"`);
console.log(`  git push && git push --tags`);
console.log(`  pnpm android:container:build:release`);
console.log(`  gh release create ${tag} --generate-notes`);
