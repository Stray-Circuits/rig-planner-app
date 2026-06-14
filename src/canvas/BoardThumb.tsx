import { useEffect, useRef } from 'react';
import type { BoardStyle } from '../data/schema';
import { BOARD_DRAWERS, backgroundForStyle } from './boardStyles';
import { getCachedBoardImage, loadBoardImage } from './boardImageCache';

interface BoardThumbProps {
  style: BoardStyle;
  width: number;
  height: number;
  /** Tuning param for detail density; defaults to width-derived. */
  scale?: number;
  /**
   * Real-world board width in inches. When provided to drawHoles, lets it
   * size hole density to the board (so a Temple Trio 43 shows more holes
   * than a Solo 18 in the picker thumbs) rather than using a fixed
   * scale-derived pattern.
   */
  widthIn?: number;
  /**
   * When set, the thumb renders this bundled image instead of the procedural
   * drawer for `style`. Caller is responsible for picking the right preset
   * image (see resolveBoardImageSrc).
   */
  imageSrc?: string;
  className?: string;
  title?: string;
}

export function BoardThumb({
  style,
  width,
  height,
  scale,
  widthIn,
  imageSrc,
  className,
  title,
}: BoardThumbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dpr =
    typeof window !== 'undefined' ? (window.devicePixelRatio ?? 1) : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      // jsdom and some sandboxed environments don't implement Canvas2D.
      return;
    }
    if (!ctx) return;
    const drawCtx = ctx;
    drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const drawImage = (img: HTMLImageElement) => {
      drawCtx.clearRect(0, 0, width, height);
      drawCtx.drawImage(img, 0, 0, width, height);
    };
    const drawProcedural = () => {
      BOARD_DRAWERS[style]({
        ctx: drawCtx,
        width,
        height,
        scale: scale ?? width / 500,
        ...(widthIn !== undefined ? { widthIn } : {}),
      });
    };

    if (!imageSrc) {
      drawProcedural();
      return;
    }
    const cached = getCachedBoardImage(imageSrc);
    if (cached) {
      drawImage(cached);
      return;
    }
    drawProcedural();
    let cancelled = false;
    void loadBoardImage(imageSrc)
      .then((img) => {
        if (cancelled) return;
        drawImage(img);
      })
      .catch(() => {
        // Procedural fallback is already on-canvas.
      });
    return () => {
      cancelled = true;
    };
  }, [style, width, height, scale, widthIn, imageSrc, dpr]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        background: imageSrc ? 'transparent' : backgroundForStyle(style),
      }}
      role="img"
      aria-label={title ?? `${style} board`}
    />
  );
}
