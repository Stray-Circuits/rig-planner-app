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
import {
  clampToBoard,
  keepOutRect,
  overlappingPlacedIds,
} from '../lib/geometry';
import { resolveBoardImageSrc } from '../data/boardPresets';
import { BOARD_DRAWERS, backgroundForStyle } from './boardStyles';
import { getCachedBoardImage, loadBoardImage } from './boardImageCache';
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
  /**
   * Fired when the user taps a pedal's body (anywhere on the pedal
   * sprite) while in chain mode. The parent opens a port-picker sheet
   * for that pedal — the new tap-then-pick connection grammar.
   */
  onPedalTap?: (placedId: string) => void;
  /** Fired when the user drag-releases from one port onto another. */
  onPortConnect?: (
    fromPlacedId: string,
    fromPortId: string,
    toPlacedId: string,
    toPortId: string,
  ) => void;
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
// Any movement past this kills a pending long-press, even if it's still
// below the drag-promotion threshold. Small enough to ignore touch-rest
// jitter, large enough that a real nudge cancels the actions sheet.
const LONG_PRESS_CANCEL_PX = 2;
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
  onPedalTap,
  onPortConnect,
  onCableTap,
  onEndpointTap,
  armedPort = null,
  unconnectedRequired,
}: BoardCanvasProps) {
  const warnings = unconnectedRequired ?? EMPTY_WARNING_SET;
  const overlapping = useMemo(
    () => overlappingPlacedIds(placed, pedalsById),
    [placed, pedalsById],
  );
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

  const imageSrc = useMemo(
    () =>
      resolveBoardImageSrc({
        style: rig.style,
        presetId: rig.presetId,
        widthIn: rig.widthIn,
        depthIn: rig.depthIn,
      }),
    [rig.style, rig.presetId, rig.widthIn, rig.depthIn],
  );

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
    const drawCtx = ctx;
    drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const drawImage = (img: HTMLImageElement) => {
      drawCtx.clearRect(0, 0, widthPx, heightPx);
      drawCtx.drawImage(img, 0, 0, widthPx, heightPx);
    };
    const drawProcedural = () => {
      BOARD_DRAWERS[rig.style]({
        ctx: drawCtx,
        width: widthPx,
        height: heightPx,
        scale: 1,
        widthIn: rig.widthIn,
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
    // Paint procedural as a placeholder, then swap in the bundled image
    // once it decodes. `cancelled` guards against a src change mid-load
    // (e.g. user changes the board) so we don't overwrite a fresh draw.
    drawProcedural();
    let cancelled = false;
    void loadBoardImage(imageSrc)
      .then((img) => {
        if (cancelled) return;
        drawImage(img);
      })
      .catch(() => {
        // Procedural fallback is already on-canvas; swallow the error.
      });
    return () => {
      cancelled = true;
    };
  }, [rig.style, rig.widthIn, imageSrc, widthPx, heightPx, dpr]);

  const pointerToInches = useCallback(
    (clientX: number, clientY: number) => {
      const wrap = wrapRef.current;
      if (!wrap) return { xIn: 0, yIn: 0 };
      const rect = wrap.getBoundingClientRect();
      // The wrapper is CSS-transformed (pinch-zoom) by the parent viewport,
      // so the rect's on-screen size already includes that scale while
      // pxPerInch does not. Derive the effective conversion from the rect
      // itself so dragging tracks the finger at any zoom level.
      const effPxPerInchX = rect.width / rig.widthIn || pxPerInch;
      const effPxPerInchY = rect.height / rig.depthIn || pxPerInch;
      return {
        xIn: (clientX - rect.left) / effPxPerInchX,
        yIn: (clientY - rect.top) / effPxPerInchY,
      };
    },
    [pxPerInch, rig.widthIn, rig.depthIn],
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
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      const distSq = dx * dx + dy * dy;
      // Cancel the pending long-press as soon as the finger moves past
      // resting-jitter. A user nudging a pedal shouldn't get the actions
      // sheet just because they didn't cross the drag-promotion threshold.
      if (
        drag.longPressTimer &&
        distSq >= LONG_PRESS_CANCEL_PX * LONG_PRESS_CANCEL_PX
      ) {
        clearTimeout(drag.longPressTimer);
        drag.longPressTimer = null;
      }
      if (!drag.movedEnough) {
        if (distSq < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
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
        style={{
          background: imageSrc ? 'transparent' : backgroundForStyle(rig.style),
        }}
      />
      <div className={styles.keepOutLayer} aria-hidden>
        {placed.map((p) => {
          const def = pedalsById.get(p.pedalId);
          if (!def) return null;
          const r = keepOutRect(p, def);
          const isOverlapping = overlapping.has(p.id);
          return (
            <div
              key={p.id}
              className={`${styles.keepOut} ${
                isOverlapping ? styles.keepOutOverlap : ''
              }`}
              style={{
                left: r.xIn * pxPerInch,
                top: r.yIn * pxPerInch,
                width: r.widthIn * pxPerInch,
                height: r.depthIn * pxPerInch,
              }}
            />
          );
        })}
      </div>
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
              onClick={(e) => {
                // In chain mode the pedal body is the connection-pick
                // tap target — opens the port picker sheet. Stop the
                // click from bubbling to the canvas-background handler
                // which would clear an armed port.
                if (chainMode && onPedalTap) {
                  e.stopPropagation();
                  onPedalTap(p.id);
                }
              }}
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
          {...(onPortConnect ? { onPortConnect } : {})}
          {...(onCableTap ? { onCableTap } : {})}
          {...(onEndpointTap ? { onEndpointTap } : {})}
        />
      ) : null}
    </div>
  );
}
