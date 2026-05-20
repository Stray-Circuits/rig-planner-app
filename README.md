# Rig Planner

Pedalboard planner with signal-path overlay. Desktop + mobile (iOS / Android) via Tauri 2.

![CI](https://github.com/straycircuits/rig-planner-app/actions/workflows/ci.yml/badge.svg)

## Stack

- Vite + React 19 + TypeScript (strict)
- Zustand for state
- Tauri 2 shell, SQLite via `tauri-plugin-sql`
- Vitest + Testing Library

## Prerequisites

- Node 20+ (tested on 26)
- pnpm 9+
- Rust toolchain (`rustup`)
- For iOS builds: Xcode + iOS targets via `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`
- For Android builds: either Android Studio + NDK with `ANDROID_HOME` / `NDK_HOME` set,
  **or** Podman (see [Android via Podman](#android-via-podman) below — no host SDK needed)

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Vite dev server (browser only, no Tauri shell) |
| `pnpm tauri:dev` | Full desktop Tauri dev loop |
| `pnpm tauri:ios:init` | One-time iOS project init |
| `pnpm tauri:ios:dev` | iOS simulator dev loop |
| `pnpm tauri:android:init` | One-time Android project init (host toolchain) |
| `pnpm tauri:android:dev` | Android emulator dev loop |
| `pnpm android:container:image` | Build the Podman image with all Android toolchains |
| `pnpm android:container:init` | One-time Android project init **inside the container** |
| `pnpm android:container:build` | Build a debug APK inside the container |
| `pnpm android:container:shell` | Drop into a shell inside the container |
| `pnpm android:container:clean` | Drop the cached pnpm / cargo / gradle volumes |
| `pnpm build` | Vite production build |
| `pnpm tauri:build` | Build native installers |
| `pnpm test` | Vitest watch mode |
| `pnpm test:run` | Vitest one-shot |
| `pnpm typecheck` | TypeScript strict check |

## Layout

```
src/
├── app/          # Root layout + router (when added)
├── screens/      # Top-level routes
├── canvas/       # Board renderer, drag, gestures, cable routing
├── data/         # DB adapter, migrations, schema types, repositories
├── stores/       # Zustand slices
├── lib/          # Geometry, bg removal, signal-type colors, units
├── ui/           # Shared primitives
└── styles/       # Global CSS + theme tokens
src-tauri/        # Rust shell
mockups/          # Original HTML mockups (reference)
```

## Phase progress

- [x] Phase 1 — Scaffold: Tauri 2 + React + DB schema + tests + boot shell
- [x] Phase 2 — Rigs: list, new-rig wizard, persistence
- [x] Phase 3 — Canvas: board styles, drag, gestures, rotate
- [x] Phase 4 — Add-pedal wizard
- [x] Phase 5 — Background removal (@imgly/background-removal — WebGPU + WASM fallback)
- [x] Phase 6 — Signal-chain overlay
- [ ] Phase 7 — Mobile polish + native builds *(Android containerized debug build wired up; release signing + iOS still pending)*

## Android via Podman

The Android build runs in a containerized toolchain so the host only needs
Podman. JDK 17, Node, pnpm, Rust + Android targets, the Android SDK, and the
NDK all live in the image at pinned versions (see
[`scripts/android/Containerfile`](scripts/android/Containerfile)).

```bash
# One-time: build the image (~10–20 min, ~6 GiB).
pnpm android:container:image

# One-time per repo clone: generate src-tauri/gen/android/.
pnpm android:container:init

# Build a debug APK. Subsequent builds reuse pnpm / cargo / gradle caches
# via named Podman volumes, so they're significantly faster.
pnpm android:container:build
```

Debug APKs land in
`src-tauri/gen/android/app/build/outputs/apk/universal/debug/`. Sideload to a
device or emulator with `adb install`. Signed release builds and on-device
emulator/dev loops are deferred — the wrapper script only covers debug APKs
today.

The container build defaults to `linux/arm64`. Override with
`RIG_PLANNER_ANDROID_PLATFORM=linux/amd64` if your host needs it.
