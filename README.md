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
  **or** Docker (see [Android via Docker](#android-via-docker) below — no host SDK needed)

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Vite dev server (browser only, no Tauri shell) |
| `pnpm tauri:dev` | Full desktop Tauri dev loop |
| `pnpm tauri:ios:init` | One-time iOS project init |
| `pnpm tauri:ios:dev` | iOS simulator dev loop |
| `pnpm tauri:android:init` | One-time Android project init (host toolchain) |
| `pnpm tauri:android:dev` | Android emulator dev loop |
| `pnpm android:container:image` | Build the Docker image with all Android toolchains |
| `pnpm android:container:init` | One-time Android project init **inside the container** |
| `pnpm android:container:build` | Build a debug APK inside the container |
| `pnpm android:container:shell` | Drop into a shell inside the container |
| `pnpm android:container:clean` | Drop the cached pnpm / cargo / gradle volumes |
| `pnpm build` | Vite production build |
| `pnpm tauri:build` | Build native installers |
| `pnpm test` | Vitest watch mode |
| `pnpm test:run` | Vitest one-shot |
| `pnpm typecheck` | TypeScript strict check |

## Build-time environment

Optional env vars baked into the bundle at build time. Set them in your local
`.env.local` (gitignored) or CI secrets before `pnpm build` / `pnpm tauri:build`.

| Var | What it does |
| --- | --- |
| `VITE_BRAVE_SEARCH_API_KEY` | Enables the "Search the web" affordance on the Add Pedal wizard. When unset, the button is hidden and search is silently disabled. Get a free key at search.brave.com/app/api (2,000 queries/month). Self-builders need their own key; never enable billing on the key, since it ships inside the binary. See `proposals/pedal-photo-search.md` for the full design + key-handling rationale. |

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

## Android via Docker

The Android build runs in a containerized toolchain so the host only needs
Docker. The image layers Node, pnpm, the Android NDK, and Rust + Android
targets on top of [Cirrus Labs' `android-sdk:34`](https://github.com/cirruslabs/docker-images-android)
base (multi-arch arm64 + amd64, JDK + SDK preinstalled). See
[`scripts/android/Dockerfile`](scripts/android/Dockerfile) for pinned
versions.

In Docker Desktop → Settings → Resources, give the VM at least **8 GiB RAM,
4 CPUs, and 60 GiB disk image size** before running the first build — the
toolchain install and Gradle/AGP both need the headroom.

```bash
# One-time: build the image (~5–10 min, ~5 GiB).
pnpm android:container:image

# One-time per repo clone: generate src-tauri/gen/android/.
pnpm android:container:init

# Build a debug APK. Subsequent builds reuse pnpm / cargo / gradle caches
# via named Docker volumes, so they're significantly faster.
pnpm android:container:build
```

Debug APKs land in
`src-tauri/gen/android/app/build/outputs/apk/universal/debug/`. Sideload to a
device or emulator with `adb install`. Signed release builds and on-device
emulator/dev loops are deferred — the wrapper script only covers debug APKs
today.

Docker picks the host architecture by default. Override with
`RIG_PLANNER_ANDROID_PLATFORM=linux/amd64` if you need to cross-build.
