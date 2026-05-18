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
- For Android builds: Android Studio + NDK; `ANDROID_HOME` and `NDK_HOME` set

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Vite dev server (browser only, no Tauri shell) |
| `pnpm tauri:dev` | Full desktop Tauri dev loop |
| `pnpm tauri:ios:init` | One-time iOS project init |
| `pnpm tauri:ios:dev` | iOS simulator dev loop |
| `pnpm tauri:android:init` | One-time Android project init |
| `pnpm tauri:android:dev` | Android emulator dev loop |
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
- [ ] Phase 3 — Canvas: board styles, drag, gestures, rotate
- [ ] Phase 4 — Add-pedal wizard
- [ ] Phase 5 — Background removal (rembg-webgpu)
- [ ] Phase 6 — Signal-chain overlay
- [ ] Phase 7 — Mobile polish + native builds
