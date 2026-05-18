import { useEffect, useMemo, useRef } from 'react';
import type { Pedal, PlacedPedal, Rig } from '../data/schema';
import { BOARD_DRAWERS, backgroundForStyle } from './boardStyles';
import { PedalSprite } from './PedalSprite';
import styles from './BoardCanvas.module.css';

interface BoardCanvasProps {
  rig: Rig;
  placed: PlacedPedal[];
  /** Lookup from pedal id to the underlying Pedal definition. */
  pedalsById: Map<string, Pedal>;
  /** Pixels per inch — caller sets this to fit the available viewport. */
  pxPerInch: number;
}

/**
 * Renders the rig as a board (canvas) with placed pedals positioned on top.
 * The wrapping <div> carries the drop-shadow so transparent canvas surfaces
 * (rail boards) render correctly.
 */
export function BoardCanvas({
  rig,
  placed,
  pedalsById,
  pxPerInch,
}: BoardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const widthPx = useMemo(
    () => rig.widthIn * pxPerInch,
    [rig.widthIn, pxPerInch],
  );
  const heightPx = useMemo(
    () => rig.depthIn * pxPerInch,
    [rig.depthIn, pxPerInch],
  );
  const dpr =
    typeof window !== 'undefined' ? (window.devicePixelRatio ?? 1) : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.round(widthPx * dpr);
    canvas.height = Math.round(heightPx * dpr);
    canvas.style.width = `${widthPx}px`;
    canvas.style.height = `${heightPx}px`;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      return;
    }
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    BOARD_DRAWERS[rig.style]({
      ctx,
      width: widthPx,
      height: heightPx,
      scale: 1,
    });
  }, [rig.style, widthPx, heightPx, dpr]);

  return (
    <div
      className={styles.wrap}
      style={{ width: widthPx, height: heightPx }}
      data-testid="board-canvas"
    >
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        style={{ background: backgroundForStyle(rig.style) }}
      />
      <div className={styles.pedals}>
        {placed.map((p) => {
          const def = pedalsById.get(p.pedalId);
          if (!def) return null;
          return (
            <div
              key={p.id}
              className={styles.pedalPos}
              style={{
                left: p.xIn * pxPerInch,
                top: p.yIn * pxPerInch,
              }}
              data-placed-id={p.id}
            >
              <PedalSprite
                pedal={def}
                pxPerInch={pxPerInch}
                rotation={p.rotation}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
