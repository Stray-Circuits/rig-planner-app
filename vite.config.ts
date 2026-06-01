import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Tauri exposes env vars at compile time
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    // COOP/COEP enable SharedArrayBuffer, which ORT WASM needs for
    // multi-threaded inference. Tauri prod sets these via tauri.conf.json
    // app.security.headers; mirror them here so `pnpm dev` and the
    // browser-side Vite server (used by tauri android dev) get the same
    // isolation as production.
    //
    // We use `credentialless` (not `require-corp`) so cross-origin <img>
    // loads from the Brave image search still work — they're served from
    // image hosts that don't send CORP. Credentialless strips credentials
    // (no cookies sent) but allows the loads, and SAB is still enabled.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
