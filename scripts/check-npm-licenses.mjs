#!/usr/bin/env node
// Enforces a license allowlist on production npm dependencies.
//
// Runs `pnpm licenses list --prod --json`, then for every package:
//   - if the license is in ALLOWED_LICENSES (or any clause of an
//     `(X OR Y)` SPDX expression is), pass;
//   - if the package name is in PACKAGE_EXCEPTIONS, pass;
//   - otherwise fail.
//
// Add to ALLOWED_LICENSES only after confirming AGPL-3.0-or-later
// compatibility. Add to PACKAGE_EXCEPTIONS only after reading the
// package's LICENSE file directly — used for packages whose license
// string is "Unknown" because of how they declare it (e.g. "SEE
// LICENSE IN LICENSE.md").

import { execSync } from 'node:child_process';
import process from 'node:process';

const ALLOWED_LICENSES = new Set([
  // Our own license, plus tolerated SPDX variants.
  'AGPL-3.0',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  // Permissive — universally AGPL-compatible.
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'ISC',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'Zlib',
  'WTFPL',
  'Python-2.0',
  // Weak copyleft, explicitly AGPL-compatible.
  'MPL-2.0',
  'Artistic-2.0',
  // NOTE: do NOT add `OpenSSL` (legacy dual license, AGPL-incompatible).
  // Do NOT add `LGPL-2.1-only` or `LGPL-2.1` (only LGPL-3.0+ is
  // bidirectionally compatible with AGPL-3.0).
]);

// Per-package exceptions: package name -> reason. These bypass the
// license-string match. Only use when the actual LICENSE file has been
// inspected and confirmed AGPL-3.0-or-later-compatible.
const PACKAGE_EXCEPTIONS = new Map([
  [
    '@imgly/background-removal',
    'AGPL-3.0 declared via LICENSE.md (package.json field reads "SEE LICENSE IN LICENSE.md")',
  ],
]);

function parseLicenseString(s) {
  // Handle SPDX expressions like "(MIT OR Apache-2.0)" or "MIT OR CC0-1.0".
  return s
    .replace(/^\(|\)$/g, '')
    .split(/\s+OR\s+/i)
    .map((p) => p.trim());
}

function isAllowed(licenseStr) {
  if (!licenseStr || licenseStr === 'Unknown') return false;
  return parseLicenseString(licenseStr).some((p) => ALLOWED_LICENSES.has(p));
}

const raw = execSync('pnpm licenses list --prod --json', { encoding: 'utf8' });
const data = JSON.parse(raw);

if (data.error) {
  console.error(`pnpm licenses list failed: ${data.error.message}`);
  process.exit(2);
}

const violations = [];
for (const [licenseKey, entries] of Object.entries(data)) {
  for (const entry of entries) {
    const license = entry.license || licenseKey;
    if (PACKAGE_EXCEPTIONS.has(entry.name)) continue;
    if (isAllowed(license)) continue;
    violations.push({ name: entry.name, versions: entry.versions, license });
  }
}

if (violations.length === 0) {
  console.log(
    'npm license check: all production dependencies use allowed licenses.',
  );
  process.exit(0);
}

console.error(
  `npm license check failed — ${violations.length} package(s) with disallowed/unknown license:\n`,
);
for (const v of violations) {
  console.error(
    `  - ${v.name}@${v.versions.join(',')} — license: ${v.license}`,
  );
}
console.error(`\nResolve by:`);
console.error(
  `  - Confirming the license is AGPL-3.0-or-later-compatible and adding it`,
);
console.error(`    to ALLOWED_LICENSES in scripts/check-npm-licenses.mjs, OR`);
console.error(
  `  - Adding the package to PACKAGE_EXCEPTIONS with a reason (only when the`,
);
console.error(
  `    license reports as "Unknown" because of how the package declares it).`,
);
process.exit(1);
