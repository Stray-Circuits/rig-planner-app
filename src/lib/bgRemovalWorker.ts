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

self.addEventListener('message', (event: MessageEvent<WorkerInbound>) => {
  void (async () => {
    const { source } = event.data;
    try {
      const config: Config = {
        model: 'isnet_quint8',
        device: 'cpu',
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
