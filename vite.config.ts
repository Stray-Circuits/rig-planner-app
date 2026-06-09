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
    // @dnd-kit packages bring React in via peerDeps; without dedupe Vite's
    // pre-bundle can resolve their React import to a separate copy, which
    // breaks hooks ("resolveDispatcher is null") the first time a sensor
    // is created in ConnectionsStep.
    dedupe: ['react', 'react-dom'],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
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
  // Our bg-removal worker imports `@imgly/background-removal`, which uses
  // dynamic imports internally — that means the worker bundle must be
  // code-splittable, and the default `iife` worker format can't do that.
  // `es` produces a code-splittable ES module worker; the WebViews we target
  // (Tauri/WebKit, Android WebView, modern Chromium) all support it.
  worker: {
    format: 'es',
  },
  build: {
    // safari15+ for module-worker support (`worker.format: 'es'` above
    // produces `new Worker(url, { type: 'module' })` — added in Safari 15).
    // Tauri 2 mobile iOS already requires iOS 15+ in practice, so this
    // doesn't narrow our deployment window.
    target:
      process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari15',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
