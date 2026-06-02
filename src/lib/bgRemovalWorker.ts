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

// Bundled imgly assets live under `/imgly/` (see scripts/fetch-imgly-assets.mjs
// + public/imgly/). In APK builds they ship inside the app — no first-run
// model download. In dev they're served by Vite over the LAN, which is the
// same network cost as fetching from imgly's CDN.
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
