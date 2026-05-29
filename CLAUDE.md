# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Use case | Command |
|---|---|
| Browser dev loop (no Tauri shell) | `pnpm dev` |
| Tauri desktop dev loop | `pnpm tauri:dev` |
| Run all gates before commit | `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test:run` |
| Watch tests | `pnpm test` |
| One test file | `pnpm test:run tests/RigScreen.test.tsx` |
| Single test by name | `pnpm test:run -t "settings sheet renames"` |
| Auto-fix formatting | `pnpm exec prettier --write <file>` |
| Production web build | `pnpm build` |
| Native installer (Tauri) | `pnpm tauri:build` |
| Android debug APK (containerized, no host SDK) | `pnpm android:container:build` |
| Android container shell (debug toolchain) | `pnpm android:container:shell` |
| Rebuild Android container image | `pnpm android:container:image` |

iOS / Android entry points (`pnpm tauri:ios:dev`, `pnpm tauri:android:dev`) require Xcode / Android Studio installed first; see README for prereqs. For Android, the containerized path (`scripts/android/`) is the supported route and only needs Docker.

## Architecture

**Two runtime modes, one codebase.** The app must work end-to-end in both `pnpm dev` (browser, no Tauri) and `pnpm tauri:dev` (full SQLite). `src/data/db.ts` picks the adapter at startup: `tauri-plugin-sql` when `window.__TAURI_INTERNALS__` exists, otherwise `src/data/memoryAdapter.ts` — a hand-rolled SQL interpreter that parses the exact statement shapes the repos emit (`INSERT/UPDATE/DELETE/SELECT *|cols [WHERE col=?] [ORDER BY]`) and persists to `localStorage`. New repository code must stick to those supported shapes or extend the parser.

**Data layer is repository-per-table.** `src/data/{rigs,pedals,placedPedals,connections,externalEndpoints}Repo.ts` own all SQL. Stores in `src/stores/` are Zustand slices that wrap repos with optimistic in-memory state + persistence; no component talks to repos directly.

**Canvas geometry is in inches, not pixels.** Board dimensions, pedal sizes, and port positions are all `widthIn` / `xIn` / etc. The `pxPerInch` scalar (computed by `RigScreen.CanvasArea.fit()`) is the conversion factor; the canvas element applies it. `src/lib/geometry.ts` is the single source of truth for `clampToBoard`, `placedFootprint`, `rotatedSide`, `portPositionOnBoard`, and `routeCablePath`. Test changes to placement / rotation against `tests/geometry.test.ts` + `tests/portGeometry.test.ts`.

**Board renders are bundled PNGs at 300 DPI.** The master Affinity doc lives at `resources/PedalTrain/pedaltrain_renders.af` (untracked — kept locally as source-of-truth for regeneration). Each Pedaltrain board is a group, exported as a transparent PNG slice via Window → Slices in the unified Affinity 3 app. Slice pixel dims map to the preset's real-world inches at 300 DPI (so `widthIn = pixelWidth / 300`). Bundled PNGs live in `src/assets/boards/` named with kebab-case preset IDs (`classic-pro.png`, `xd-18.png`, `nano-plus.png`); `BoardPreset.image` references them as Vite asset URLs. The image renderer (`src/canvas/BoardCanvas.tsx`, `src/canvas/BoardThumb.tsx`) loads through `boardImageCache.ts` and paints a transparent canvas backdrop — `backgroundForStyle('rail')` returns `#888` because that's the procedural rail drawer's frame color and would bleed through every transparent pixel of a photo. `resolveBoardImageSrc` (in `boardPresets.ts`) picks the preset image, or for custom-rail rigs returns the closest Pedaltrain preset by Euclidean `(widthIn, depthIn)` distance, stretched to fit.

**Temple Audio dimensions are usable-pedal-area, not marketed.** A Temple "Duo 24" actually fits pedals across 22.7" — the model number is rounded up from the case dimension, not the surface. All `temple-*` presets in `boardPresets.ts` use the usable width (Solo 18 → 16.7", Duo 17/24/34 → 15.7/22.7/32.7", Trio 21/28/43 → 19.7/26.7/41.7"). Each series shares a fixed depth (Solo 8.5", Duo 12.5", Trio 16.5"). The procedural `drawHoles` drawer uses the real Temple mounting spec (6mm diameter on a 12mm grid) when `DrawArgs.widthIn` is set, so the main canvas renders the correct hole density; thumbnails skip the physical math and use a legibility heuristic.

**Rig screen is workspace-first.** No persistent header / sidebar / bottom strip on the rig screen at any viewport. Top-level actions are FABs (Back top-left, Settings top-right, Signal Chain + Add Pedal bottom-right). Sheets summon on demand. Settings (rename, board change, delete) live in `SettingsSheet`. See `feedback_minimal_chrome.md` in agent memory.

**Sheet has a `floatingActions` slot** (`src/ui/Sheet.tsx`) that renders inside the modal panel but outside the scrollable body — used for FAB-style content that needs to stay anchored to the panel corner regardless of scroll position.

**Background-removal is lazy.** `@imgly/background-removal` (AGPLv3) ships a ~176MB ISNet model and ~110KB JS chunk. `src/lib/bgRemoval.ts` dynamic-imports it from the wizard's Image step (`prefetchBgRemoval()` warms the chunk on mount). Pixel-buffer math (alpha bbox crop, chroma-key threshold) lives in `src/lib/imageHelpers.ts` as pure functions over `Uint8ClampedArray` so it's testable under jsdom. The tests mock `@imgly/background-removal` in `tests/setup.ts`.

**Signal-chain semantics live in `src/lib/signalChainWarnings.ts`.** That's where the "which required ports are unconnected" computation runs. UI (port dots, endpoint chips, cable colors) just renders the result.

**Chain-mode input is one canonical flow** — pedal tap → port-picker sheet → port row. Direct port-dot taps, drag-to-connect rubber-band, and cable-click-to-delete were intentionally removed in PR #28; port dots and cable lines are non-interactive visuals. Disconnect happens by re-tapping a saturated port in the sheet. Cable caps per connector live in `maxCablesForConnector` (`src/lib/signalChainWarnings.ts`) — TRS jacks carry two signals (tip + ring) so up to two connection records can terminate at one TRS port; all other connectors hold one. Whether the user runs a TRS-to-TRS cable or a TRS Y-splitter is downstream of the data model.

**Cross-origin fetch goes through `@tauri-apps/plugin-http`.** The pedal photo search (`src/lib/braveSearch.ts`) hits Brave's API + arbitrary image hosts that don't send CORS headers. Under Tauri, requests route through the Rust HTTP plugin (bypassing CORS); in `pnpm dev` we fall back to platform `fetch` which will fail with a network error for most URLs — the UI surfaces that cleanly. The capability in `src-tauri/capabilities/default.json` allows `https://*/*` + `http://*/*` (intentional — search results link anywhere). Future features that need to fetch arbitrary external content can reuse this transport via the `platformFetch()` switch in `braveSearch.ts`.

**Saving files needs a Tauri branch.** WKWebView on macOS silently drops `<a download>` Blob clicks, so the browser-dev download trick doesn't work under `pnpm tauri:dev`. `src/lib/fileDownload.ts::saveTextFile()` detects `__TAURI_INTERNALS__` and routes through `@tauri-apps/plugin-dialog` (`save`) + `@tauri-apps/plugin-fs` (`writeTextFile`); browser mode keeps the Blob fallback. File *open* (`<input type="file">`) works in both. Per-rig backup/share lives in `src/lib/rigPortability.ts` + `src/data/rigImportRepo.ts`, exposed from the Settings sheet.

**Adding a Tauri plugin = four wiring sites:** `package.json` (`@tauri-apps/plugin-X`), `src-tauri/Cargo.toml` (`tauri-plugin-X = "2"`), `src-tauri/src/lib.rs` (`.plugin(tauri_plugin_X::init())`), and `src-tauri/capabilities/default.json` (permissions + scopes). Miss any one and you get a cryptic "plugin not registered" or permission-denied error.

**Build-time env vars are baked via `import.meta.env`** with the `VITE_` prefix (see `vite.config.ts` envPrefix). `.env.local` is gitignored; set keys there for local dev or in CI secrets for release builds. The currently-used var is `VITE_BRAVE_SEARCH_API_KEY` — when absent the photo-search button is hidden via `isBraveSearchConfigured()`.

**Android builds run inside a Docker container** under `scripts/android/`. The Dockerfile layers Node/pnpm/Rust/NDK on the Cirrus Labs `android-sdk:34` base. Hard constraints learned the hard way:

- The container is forced to `linux/amd64` even on Apple silicon (Docker Desktop uses Rosetta-for-Linux). Google publishes no `linux-aarch64` Android NDK, so an arm64 container can't run the cross-compile toolchain. Override only via `RIG_PLANNER_ANDROID_PLATFORM` if you really know why.
- The container mounts `scripts/android/container-pnpm-workspace.yaml` over `/workspace/pnpm-workspace.yaml` so the container sees `packages: []` and no host-specific `storeDir`. Don't try to "simplify" by removing this override — both halves matter (pnpm 9.15+ rejects yamls without `packages:`, and the host's macOS-specific storeDir would defeat the container cache volume).
- `COREPACK_ENABLE_AUTO_PIN=0` is set in the container env. Without it, corepack silently adds a `packageManager` field to the bind-mounted `package.json` and pins host pnpm to whatever version the container ships, which can break host workflows.
- The repo's `pnpm-workspace.yaml` has `packages: []` *intentionally* — it's not a real workspace, the file exists to carry `allowBuilds`/`storeDir`/`verifyDepsBeforeRun`. pnpm 9.15+ requires `packages:` to parse the file. Don't remove the line.

**Tauri Android requires `version >= 0.0.1`** in `src-tauri/tauri.conf.json`. The default `0.0.0` is rejected at build time.

## Strict TS — what bites

The codebase compiles with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and `verbatimModuleSyntax` all on. In practice:

- `array[i]` is `T | undefined` — non-null assert (`!`) or check before use.
- `import type` is required for type-only imports; mixing values + types in a single statement is a lint error.
- Passing `prop: string | undefined` to a `prop?: string` slot is rejected. Either widen the prop signature with `| undefined` or omit it with the `{...(x !== undefined ? { prop: x } : {})}` spread pattern.

## Backlog / planning files

- **`FOLLOWUPS.md`** — tracked, curated polish list grouped by area. Update when phases / fixes complete.
- **`other_todos.txt`** — Zach's working notes, gitignored. Read when he points at it; treat lines as authoritative scope when he says "fix the items I listed."
- **`mockups/`** — original HTML/CSS mockups the app implements. Reference for visual intent, not import.

## Commit discipline

Commit at phase + feature boundaries with all four gates green (typecheck, lint, format, tests). Avoid `git add -A` / `git add .` — the working tree often has untracked private notes or browser-dev artifacts (`rig-planner-memory-db.json` for example) that mustn't ship. Stage explicit paths.

**`main` is branch-protected** — direct pushes are rejected at the GitHub level. Every change (including one-line docs/CLAUDE.md edits) goes on a feature branch and merges via PR. Don't try to `--force` or admin-bypass; the protection is intentional.

## Security

Three layers, all defined under `.github/`:

- **`.github/workflows/security.yml`** — runs on push/PR + weekly cron. Three jobs:
  - `pnpm audit --prod --audit-level=high` plus `pnpm licenses:check` (script at `scripts/check-npm-licenses.mjs`). The audit fails on high/critical CVEs in production JS deps; the license gate fails on any production dep whose license isn't in the AGPL-compatible allowlist or recorded as a per-package exception. Dev-only advisories surface via Dependabot to keep the audit signal actionable.
  - `cargo-deny check advisories bans licenses sources` — RustSec CVEs, AGPL-compatible license allowlist, banned/duplicate crates, registry source pinning. Config lives in `src-tauri/deny.toml`.
  - `dependency-review-action` — PR-only gate that blocks introducing a new vulnerable dep.
  - **Secret scanning is GitHub-native** (push protection + secret scanning alerts, toggled in repo settings). No CI job — `gitleaks-action` is paywalled for org use and the native ruleset is broader. If you ever need a custom rule (e.g. an internal token format GitHub doesn't ship), the fallback is to run the gitleaks CLI binary directly (still MIT) rather than the action.
- **`.github/workflows/codeql.yml`** — CodeQL SAST for `javascript-typescript` and `rust` with the `security-and-quality` query suite. Rust analysis needs the same `libwebkit2gtk-4.1-dev` system deps as the main Rust CI job.
- **`.github/dependabot.yml`** — weekly PRs for `npm`, `cargo` (in `src-tauri/`), and `github-actions`. Dev-tooling minor/patch bumps are grouped into one PR. Heads-up: pnpm 11.4+ enforces a default `minimumReleaseAge` (~24h) supply-chain check on lockfile entries, so dependabot PRs commonly fail the first CI install with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`. The fix is to re-run failed jobs once the window has elapsed — **don't** regenerate the lockfile (the error message's own suggestion); that defeats the policy and diverges from dependabot's resolution.

**First-party Rust forbids `unsafe`.** Both `src-tauri/src/lib.rs` and `src-tauri/src/main.rs` carry `#![forbid(unsafe_code)]`. If you genuinely need `unsafe` (FFI, etc.), justify it in the PR and scope it with `#[allow(unsafe_code)]` on the smallest possible item — don't lift the crate-level forbid.

**Project license is `AGPL-3.0-or-later`**, declared in both `package.json` and `src-tauri/Cargo.toml`. The constraint comes from `@imgly/background-removal` (AGPLv3); if that dep is ever swapped for an MIT/Apache equivalent, the project can relicense to something more permissive. Until then, every new dep must be AGPL-compatible — the npm + cargo license gates enforce this. Common pitfalls: SPDX `OpenSSL` (legacy dual license — incompatible, deliberately absent from both allowlists), `LGPL-2.1-only` (only LGPL-3.0+ is bidirectionally compatible with AGPL-3.0). Dual-licensed crates like `MIT OR Apache-2.0 OR LGPL-2.1-or-later` are fine — cargo-deny / our npm script pick an allowed alternative.

**Suppressing findings.**
- cargo-deny advisories: add an entry to `[advisories.ignore]` in `src-tauri/deny.toml` with a `reason =` string that links to your analysis. Don't ignore without reading the advisory.
- npm license check: if a package reports as "Unknown" because it uses `"SEE LICENSE IN LICENSE.md"` or similar, read the LICENSE file directly and add an entry to `PACKAGE_EXCEPTIONS` in `scripts/check-npm-licenses.mjs` with a reason. To allow a previously-unseen but compatible SPDX identifier, add it to `ALLOWED_LICENSES` in the same file.
- CodeQL: prefer fixing. If a finding is a true false-positive, dismiss it via the GitHub Security tab with a note; don't sprinkle `// codeql[...]` suppressions in code.
- Native secret scanning: dismiss false positives via the Security tab → Secret scanning alerts → "Close as" with a reason. For fixture strings that look secret-like, prefer rewriting the fixture over carrying a perpetual dismissal.

**Repo-settings dependencies** (toggled in GitHub UI, not in this repo): secret scanning, push protection, Dependabot alerts, Dependabot security updates. These are required for the security model to hold; the workflows above complement them.
