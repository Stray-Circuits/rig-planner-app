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

iOS / Android entry points (`pnpm tauri:ios:dev`, `pnpm tauri:android:dev`) require Xcode / Android Studio installed first; see README for prereqs.

## Architecture

**Two runtime modes, one codebase.** The app must work end-to-end in both `pnpm dev` (browser, no Tauri) and `pnpm tauri:dev` (full SQLite). `src/data/db.ts` picks the adapter at startup: `tauri-plugin-sql` when `window.__TAURI_INTERNALS__` exists, otherwise `src/data/memoryAdapter.ts` — a hand-rolled SQL interpreter that parses the exact statement shapes the repos emit (`INSERT/UPDATE/DELETE/SELECT *|cols [WHERE col=?] [ORDER BY]`) and persists to `localStorage`. New repository code must stick to those supported shapes or extend the parser.

**Data layer is repository-per-table.** `src/data/{rigs,pedals,placedPedals,connections,externalEndpoints}Repo.ts` own all SQL. Stores in `src/stores/` are Zustand slices that wrap repos with optimistic in-memory state + persistence; no component talks to repos directly.

**Canvas geometry is in inches, not pixels.** Board dimensions, pedal sizes, and port positions are all `widthIn` / `xIn` / etc. The `pxPerInch` scalar (computed by `RigScreen.CanvasArea.fit()`) is the conversion factor; the canvas element applies it. `src/lib/geometry.ts` is the single source of truth for `clampToBoard`, `placedFootprint`, `rotatedSide`, `portPositionOnBoard`, and `routeCablePath`. Test changes to placement / rotation against `tests/geometry.test.ts` + `tests/portGeometry.test.ts`.

**Rig screen is workspace-first.** No persistent header / sidebar / bottom strip on the rig screen at any viewport. Top-level actions are FABs (Back top-left, Settings top-right, Signal Chain + Add Pedal bottom-right). Sheets summon on demand. Settings (rename, board change, delete) live in `SettingsSheet`. See `feedback_minimal_chrome.md` in agent memory.

**Sheet has a `floatingActions` slot** (`src/ui/Sheet.tsx`) that renders inside the modal panel but outside the scrollable body — used for FAB-style content that needs to stay anchored to the panel corner regardless of scroll position.

**Background-removal is lazy.** `@imgly/background-removal` (AGPLv3) ships a ~176MB ISNet model and ~110KB JS chunk. `src/lib/bgRemoval.ts` dynamic-imports it from the wizard's Image step (`prefetchBgRemoval()` warms the chunk on mount). Pixel-buffer math (alpha bbox crop, chroma-key threshold) lives in `src/lib/imageHelpers.ts` as pure functions over `Uint8ClampedArray` so it's testable under jsdom. The tests mock `@imgly/background-removal` in `tests/setup.ts`.

**Signal-chain semantics live in `src/lib/signalChainWarnings.ts`.** That's where the "which required ports are unconnected" computation runs. UI (port dots, endpoint chips, cable colors) just renders the result.

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
