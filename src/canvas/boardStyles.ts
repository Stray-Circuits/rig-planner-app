/**
 * Canvas-drawing routines for the four board styles, ported from the mockups.
 *
 * Each `draw*` function paints a rectangular region of the given size onto a
 * 2D canvas context. They are pure with respect to the canvas they target —
 * no DOM, no React. Used by the new-rig wizard, rig list thumbnails, and the
 * main canvas screen.
 */
import type { BoardStyle } from '../data/schema';

export interface DrawArgs {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** Ratio relative to a "full size" board for tuning detail density. */
  scale: number;
}

export function drawRail({ ctx, width, height, scale }: DrawArgs): void {
  ctx.clearRect(0, 0, width, height);
  const NUM = 4;
  const railH = Math.max(2, Math.round(height * (scale < 0.5 ? 0.13 : 0.1)));
  const gap = (height - NUM * railH) / (NUM + 1);
  const firstY = Math.round(gap);
  const lastY = Math.round(gap + (NUM - 1) * (railH + gap));
  const frameH = lastY + railH - firstY;
  ctx.fillStyle = '#1C1C1C';
  for (let i = 0; i < NUM; i++) {
    ctx.fillRect(0, Math.round(gap + i * (railH + gap)), width, railH);
  }
  ctx.fillRect(0, firstY, railH, frameH);
  ctx.fillRect(width - railH, firstY, railH, frameH);
}

export function drawPlain({ ctx, width, height, scale }: DrawArgs): void {
  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(0, 0, width, height);
  if (scale >= 0.5) {
    // Add subtle noise for the full-size view, skip for tiny thumbnails.
    const id = ctx.getImageData(0, 0, width, height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      d[i] = clamp((d[i] ?? 0) + n);
      d[i + 1] = clamp((d[i + 1] ?? 0) + n);
      d[i + 2] = clamp((d[i + 2] ?? 0) + n);
    }
    ctx.putImageData(id, 0, 0);
  }
  ctx.strokeStyle = '#999';
  ctx.lineWidth = scale >= 0.5 ? 5 : 2.5;
  const outerInset = scale >= 0.5 ? 2.5 : 1.25;
  ctx.strokeRect(
    outerInset,
    outerInset,
    width - outerInset * 2,
    height - outerInset * 2,
  );
  ctx.strokeStyle = '#C8C8C8';
  ctx.lineWidth = scale >= 0.5 ? 1 : 0.75;
  const innerInset = scale >= 0.5 ? 5 : 3;
  ctx.strokeRect(
    innerInset,
    innerInset,
    width - innerInset * 2,
    height - innerInset * 2,
  );
}

export function drawWood({ ctx, width, height, scale }: DrawArgs): void {
  const colors = ['#8B6535', '#7A5828', '#966E3A', '#7D5C2C', '#8E6737'];
  const plankH = scale >= 0.5 ? 28 : 5;
  const gapH = scale >= 0.5 ? 3 : 1;
  let row = 0;
  for (let y = 0; y < height; y += plankH + gapH) {
    const rh = Math.min(plankH, height - y);
    ctx.fillStyle = colors[row % colors.length] ?? '#8B6535';
    ctx.fillRect(0, y, width, rh);
    if (scale >= 0.5) {
      for (let g = 0; g < 14; g++) {
        const gx = (g / 13) * width + Math.sin(row * 5 + g) * 6;
        ctx.beginPath();
        ctx.moveTo(gx, y);
        let cx = gx;
        for (let gy = y; gy < y + rh; gy += 5) {
          cx += Math.sin(gy * 0.25 + g * 0.7) * 1.1;
          ctx.lineTo(cx, gy);
        }
        ctx.strokeStyle = `rgba(0,0,0,${0.07 + (g % 3) * 0.04})`;
        ctx.lineWidth = 0.5 + (g % 2) * 0.5;
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(0, y, width, scale >= 0.5 ? 1 : 0.5);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(0, y + rh - 1, width, 1);
    if (y + rh < height) {
      ctx.fillStyle = '#1A0C04';
      ctx.fillRect(0, y + rh, width, gapH);
    }
    row++;
  }
}

export function drawHoles({ ctx, width, height, scale }: DrawArgs): void {
  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(0, 0, width, height);
  const sp = scale >= 0.5 ? 16 : 6;
  const r = scale >= 0.5 ? 5.5 : 2;
  const cols = Math.floor((width - sp) / sp);
  const rows = Math.floor((height - sp) / sp);
  const ox = (width - cols * sp) / 2 + sp / 2;
  const oy = (height - rows * sp) / 2 + sp / 2;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = ox + col * sp;
      const y = oy + row * sp;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();
      if (scale >= 0.5) {
        ctx.strokeStyle = '#3A3A3A';
        ctx.lineWidth = 0.75;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x - 0.5, y - 0.5, r - 1, Math.PI * 1.1, Math.PI * 1.7);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.75;
        ctx.stroke();
      }
    }
  }
}

function clamp(n: number): number {
  return Math.max(0, Math.min(255, n));
}

export const BOARD_DRAWERS: Record<BoardStyle, (args: DrawArgs) => void> = {
  rail: drawRail,
  plain: drawPlain,
  wood: drawWood,
  holes: drawHoles,
};

/** Background color behind a board with this style (the "canvas" beneath). */
export function backgroundForStyle(style: BoardStyle): string {
  return style === 'rail' ? '#888' : 'transparent';
}
