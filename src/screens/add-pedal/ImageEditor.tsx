import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  IDENTITY_TRANSFORM,
  applyEditorTransform,
  clampCrop,
  rotatedCanvasSize,
  type EditorTransform,
  type QuarterTurns,
} from '../../lib/imageEdit';
import { Button } from '../../ui';
import styles from './ImageEditor.module.css';

interface ImageEditorProps {
  source: Blob;
  /** Applied transform → new source blob, ready for bg-removal. */
  onApply: (edited: Blob) => void;
  onCancel: () => void;
}

type CropHandle = 'nw' | 'ne' | 'sw' | 'se' | 'move';

interface DragState {
  pointerId: number;
  handle: CropHandle;
  /** Crop rect at drag start (rotated-image px). */
  start: { x: number; y: number; w: number; h: number };
  /** Pointer client coords at drag start. */
  startClientX: number;
  startClientY: number;
  /** Display→source scale captured at drag start. */
  pxPerSrcPx: number;
}

const MIN_CROP_PX = 24;

/**
 * Pre-bg-removal editor. Lets the user rotate the source by quarter
 * turns, straighten by ±45°, and crop. Emits a new PNG Blob the
 * existing pipeline (shrink → bg-remove → cropToContent) consumes
 * as if the user had picked it directly.
 */
export function ImageEditor({ source, onApply, onCancel }: ImageEditorProps) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [transform, setTransform] =
    useState<EditorTransform>(IDENTITY_TRANSFORM);
  const [applying, setApplying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  // Display size of the rotated canvas in CSS pixels — needed so the
  // crop overlay can mirror the canvas's on-screen geometry. Updated
  // in the same effect that draws the canvas.
  const [displaySize, setDisplaySize] = useState<{
    w: number;
    h: number;
  } | null>(null);

  // Load the source blob into a reusable ImageBitmap on mount. The
  // editor doesn't run the bg-removal pipeline itself, so we keep
  // the bitmap around for live preview redraws and only call
  // `applyEditorTransform` on the user's Apply tap.
  useEffect(() => {
    let cancelled = false;
    createImageBitmap(source)
      .then((b) => {
        if (cancelled) {
          b.close?.();
          return;
        }
        setBitmap(b);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  // Free the bitmap when the editor unmounts.
  useEffect(() => {
    return () => {
      bitmap?.close?.();
    };
  }, [bitmap]);

  // Draw the rotated preview to the canvas whenever the bitmap,
  // rotation, or container size changes. Crop is rendered as a
  // CSS overlay on top so it doesn't require a redraw per drag.
  useEffect(() => {
    if (!bitmap) return;
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const srcW = bitmap.width;
    const srcH = bitmap.height;
    const { w: rotW, h: rotH } = rotatedCanvasSize(srcW, srcH, transform);
    canvas.width = rotW;
    canvas.height = rotH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rotW, rotH);
    ctx.save();
    ctx.translate(rotW / 2, rotH / 2);
    ctx.rotate(
      (transform.quarterTurns * Math.PI) / 2 +
        (transform.fineAngleDeg * Math.PI) / 180,
    );
    ctx.drawImage(bitmap, -srcW / 2, -srcH / 2);
    ctx.restore();

    // Fit-to-stage: scale the canvas down (or up to a max) so the
    // longest edge of the rotated bbox fits the stage's bounds with
    // a little breathing room.
    const stageRect = stage.getBoundingClientRect();
    const maxW = stageRect.width;
    const maxH = stageRect.height;
    const scale = Math.min(maxW / rotW, maxH / rotH, 1);
    const dispW = Math.max(1, Math.floor(rotW * scale));
    const dispH = Math.max(1, Math.floor(rotH * scale));
    canvas.style.width = `${dispW}px`;
    canvas.style.height = `${dispH}px`;
    setDisplaySize({ w: dispW, h: dispH });
  }, [bitmap, transform]);

  // Re-fit on resize so rotating the device (or just an iframe
  // reflow) doesn't leave the preview clipped or in dead space.
  useEffect(() => {
    const onResize = () => {
      setTransform((t) => ({ ...t }));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const setQuarter = (delta: 1 | -1) => {
    setTransform((t) => {
      const next = ((t.quarterTurns + delta + 4) % 4) as QuarterTurns;
      // Drop the crop on quarter turns — the rotated bbox swaps
      // dims so the previous crop rect would land in the wrong
      // place anyway.
      return { ...t, quarterTurns: next, crop: null };
    });
  };

  const setAngle = (deg: number) => {
    setTransform((t) => ({ ...t, fineAngleDeg: deg, crop: null }));
  };

  const resetAll = () => {
    setTransform(IDENTITY_TRANSFORM);
  };

  // ---- Crop handle drag --------------------------------------------------
  const beginCropDrag = (
    e: ReactPointerEvent<HTMLDivElement>,
    handle: CropHandle,
  ) => {
    if (!bitmap || !displaySize) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const { w: rotW } = rotatedCanvasSize(
      bitmap.width,
      bitmap.height,
      transform,
    );
    const pxPerSrcPx = displaySize.w / rotW;
    const start = transform.crop ?? {
      x: 0,
      y: 0,
      w: bitmap.width,
      h: bitmap.height,
    };
    dragRef.current = {
      pointerId: e.pointerId,
      handle,
      start: { ...start },
      startClientX: e.clientX,
      startClientY: e.clientY,
      pxPerSrcPx,
    };
  };

  const onCropPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d?.pointerId !== e.pointerId || !bitmap) return;
    const { w: rotW, h: rotH } = rotatedCanvasSize(
      bitmap.width,
      bitmap.height,
      transform,
    );
    const dxSrc = (e.clientX - d.startClientX) / d.pxPerSrcPx;
    const dySrc = (e.clientY - d.startClientY) / d.pxPerSrcPx;
    let { x, y, w, h } = d.start;
    if (d.handle === 'move') {
      x = clamp(x + dxSrc, 0, rotW - w);
      y = clamp(y + dySrc, 0, rotH - h);
    } else {
      // Corner: anchor the opposite corner and resize toward the
      // pointer-driven corner so dragging always feels intuitive.
      let x2 = x + w;
      let y2 = y + h;
      if (d.handle === 'nw') {
        x = clamp(x + dxSrc, 0, x2 - MIN_CROP_PX);
        y = clamp(y + dySrc, 0, y2 - MIN_CROP_PX);
      } else if (d.handle === 'ne') {
        x2 = clamp(x2 + dxSrc, x + MIN_CROP_PX, rotW);
        y = clamp(y + dySrc, 0, y2 - MIN_CROP_PX);
      } else if (d.handle === 'sw') {
        x = clamp(x + dxSrc, 0, x2 - MIN_CROP_PX);
        y2 = clamp(y2 + dySrc, y + MIN_CROP_PX, rotH);
      } else {
        x2 = clamp(x2 + dxSrc, x + MIN_CROP_PX, rotW);
        y2 = clamp(y2 + dySrc, y + MIN_CROP_PX, rotH);
      }
      w = x2 - x;
      h = y2 - y;
    }
    setTransform((t) => ({ ...t, crop: { x, y, w, h } }));
  };

  const endCropDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    dragRef.current = null;
  };

  const startCrop = () => {
    if (!bitmap) return;
    const { w: rotW, h: rotH } = rotatedCanvasSize(
      bitmap.width,
      bitmap.height,
      transform,
    );
    // Default crop: an inset rectangle so the handles are
    // immediately discoverable rather than hugging the corners.
    const inset = Math.round(Math.min(rotW, rotH) * 0.1);
    setTransform((t) => ({
      ...t,
      crop: {
        x: inset,
        y: inset,
        w: rotW - inset * 2,
        h: rotH - inset * 2,
      },
    }));
  };

  const clearCrop = () => setTransform((t) => ({ ...t, crop: null }));

  // ---- Apply -------------------------------------------------------------
  const handleApply = () => {
    setApplying(true);
    void (async () => {
      try {
        // Skip the rasterize when nothing changed — saves a roundtrip
        // through canvas → blob, and means the bg-removal pipeline
        // sees the original byte-identical file in the no-op case.
        const blob = await applyEditorTransform(source, transform);
        onApply(blob);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
        setApplying(false);
      }
    })();
  };

  // Crop rect in display coords (CSS px relative to the canvas).
  const cropDisp =
    bitmap && displaySize && transform.crop
      ? scaleCropToDisplay(transform.crop, bitmap, transform, displaySize)
      : null;

  return (
    <div className={styles.editor}>
      <div className={styles.stage} ref={stageRef}>
        {loadError ? (
          <p className={styles.error} role="alert">
            {loadError}
          </p>
        ) : !bitmap ? (
          <p className={styles.muted}>Loading…</p>
        ) : (
          <div className={styles.canvasFrame}>
            <canvas ref={canvasRef} className={styles.canvas} />
            {cropDisp ? (
              <div
                className={styles.cropOverlay}
                style={{
                  left: `${cropDisp.x}px`,
                  top: `${cropDisp.y}px`,
                  width: `${cropDisp.w}px`,
                  height: `${cropDisp.h}px`,
                }}
                onPointerDown={(e) => beginCropDrag(e, 'move')}
                onPointerMove={onCropPointerMove}
                onPointerUp={endCropDrag}
                onPointerCancel={endCropDrag}
              >
                {(['nw', 'ne', 'sw', 'se'] as const).map((h) => (
                  <div
                    key={h}
                    className={`${styles.handle} ${styles[`handle_${h}`]}`}
                    onPointerDown={(e) => beginCropDrag(e, h)}
                    onPointerMove={onCropPointerMove}
                    onPointerUp={endCropDrag}
                    onPointerCancel={endCropDrag}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className={styles.controls}>
        <div className={styles.rotateRow}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setQuarter(-1)}
            disabled={!bitmap}
            aria-label="Rotate 90 degrees left"
          >
            <i className="ti ti-rotate-2" aria-hidden /> 90° left
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setQuarter(1)}
            disabled={!bitmap}
            aria-label="Rotate 90 degrees right"
          >
            <i className="ti ti-rotate-clockwise-2" aria-hidden /> 90° right
          </Button>
          {transform.crop ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearCrop}
              disabled={!bitmap}
            >
              <i className="ti ti-crop-off" aria-hidden /> Clear crop
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={startCrop}
              disabled={!bitmap}
            >
              <i className="ti ti-crop" aria-hidden /> Crop
            </Button>
          )}
        </div>

        <label className={styles.angleRow}>
          <span className={styles.angleLabel}>
            Straighten
            <span className={styles.angleValue}>
              {transform.fineAngleDeg.toFixed(1)}°
            </span>
          </span>
          <input
            type="range"
            min="-45"
            max="45"
            step="0.5"
            value={transform.fineAngleDeg}
            onChange={(e) => setAngle(Number(e.target.value))}
            disabled={!bitmap}
            aria-label="Fine angle straighten"
          />
        </label>

        <div className={styles.actions}>
          <Button variant="ghost" onClick={onCancel} disabled={applying}>
            Cancel
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetAll}
            disabled={applying || !bitmap}
          >
            Reset
          </Button>
          <Button onClick={handleApply} disabled={applying || !bitmap}>
            {applying ? 'Applying…' : 'Apply'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function scaleCropToDisplay(
  crop: { x: number; y: number; w: number; h: number },
  bitmap: ImageBitmap,
  transform: EditorTransform,
  displaySize: { w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const { w: rotW, h: rotH } = rotatedCanvasSize(
    bitmap.width,
    bitmap.height,
    transform,
  );
  const c = clampCrop(crop, rotW, rotH);
  if (!c) {
    return { x: 0, y: 0, w: displaySize.w, h: displaySize.h };
  }
  const sx = displaySize.w / rotW;
  const sy = displaySize.h / rotH;
  return {
    x: c.x * sx,
    y: c.y * sy,
    w: c.w * sx,
    h: c.h * sy,
  };
}
