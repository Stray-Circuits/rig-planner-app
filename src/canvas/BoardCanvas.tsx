import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Pedal, PlacedPedal, Rig } from '../data/schema';
import { clampToBoard } from '../lib/geometry';
import { BOARD_DRAWERS, backgroundForStyle } from './boardStyles';
import { PedalSprite } from './PedalSprite';
import styles from './BoardCanvas.module.css';

interface BoardCanvasProps {
  rig: Rig;
  placed: PlacedPedal[];
  pedalsById: Map<string, Pedal>;
  pxPerInch: number;
  /** Called continuously during a drag with the proposed top-left in inches. */
  onDragMove?: (placedId: string, xIn: number, yIn: number) => void;
  /** Called once when the user releases a dragged pedal. */
  onDragCommit?: (placedId: string) => void;
}

interface DragState {
  placedId: string;
  pointerId: number;
  // Where the pointer grabbed inside the pedal, in inches.
  grabXIn: number;
  grabYIn: number;
  // Pedal definition + rotation captured at drag start (for clamping math).
  pedal: Pedal;
  rotation: PlacedPedal['rotation'];
  /** Have we crossed the small movement threshold that promotes touch into a real drag? */
  movedEnough: boolean;
  /** Pointer position at drag start (CSS px). */
  startClientX: number;
  startClientY: number;
}

const DRAG_THRESHOLD_PX = 4;

export function BoardCanvas({
  rig,
  placed,
  pedalsById,
  pxPerInch,
  onDragMove,
  onDragCommit,
}: BoardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

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

  const pointerToInches = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return { xIn: 0, yIn: 0 };
      const rect = wrap.getBoundingClientRect();
      return {
        xIn: (clientX - rect.left) / pxPerInch,
        yIn: (clientY - rect.top) / pxPerInch,
      };
    },
    [pxPerInch],
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, p: PlacedPedal) => {
      if (!onDragMove) return;
      const def = pedalsById.get(p.pedalId);
      if (!def) return;
      // Only respond to primary pointer (left mouse / first touch).
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const { xIn, yIn } = pointerToInches(e.clientX, e.clientY);
      dragRef.current = {
        placedId: p.id,
        pointerId: e.pointerId,
        grabXIn: xIn - p.xIn,
        grabYIn: yIn - p.yIn,
        pedal: def,
        rotation: p.rotation,
        movedEnough: false,
        startClientX: e.clientX,
        startClientY: e.clientY,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [onDragMove, pedalsById, pointerToInches],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag?.pointerId !== e.pointerId) return;
      if (!drag.movedEnough) {
        const dx = e.clientX - drag.startClientX;
        const dy = e.clientY - drag.startClientY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
        drag.movedEnough = true;
      }
      const { xIn, yIn } = pointerToInches(e.clientX, e.clientY);
      const proposed = clampToBoard(
        xIn - drag.grabXIn,
        yIn - drag.grabYIn,
        drag.pedal,
        drag.rotation,
        rig,
      );
      onDragMove?.(drag.placedId, proposed.xIn, proposed.yIn);
    },
    [onDragMove, pointerToInches, rig],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag?.pointerId !== e.pointerId) return;
      e.currentTarget.releasePointerCapture(e.pointerId);
      if (drag.movedEnough) {
        onDragCommit?.(drag.placedId);
      }
      dragRef.current = null;
    },
    [onDragCommit],
  );

  return (
    <div
      ref={wrapRef}
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
                touchAction: 'none',
              }}
              data-placed-id={p.id}
              onPointerDown={(e) => handlePointerDown(e, p)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
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
