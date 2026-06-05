#!/usr/bin/env node
// Wipe local Tauri app state (SQLite DB, WebView storage) so the next
// `tauri:dev` / `tauri:build` boots as if it were a fresh install.
//
// Reads the bundle identifier from src-tauri/tauri.conf.json so this stays
// in sync if it ever changes.

import { readFile, rm, access } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import path from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const conf = JSON.parse(
  await readFile(path.join(repoRoot, 'src-tauri/tauri.conf.json'), 'utf8'),
);
const id = conf.identifier;
if (typeof id !== 'string' || id.length === 0) {
  console.error('Could not read identifier from src-tauri/tauri.conf.json');
  process.exit(1);
}

const home = homedir();
const targets = (() => {
  switch (platform()) {
    case 'darwin':
      return [
        path.join(home, 'Library/Application Support', id),
        path.join(home, 'Library/WebKit', id),
        path.join(home, 'Library/Caches', id),
      ];
    case 'linux':
      // XDG default layout. Respect XDG_* overrides if the user has set them.
      return [
        path.join(process.env.XDG_DATA_HOME ?? `${home}/.local/share`, id),
        path.join(process.env.XDG_CONFIG_HOME ?? `${home}/.config`, id),
        path.join(process.env.XDG_CACHE_HOME ?? `${home}/.cache`, id),
      ];
    case 'win32': {
      const appData = process.env.APPDATA ?? `${home}\\AppData\\Roaming`;
      const localAppData =
        process.env.LOCALAPPDATA ?? `${home}\\AppData\\Local`;
      return [path.join(appData, id), path.join(localAppData, id)];
    }
    default:
      return [];
  }
})();

if (targets.length === 0) {
  console.error(`Unsupported platform: ${platform()}`);
  process.exit(1);
}

const existing = [];
for (const t of targets) {
  try {
    await access(t);
    existing.push(t);
  } catch {
    /* doesn't exist — nothing to clean */
  }
}

if (existing.length === 0) {
  console.log('Nothing to clean — no Tauri app-data directories found.');
  process.exit(0);
}

console.log('About to delete:');
for (const t of existing) console.log('  ' + t);

const rl = createInterface({ input, output });
const answer = (await rl.question('Proceed? [y/N] ')).trim().toLowerCase();
rl.close();

if (answer !== 'y' && answer !== 'yes') {
  console.log('Aborted.');
  process.exit(0);
}

for (const t of existing) {
  await rm(t, { recursive: true, force: true });
  console.log('  removed ' + t);
}
console.log('Done. Next launch will boot as a fresh install.');
