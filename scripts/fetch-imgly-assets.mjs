#!/usr/bin/env node
// Fetch the @imgly/background-removal model + ORT WASM into public/imgly/
// so they ship as same-origin assets. Required for cross-origin isolation
// (COOP/COEP) — staticimgly.com doesn't send Cross-Origin-Resource-Policy
// headers, so model fetches would be blocked once we set COEP: require-corp.
//
// Idempotent: skips chunks already on disk whose sha256 matches the
// resources.json catalog. Run automatically via `predev` / `prebuild`.

import { mkdir, writeFile, access, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.7.0';
const PUBLIC_BASE = `https://staticimgly.com/@imgly/background-removal-data/${VERSION}/dist/`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_DIR = path.join(ROOT, 'public', 'imgly');

// We only ship the CPU+quint8 inference path. jsep (WebGPU) is faster on
// some hardware but slower on Pixel 8 Pro (issue #23 trace); isnet_fp16
// and isnet (full) are higher-quality alternatives we currently don't use.
const NEEDED_RESOURCES = [
  '/onnxruntime-web/ort-wasm-simd-threaded.wasm',
  '/onnxruntime-web/ort-wasm-simd-threaded.mjs',
  '/models/isnet_quint8',
];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function ensureChunk(chunk) {
  const dest = path.join(TARGET_DIR, chunk.name);
  if (await exists(dest)) {
    const bytes = await readFile(dest);
    if (sha256(bytes) === chunk.hash) return false;
    process.stdout.write(
      `  ${chunk.name.slice(0, 12)}… hash mismatch, redownloading\n`,
    );
  }
  const bytes = await fetchBytes(PUBLIC_BASE + chunk.name);
  const got = sha256(bytes);
  if (got !== chunk.hash) {
    throw new Error(
      `Hash mismatch for ${chunk.name}: expected ${chunk.hash}, got ${got}`,
    );
  }
  await writeFile(dest, bytes);
  return true;
}

async function main() {
  await mkdir(TARGET_DIR, { recursive: true });

  // Version sentinel: clear the cache when VERSION bumps, otherwise the
  // stale resources.json catalog would point at chunk hashes that the
  // newly-fetched chunk bytes can't satisfy → "Hash mismatch" loop until
  // the developer manually deletes the directory.
  const sentinelPath = path.join(TARGET_DIR, '.version');
  if (await exists(sentinelPath)) {
    const cachedVersion = (await readFile(sentinelPath, 'utf8')).trim();
    if (cachedVersion !== VERSION) {
      console.log(
        `imgly: version bump ${cachedVersion} → ${VERSION}, clearing cache`,
      );
      await rm(TARGET_DIR, { recursive: true, force: true });
      await mkdir(TARGET_DIR, { recursive: true });
    }
  }
  await writeFile(sentinelPath, VERSION);

  const resourcesPath = path.join(TARGET_DIR, 'resources.json');
  let resources;
  if (await exists(resourcesPath)) {
    resources = JSON.parse(await readFile(resourcesPath, 'utf8'));
  } else {
    console.log('imgly: fetching resources.json catalog');
    const bytes = await fetchBytes(PUBLIC_BASE + 'resources.json');
    await writeFile(resourcesPath, bytes);
    resources = JSON.parse(new TextDecoder().decode(bytes));
  }

  let totalBytes = 0;
  const chunks = [];
  for (const key of NEEDED_RESOURCES) {
    const entry = resources[key];
    if (!entry) throw new Error(`resources.json missing entry for ${key}`);
    for (const chunk of entry.chunks) {
      chunks.push(chunk);
      totalBytes += chunk.offsets[1] - chunk.offsets[0];
    }
  }

  const startMs = Date.now();
  let fetched = 0;
  for (const chunk of chunks) {
    if (await ensureChunk(chunk)) fetched++;
  }
  if (fetched === 0) {
    console.log(
      `imgly: ${chunks.length} chunks already cached (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`,
    );
  } else {
    console.log(
      `imgly: fetched ${fetched}/${chunks.length} chunks (${(totalBytes / 1024 / 1024).toFixed(1)} MB) in ${((Date.now() - startMs) / 1000).toFixed(1)}s`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
