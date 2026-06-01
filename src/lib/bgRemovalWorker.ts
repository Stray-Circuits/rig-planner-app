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

// Run ISNet at a smaller native resolution. The model is fully-convolutional
// so it accepts any input whose dims are multiples of 32 (5 downsample stages).
// Cost scales ~quadratically with input area, so 768 ≈ 0.56× the work of 1024.
// 1024 was the trained resolution; lower res trades fine-edge fidelity for
// speed. Tune empirically — if 768 looks fine, try 512 next.
const INFERENCE_MAX_PX = 768;

async function downscaleForInference(
  source: Blob,
  maxPx: number,
): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= maxPx) {
    bitmap.close();
    return source;
  }
  const scale = maxPx / longest;
  const roundTo32 = (n: number) => Math.max(32, Math.round(n / 32) * 32);
  const w = roundTo32(bitmap.width * scale);
  const h = roundTo32(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return source;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/png' });
}

self.addEventListener('message', (event: MessageEvent<WorkerInbound>) => {
  void (async () => {
    const { source } = event.data;
    try {
      const downscaled = await downscaleForInference(source, INFERENCE_MAX_PX);
      const config: Config = {
        model: 'isnet_quint8',
        device: 'cpu',
        // We downscaled to INFERENCE_MAX_PX ourselves; tell the lib not to
        // resize back up to 1024×1024 before inference.
        rescale: false,
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
      const blob = await imglyRemoveBackground(downscaled, config);
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
