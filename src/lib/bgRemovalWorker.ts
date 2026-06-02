// Dedicated worker that owns the @imgly/background-removal pipeline.
//
// Lives off the main thread so a ~14s ISNet inference run can't freeze
// the wizard UI. The library itself only proxies inference to a worker
// when device='gpu', and WebGPU on Android WebView is slower than CPU
// quint8 (issue #23 traces) — so we wrap our own.

import {
  removeBackground as imglyRemoveBackground,
  type Config,
} from '@imgly/background-removal';

export interface ProgressMessage {
  type: 'progress';
  key: string;
  current: number;
  total: number;
}
export interface ResultMessage {
  type: 'result';
  blob: Blob;
}
export interface ErrorMessage {
  type: 'error';
  message: string;
}
export type WorkerOutbound = ProgressMessage | ResultMessage | ErrorMessage;
export interface WorkerInbound {
  source: Blob;
}

declare const self: DedicatedWorkerGlobalScope;

// Cap ORT WASM thread count. The lib unconditionally sets
// `ort.env.wasm.numThreads = navigator.hardwareConcurrency` (index.mjs:1017),
// which is 9 on the Pixel 8 Pro. Empirically (issue #23 trace 5) that's
// SLOWER than single-threaded — kernel dispatch / atomics overhead on
// quint8 conv ops exceeds parallelism gain on this device. Shadowing
// `hardwareConcurrency` with an own property is the cleanest knob since
// the lib doesn't expose numThreads in its config.
const ORT_THREAD_CAP = 2;
Object.defineProperty(navigator, 'hardwareConcurrency', {
  value: ORT_THREAD_CAP,
  configurable: true,
});

// Bundled imgly assets live under `/imgly/` (see scripts/fetch-imgly-assets.mjs
// + public/imgly/). Serving them same-origin is required because we set
// Cross-Origin-Embedder-Policy: credentialless — even with credentialless,
// same-origin serving means we control all the response headers.
// Resolving against self.location.href produces an absolute URL that works
// in dev (http://localhost:1420/), tauri dev (http://192.168.x.x:1420/),
// and prod (http://tauri.localhost/) without per-environment branching.
const publicPath = new URL('/imgly/', self.location.href).toString();

self.addEventListener('message', (event: MessageEvent<WorkerInbound>) => {
  void (async () => {
    const { source } = event.data;
    try {
      const config: Config = {
        model: 'isnet_quint8',
        device: 'cpu',
        publicPath,
        output: { format: 'image/png', quality: 1 },
        progress: (key, current, total) => {
          const message: ProgressMessage = {
            type: 'progress',
            key,
            current,
            total,
          };
          self.postMessage(message);
        },
      };
      const blob = await imglyRemoveBackground(source, config);
      const message: ResultMessage = { type: 'result', blob };
      self.postMessage(message);
    } catch (err) {
      const message: ErrorMessage = {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
      self.postMessage(message);
    }
  })();
});
