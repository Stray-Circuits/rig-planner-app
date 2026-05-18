import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type {
  Connection,
  ExternalEndpoint,
  Pedal,
  PlacedPedal,
  Rig,
} from '../data/schema';
import { clampToBoard } from '../lib/geometry';
import { BOARD_DRAWERS, backgroundForStyle } from './boardStyles';
import { PedalSprite } from './PedalSprite';
import { ChainOverlay } from './ChainOverlay';
import styles from './BoardCanvas.module.css';

const EMPTY_WARNING_SET = new Set<string>();

interface BoardCanvasProps {
  rig: Rig;
  placed: PlacedPedal[];
  pedalsById: Map<string, Pedal>;
  pxPerInch: number;
  /** Called continuously during a drag with the proposed top-left in inches. */
  onDragMove?: (placedId: string, xIn: number, yIn: number) => void;
  /** Called once when the user releases a dragged pedal. */
  onDragCommit?: (placedId: string) => void;
  /** Called when the user long-presses (mobile) or right-clicks (desktop). */
  onRequestActions?: (placedId: string) => void;

  /** When true, chain-mode overlays are rendered and pedal drag is suspended. */
  chainMode?: boolean;
  /** Active rig's connections — only rendered when chainMode is true. */
  connections?: Connection[];
  /** External endpoints for the active rig (Guitar, Amp, etc.). */
  endpoints?: ExternalEndpoint[];
  /** Fired when the user taps a port in chain mode. */
  onPortTap?: (placedId: string, portId: string) => void;
  /** Fired when the user taps an existing cable in chain mode. */
  onCableTap?: (connectionId: string) => void;
  /** Fired when the user taps an external endpoint chip. */
  onEndpointTap?: (endpointId: string) => void;
  /** Currently-armed port (highlighted), if any. */
  armedPort?: { placedId: string; portId: string } | null;
  /** Set of "${placedId}:${portId}" keys to render as warnings. */
  unconnectedRequired?: Set<string>;
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
  /** Pending long-press timer (cleared if drag starts or pointer lifts early). */
  longPressTimer: ReturnType<typeof setTimeout> | null;
  /** Has the long-press timer fired? When true, we suppress the drag for this gesture. */
  longPressFired: boolean;
}

const DRAG_THRESHOLD_PX = 4;
const LONG_PRESS_MS = 450;

export function BoardCanvas({
  rig,
  placed,
  pedalsById,
  pxPerInch,
  onDragMove,
  onDragCommit,
  onRequestActions,
  chainMode = false,
  connections = [],
  endpoints = [],
  onPortTap,
  onCableTap,
  onEndpointTap,
  armedPort = null,
  unconnectedRequired,
}: BoardCanvasProps) {
  const warnings = unconnectedRequired ?? EMPTY_WARNING_SET;
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
      // Suspend pedal drag / long-press while routing signal cables.
      if (chainMode) return;
      if (!onDragMove && !onRequestActions) return;
      const def = pedalsById.get(p.pedalId);
      if (!def) return;
      // Only respond to primary pointer (left mouse / first touch).
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const { xIn, yIn } = pointerToInches(e.clientX, e.clientY);
      const longPressTimer = onRequestActions
        ? setTimeout(() => {
            const drag = dragRef.current;
            if (!drag || drag.movedEnough) return;
            drag.longPressFired = true;
            onRequestActions(p.id);
          }, LONG_PRESS_MS)
        : null;
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
        longPressTimer,
        longPressFired: false,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      // Pedal drag owns this pointer; don't let canvas-level pinch/pan
      // gestures pick it up.
      e.stopPropagation();
    },
    [chainMode, onDragMove, onRequestActions, pedalsById, pointerToInches],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag?.pointerId !== e.pointerId) return;
      if (drag.longPressFired) return;
      if (!drag.movedEnough) {
        const dx = e.clientX - drag.startClientX;
        const dy = e.clientY - drag.startClientY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
        drag.movedEnough = true;
        if (drag.longPressTimer) {
          clearTimeout(drag.longPressTimer);
          drag.longPressTimer = null;
        }
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
      if (drag.longPressTimer) clearTimeout(drag.longPressTimer);
      if (drag.movedEnough && !drag.longPressFired) {
        onDragCommit?.(drag.placedId);
      }
      dragRef.current = null;
    },
    [onDragCommit],
  );

  const handleContextMenu = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>, p: PlacedPedal) => {
      if (!onRequestActions) return;
      e.preventDefault();
      // Cancel any in-flight drag so the gesture doesn't compete.
      const drag = dragRef.current;
      if (drag?.placedId === p.id && drag.longPressTimer) {
        clearTimeout(drag.longPressTimer);
        drag.longPressTimer = null;
      }
      onRequestActions(p.id);
    },
    [onRequestActions],
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
              onContextMenu={(e) => handleContextMenu(e, p)}
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
      {chainMode ? (
        <ChainOverlay
          rig={rig}
          placed={placed}
          pedalsById={pedalsById}
          connections={connections}
          endpoints={endpoints}
          pxPerInch={pxPerInch}
          armedPort={armedPort}
          unconnectedRequired={warnings}
          {...(onPortTap ? { onPortTap } : {})}
          {...(onCableTap ? { onCableTap } : {})}
          {...(onEndpointTap ? { onEndpointTap } : {})}
        />
      ) : null}
    </div>
  );
}
