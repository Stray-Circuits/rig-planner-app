import { useEffect, useRef } from 'react';
import type { BoardStyle } from '../data/schema';
import { BOARD_DRAWERS, backgroundForStyle } from './boardStyles';

interface BoardThumbProps {
  style: BoardStyle;
  width: number;
  height: number;
  /** Tuning param for detail density; defaults to width-derived. */
  scale?: number;
  className?: string;
  title?: string;
}

export function BoardThumb({
  style,
  width,
  height,
  scale,
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
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const draw = BOARD_DRAWERS[style];
    draw({ ctx, width, height, scale: scale ?? width / 500 });
  }, [style, width, height, scale, dpr]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ background: backgroundForStyle(style) }}
      role="img"
      aria-label={title ?? `${style} board`}
    />
  );
}
