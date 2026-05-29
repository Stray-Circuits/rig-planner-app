/**
 * Pre-bg-removal image editor: quarter-turn rotation, free-angle
 * straighten, and crop. Runs entirely on a 2D canvas so the result
 * is a Blob the rest of the pipeline (shrink → bg-remove → crop)
 * can chew on without caring it was edited.
 *
 * Crop coordinates are in *rotated* image-pixel space (after
 * quarter-turns and fine-angle are baked into the canvas) so the
 * UI layer only has to deal with one coordinate system.
 */

export type QuarterTurns = 0 | 1 | 2 | 3;

export interface EditorTransform {
  /** Quarter-turn rotation count (0 = none, 1 = 90° CW, etc.). */
  quarterTurns: QuarterTurns;
  /** Fine-angle rotation in degrees, clockwise. Recommended -45..+45. */
  fineAngleDeg: number;
  /**
   * Crop rectangle in *rotated*-image pixel coordinates. `null` keeps
   * the full rotated canvas.
   */
  crop: { x: number; y: number; w: number; h: number } | null;
}

export const IDENTITY_TRANSFORM: EditorTransform = {
  quarterTurns: 0,
  fineAngleDeg: 0,
  crop: null,
};

/**
 * Given the source bitmap dimensions and a transform, return the
 * rotated-image canvas dimensions (the un-cropped post-rotation
 * bounding box). The crop UI works in this coordinate space, so it
 * needs the same numbers the apply pass will use.
 */
export function rotatedCanvasSize(
  srcW: number,
  srcH: number,
  t: Pick<EditorTransform, 'quarterTurns' | 'fineAngleDeg'>,
): { w: number; h: number } {
  // Apply quarter-turn swap first — at 90/270 the rotated-axis-aligned
  // box swaps width/height.
  const qSwapped = t.quarterTurns % 2 === 1;
  const baseW = qSwapped ? srcH : srcW;
  const baseH = qSwapped ? srcW : srcH;
  if (t.fineAngleDeg === 0) return { w: baseW, h: baseH };
  const rad = (t.fineAngleDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return {
    w: Math.round(baseW * c + baseH * s),
    h: Math.round(baseW * s + baseH * c),
  };
}

/**
 * Rasterize the transform: returns a new PNG Blob with the chosen
 * rotation + crop baked in. The output is opaque (no transparency
 * is introduced; corners exposed by fine-angle rotation are filled
 * with `fillStyle`, default white, so the downstream bg-remover has
 * a single corner color to key against).
 */
export async function applyEditorTransform(
  source: Blob,
  transform: EditorTransform,
  options: { fillStyle?: string } = {},
): Promise<Blob> {
  const fillStyle = options.fillStyle ?? '#ffffff';
  const bitmap = await createImageBitmap(source);
  try {
    const srcW = bitmap.width;
    const srcH = bitmap.height;
    const { w: rotW, h: rotH } = rotatedCanvasSize(srcW, srcH, transform);

    // Step 1 — draw the rotated image to a working canvas in rotated coords.
    const rotCanvas = document.createElement('canvas');
    rotCanvas.width = rotW;
    rotCanvas.height = rotH;
    const rotCtx = rotCanvas.getContext('2d');
    if (!rotCtx) throw new Error('2D context unavailable');
    rotCtx.fillStyle = fillStyle;
    rotCtx.fillRect(0, 0, rotW, rotH);
    rotCtx.save();
    rotCtx.translate(rotW / 2, rotH / 2);
    rotCtx.rotate(
      (transform.quarterTurns * Math.PI) / 2 +
        (transform.fineAngleDeg * Math.PI) / 180,
    );
    // Source draws centered at the origin; after rotate(), the
    // un-rotated bitmap fits the rotated bbox by definition.
    rotCtx.drawImage(bitmap, -srcW / 2, -srcH / 2);
    rotCtx.restore();

    // Step 2 — if a crop is set, copy the rect to a final canvas.
    const crop = clampCrop(transform.crop, rotW, rotH);
    if (!crop) return canvasToPngBlob(rotCanvas);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = Math.max(1, crop.w);
    outCanvas.height = Math.max(1, crop.h);
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) throw new Error('2D context unavailable');
    outCtx.drawImage(
      rotCanvas,
      crop.x,
      crop.y,
      crop.w,
      crop.h,
      0,
      0,
      crop.w,
      crop.h,
    );
    return canvasToPngBlob(outCanvas);
  } finally {
    bitmap.close?.();
  }
}

/**
 * Constrain a proposed crop to the rotated-image bounds. Returns
 * null when the crop covers the whole canvas (no work to do) or
 * when the inputs are degenerate.
 */
export function clampCrop(
  crop: EditorTransform['crop'],
  rotW: number,
  rotH: number,
): { x: number; y: number; w: number; h: number } | null {
  if (!crop) return null;
  const x = Math.max(0, Math.min(rotW, Math.round(crop.x)));
  const y = Math.max(0, Math.min(rotH, Math.round(crop.y)));
  const maxW = rotW - x;
  const maxH = rotH - y;
  const w = Math.max(1, Math.min(maxW, Math.round(crop.w)));
  const h = Math.max(1, Math.min(maxH, Math.round(crop.h)));
  if (x === 0 && y === 0 && w === rotW && h === rotH) return null;
  return { x, y, w, h };
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('toBlob returned null'));
      },
      'image/png',
      0.92,
    );
  });
}

/**
 * True when the transform would change the image's pixels in any
 * way — used to skip the apply pass entirely when the user opens
 * the editor and dismisses without touching the controls.
 */
export function transformIsIdentity(t: EditorTransform): boolean {
  return t.quarterTurns === 0 && t.fineAngleDeg === 0 && t.crop === null;
}
