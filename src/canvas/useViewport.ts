import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';

/**
 * Tracks a 2D viewport transform (scale + pan) for the canvas area.
 *
 * Inputs:
 *  - 2-finger pinch (mobile): tracks two simultaneous pointers, derives scale
 *    from the change in finger distance and pan from the change in midpoint.
 *  - Wheel (desktop): ctrl/cmd+wheel zooms around the cursor; plain wheel pans
 *    (which matches the macOS trackpad two-finger gesture).
 *
 * The transform is applied as a CSS `translate(panX, panY) scale(scale)` on
 * the consumer's element, so the underlying layout doesn't change.
 */
export interface Viewport {
  scale: number;
  panX: number;
  panY: number;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

interface PointerInfo {
  x: number;
  y: number;
}

interface PinchAnchor {
  initialDistance: number;
  initialMidX: number;
  initialMidY: number;
  initialScale: number;
  initialPanX: number;
  initialPanY: number;
}

export interface UseViewportResult {
  viewport: Viewport;
  reset: () => void;
  setScale: (s: number) => void;
  pointerHandlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  };
  /** Bind via container.addEventListener('wheel', …, { passive: false }) — React's onWheel is passive in some setups so we attach manually. */
  attachWheel: (el: HTMLElement | null) => void;
}

export interface UseViewportOptions {
  /**
   * Fired once when a second touch pointer lands and the pinch anchor is
   * formed. Lets the consumer cancel any in-flight single-finger gesture
   * (e.g. a pedal drag) so it doesn't compete with the pinch.
   */
  onPinchStart?: () => void;
}

export function useViewport(
  options: UseViewportOptions = {},
): UseViewportResult {
  // Standard event-handler ref: assign during render so the ref always
  // points at the latest closure without a one-render lag.
  const onPinchStartRef = useRef(options.onPinchStart);
  onPinchStartRef.current = options.onPinchStart;
  const [viewport, setViewport] = useState<Viewport>({
    scale: 1,
    panX: 0,
    panY: 0,
  });
  const pointersRef = useRef<Map<number, PointerInfo>>(new Map());
  const pinchAnchorRef = useRef<PinchAnchor | null>(null);

  const reset = useCallback(() => {
    setViewport({ scale: 1, panX: 0, panY: 0 });
  }, []);

  const setScale = useCallback((s: number) => {
    setViewport((v) => ({
      ...v,
      scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, s)),
    }));
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      // Only react to touch pointers — mouse / pen handled via wheel.
      if (e.pointerType !== 'touch') return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointersRef.current.size === 2) {
        const [a, b] = Array.from(pointersRef.current.values());
        if (!a || !b) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        pinchAnchorRef.current = {
          initialDistance: Math.hypot(dx, dy),
          initialMidX: (a.x + b.x) / 2,
          initialMidY: (a.y + b.y) / 2,
          initialScale: viewport.scale,
          initialPanX: viewport.panX,
          initialPanY: viewport.panY,
        };
        onPinchStartRef.current?.();
      }
    },
    [viewport.scale, viewport.panX, viewport.panY],
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'touch') return;
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const anchor = pinchAnchorRef.current;
    if (!anchor || pointersRef.current.size !== 2) return;
    const [a, b] = Array.from(pointersRef.current.values());
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const rawScale =
      anchor.initialScale * (dist / Math.max(1, anchor.initialDistance));
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, rawScale));
    const newPanX = anchor.initialPanX + (midX - anchor.initialMidX);
    const newPanY = anchor.initialPanY + (midY - anchor.initialMidY);
    setViewport({ scale: newScale, panX: newPanX, panY: newPanY });
  }, []);

  const releasePointer = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'touch') return;
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchAnchorRef.current = null;
  }, []);

  // Wheel handling — attached manually so we can use { passive: false } and
  // preventDefault to stop the page from scrolling.
  const wheelHandler = useCallback((event: WheelEvent) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY / 200);
      setViewport((v) => ({
        ...v,
        scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor)),
      }));
    } else {
      setViewport((v) => ({
        ...v,
        panX: v.panX - event.deltaX,
        panY: v.panY - event.deltaY,
      }));
    }
  }, []);

  const attachedRef = useRef<HTMLElement | null>(null);
  const attachWheel = useCallback(
    (el: HTMLElement | null) => {
      if (attachedRef.current === el) return;
      if (attachedRef.current) {
        attachedRef.current.removeEventListener('wheel', wheelHandler);
      }
      attachedRef.current = el;
      if (el) {
        el.addEventListener('wheel', wheelHandler, { passive: false });
      }
    },
    [wheelHandler],
  );

  useEffect(() => {
    return () => {
      if (attachedRef.current) {
        attachedRef.current.removeEventListener('wheel', wheelHandler);
        attachedRef.current = null;
      }
    };
  }, [wheelHandler]);

  return {
    viewport,
    reset,
    setScale,
    pointerHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: releasePointer,
      onPointerCancel: releasePointer,
    },
    attachWheel,
  };
}

// Used by the consumer to dodge the unused suppressed onWheel hint; this
// React event prop is otherwise unused since we attach the wheel listener
// manually for { passive: false }.
export function _ignoreReactWheel(_e: ReactWheelEvent<HTMLElement>): void {
  /* no-op */
}
