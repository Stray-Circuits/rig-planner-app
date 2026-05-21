import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type {
  Connection,
  ExternalEndpoint,
  Pedal,
  PlacedPedal,
  Port,
  Rig,
  Side,
  SignalType,
} from '../data/schema';
import {
  placedRect,
  portPositionOnBoard,
  rotatedSide,
  routeCableWithLeader,
  type ObstacleRect,
} from '../lib/geometry';
import { colorForPort, colorForSignal } from '../lib/signalColors';
import { sortConnectionsForRender } from '../lib/signalChainWarnings';
import styles from './ChainOverlay.module.css';

interface ChainOverlayProps {
  rig: Rig;
  placed: PlacedPedal[];
  pedalsById: Map<string, Pedal>;
  connections: Connection[];
  endpoints: ExternalEndpoint[];
  pxPerInch: number;
  armedPort: { placedId: string; portId: string } | null;
  /** Set of "${placedId}:${portId}" keys to render as warnings. */
  unconnectedRequired: Set<string>;
  /** A short tap (no drag) on a port — toggles the armed state. */
  onPortTap?: (placedId: string, portId: string) => void;
  /**
   * A drag-to-connect gesture released over a different port. Lets the
   * parent create the connection directly without the user having to
   * tap each port in sequence.
   */
  onPortConnect?: (
    fromPlacedId: string,
    fromPortId: string,
    toPlacedId: string,
    toPortId: string,
  ) => void;
  onCableTap?: (connectionId: string) => void;
  onEndpointTap?: (endpointId: string) => void;
}

interface DragState {
  fromPlacedId: string;
  fromPortId: string;
  /** Cable origin in board px (already pxPerInch-scaled). */
  fromX: number;
  fromY: number;
  /** Current pointer position in board px relative to the SVG. */
  pointerX: number;
  pointerY: number;
  startClientX: number;
  startClientY: number;
  /** Crossed the tap-vs-drag threshold. */
  moved: boolean;
}

const DRAG_THRESHOLD_PX = 6;

interface ResolvedPort {
  placed: PlacedPedal;
  pedal: Pedal;
  port: Port;
  xIn: number;
  yIn: number;
  visualSide: Side;
}

/** Look up the visual position + side of a port given its placed pedal. */
function resolvePort(
  placed: PlacedPedal,
  pedal: Pedal,
  port: Port,
): ResolvedPort {
  const pos = portPositionOnBoard(placed, pedal, port);
  return {
    placed,
    pedal,
    port,
    xIn: pos.xIn,
    yIn: pos.yIn,
    visualSide: rotatedSide(port.side, placed.rotation),
  };
}

export function ChainOverlay({
  rig,
  placed,
  pedalsById,
  connections,
  endpoints,
  pxPerInch,
  armedPort,
  unconnectedRequired,
  onPortTap,
  onPortConnect,
  onCableTap,
  onEndpointTap,
}: ChainOverlayProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  // Build a {placedId -> {portId -> ResolvedPort}} map for fast lookups.
  const portIndex = new Map<string, Map<string, ResolvedPort>>();
  for (const p of placed) {
    const def = pedalsById.get(p.pedalId);
    if (!def) continue;
    const inner = new Map<string, ResolvedPort>();
    for (const port of def.ports) {
      inner.set(port.id, resolvePort(p, def, port));
    }
    portIndex.set(p.id, inner);
  }
  const endpointById = new Map(endpoints.map((e) => [e.id, e]));

  const widthPx = rig.widthIn * pxPerInch;
  const heightPx = rig.depthIn * pxPerInch;

  // Paint cables in role-group order so audio sits at the base, control
  // above it, and MIDI on top. Without this, later-added cables would
  // bury earlier ones regardless of signal type.
  const orderedConnections = sortConnectionsForRender(
    connections,
    placed,
    pedalsById,
  );

  // Pre-compute each placed pedal's footprint rect so cable routing can
  // detour around them. Keyed by placed.id so per-connection obstacle
  // lists can quickly exclude the source and destination pedals.
  const obstacleByPlaced = new Map<string, ObstacleRect>();
  for (const p of placed) {
    const def = pedalsById.get(p.pedalId);
    if (def) obstacleByPlaced.set(p.id, placedRect(p, def));
  }

  // ---- Drag-to-connect helpers ------------------------------------------
  // Convert a client (screen) point to the SVG's local pixel coords. The
  // SVG is positioned absolutely inside the board wrapper so its
  // getBoundingClientRect aligns with the board pixel space.
  const clientToBoardPx = (
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const handlePortPointerDown = (
    placedId: string,
    portId: string,
    resolved: ResolvedPort,
    e: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      fromPlacedId: placedId,
      fromPortId: portId,
      fromX: resolved.xIn * pxPerInch,
      fromY: resolved.yIn * pxPerInch,
      pointerX: resolved.xIn * pxPerInch,
      pointerY: resolved.yIn * pxPerInch,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
    });
  };

  const handlePortPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startClientX;
    const dy = e.clientY - d.startClientY;
    const moved = d.moved || Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;
    const local = clientToBoardPx(e.clientX, e.clientY);
    setDrag({
      ...d,
      pointerX: local?.x ?? d.pointerX,
      pointerY: local?.y ?? d.pointerY,
      moved,
    });
  };

  const handlePortPointerUp = (
    placedId: string,
    portId: string,
    e: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const d = dragRef.current;
    if (!d) return;
    // Release pointer capture regardless of outcome.
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    // Treat as a tap if the pointer didn't move far — fire onPortTap so
    // the existing tap-arm UX still works.
    if (!d.moved) {
      setDrag(null);
      onPortTap?.(placedId, portId);
      return;
    }
    // Hit-test the element under the release point. Pointer capture
    // routes events to the source button, so the actual drop target
    // needs elementFromPoint.
    const dropTarget = document.elementFromPoint(e.clientX, e.clientY);
    const btn = dropTarget?.closest(
      '[data-placed-id][data-port-id]',
    ) as HTMLElement | null;
    setDrag(null);
    if (!btn) return;
    const targetPlacedId = btn.dataset.placedId!;
    const targetPortId = btn.dataset.portId!;
    if (targetPlacedId === d.fromPlacedId && targetPortId === d.fromPortId) {
      // Dropped back on the source — treat as cancel.
      return;
    }
    onPortConnect?.(d.fromPlacedId, d.fromPortId, targetPlacedId, targetPortId);
  };

  const handlePortPointerCancel = () => {
    setDrag(null);
  };

  return (
    <>
      <svg
        ref={svgRef}
        className={styles.cableLayer}
        width={widthPx}
        height={heightPx}
        viewBox={`0 0 ${widthPx} ${heightPx}`}
        aria-hidden
      >
        {orderedConnections.map((c) => {
          const from = lookupConnectionEnd(
            c.fromNodeKind,
            c.fromNodeId,
            c.fromPortId,
            portIndex,
            endpointById,
            rig,
            pxPerInch,
          );
          const to = lookupConnectionEnd(
            c.toNodeKind,
            c.toNodeId,
            c.toPortId,
            portIndex,
            endpointById,
            rig,
            pxPerInch,
          );
          if (!from || !to) return null;
          // Color the cable from the from-port when there is one — that
          // matches what the user "sent" out into the cable. Both end
          // dots get their own port's color so an audio-L → audio-R
          // mismatch is visually obvious.
          const fromColor = from.port
            ? colorForPort(from.port)
            : colorForSignal(from.signalType ?? 'instrument');
          const toColor = to.port
            ? colorForPort(to.port)
            : colorForSignal(to.signalType ?? 'instrument');
          const cableColor = fromColor;
          const isExternal =
            c.fromNodeKind === 'external' || c.toNodeKind === 'external';
          // Build a per-cable obstacle list: every other pedal's
          // footprint EXCEPT the two pedals this cable plugs into.
          const fromOwnerId = c.fromNodeKind === 'pedal' ? c.fromNodeId : null;
          const toOwnerId = c.toNodeKind === 'pedal' ? c.toNodeId : null;
          const obstacles: ObstacleRect[] = [];
          for (const [id, rect] of obstacleByPlaced) {
            if (id === fromOwnerId || id === toOwnerId) continue;
            obstacles.push(rect);
          }
          // Manhattan polyline with a leader segment on each end — the
          // cable exits the pedal perpendicular before any 90° turn so
          // it visibly plugs into the port.
          const path = routeCableWithLeader(
            { xIn: from.xIn, yIn: from.yIn, side: from.side },
            { xIn: to.xIn, yIn: to.yIn, side: to.side },
            obstacles,
          );
          const d = path
            .map((p, i) => {
              const cmd = i === 0 ? 'M' : 'L';
              return `${cmd} ${p.xIn * pxPerInch} ${p.yIn * pxPerInch}`;
            })
            .join(' ');
          const fromCx = from.xIn * pxPerInch;
          const fromCy = from.yIn * pxPerInch;
          const toCx = to.xIn * pxPerInch;
          const toCy = to.yIn * pxPerInch;
          return (
            <g key={c.id}>
              {onCableTap ? (
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={styles.cableHit}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCableTap(c.id);
                  }}
                />
              ) : null}
              <path
                d={d}
                fill="none"
                stroke={cableColor}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={isExternal ? '5 3' : undefined}
              />
              {/* End-caps: colored dots at each pedal port. Slightly
                  larger than the cable stroke so the connection visibly
                  "plugs into" the pedal edge. */}
              <circle
                cx={fromCx}
                cy={fromCy}
                r={4}
                fill={fromColor}
                stroke="rgba(255,255,255,0.9)"
                strokeWidth={1}
              />
              <circle
                cx={toCx}
                cy={toCy}
                r={4}
                fill={toColor}
                stroke="rgba(255,255,255,0.9)"
                strokeWidth={1}
              />
            </g>
          );
        })}
        {drag?.moved ? (
          <line
            x1={drag.fromX}
            y1={drag.fromY}
            x2={drag.pointerX}
            y2={drag.pointerY}
            stroke="var(--primary)"
            strokeWidth={2}
            strokeDasharray="6 4"
            strokeLinecap="round"
          />
        ) : null}
      </svg>
      <div className={styles.portsLayer}>
        {placed.map((p) => {
          const def = pedalsById.get(p.pedalId);
          if (!def) return null;
          return def.ports.map((port) => {
            const resolved = portIndex.get(p.id)?.get(port.id);
            if (!resolved) return null;
            const isArmed =
              armedPort?.placedId === p.id && armedPort.portId === port.id;
            const isWarning = unconnectedRequired.has(`${p.id}:${port.id}`);
            return (
              <button
                key={`${p.id}-${port.id}`}
                type="button"
                data-placed-id={p.id}
                data-port-id={port.id}
                className={`${styles.portDot} ${isArmed ? styles.portDotArmed : ''} ${isWarning ? styles.portDotWarning : ''}`}
                style={{
                  left: resolved.xIn * pxPerInch,
                  top: resolved.yIn * pxPerInch,
                  background: isWarning ? 'var(--warning)' : colorForPort(port),
                  touchAction: 'none',
                }}
                aria-label={
                  isWarning
                    ? `${def.name} ${port.label} (unconnected)`
                    : `${def.name} ${port.label}`
                }
                title={
                  isWarning
                    ? `${port.label} — required, no cable connected`
                    : `${port.label} (${port.signalType})`
                }
                onPointerDown={(e) =>
                  handlePortPointerDown(p.id, port.id, resolved, e)
                }
                onPointerMove={handlePortPointerMove}
                onPointerUp={(e) => handlePortPointerUp(p.id, port.id, e)}
                onPointerCancel={handlePortPointerCancel}
                onClick={(e) => {
                  // Fallback for environments (tests, some browsers via
                  // assistive tech) that dispatch click without a pointer
                  // sequence. The pointer-up handler already fires
                  // onPortTap for normal taps, so suppress this if a
                  // drag handshake just occurred.
                  if (dragRef.current) return;
                  e.stopPropagation();
                  onPortTap?.(p.id, port.id);
                }}
              />
            );
          });
        })}
      </div>
      {/*
       * Endpoint chips render in a strip immediately above the board so they
       * stay visible regardless of board width — the prior side-anchored
       * positioning got clipped by the canvas-area's overflow in the default
       * fit-to-view. Cables still terminate at the board edge via
       * lookupConnectionEnd; the chip is just the tap target / label.
       */}
      <div
        className={styles.endpointsRow}
        style={{ top: -ENDPOINT_ROW_OFFSET, width: widthPx }}
      >
        <div className={styles.endpointsCluster}>
          {endpoints
            .filter((ep) => ep.kind === 'amp_in' || ep.kind === 'amp_fx_send')
            .map((ep) => (
              <EndpointChip
                key={ep.id}
                ep={ep}
                isSource={false}
                onTap={onEndpointTap}
              />
            ))}
        </div>
        <div className={styles.endpointsCluster}>
          {endpoints
            .filter((ep) => ep.kind === 'guitar' || ep.kind === 'amp_fx_return')
            .map((ep) => (
              <EndpointChip
                key={ep.id}
                ep={ep}
                isSource={true}
                onTap={onEndpointTap}
              />
            ))}
        </div>
      </div>
    </>
  );
}

/**
 * Pixel offset above the board where the endpoint chip row hovers. The fit
 * calculation in CanvasArea reserves matching vertical space so the row
 * stays visible at the default zoom.
 */
const ENDPOINT_ROW_OFFSET = 36;

interface EndpointChipProps {
  ep: ExternalEndpoint;
  isSource: boolean;
  onTap: ((id: string) => void) | undefined;
}

function EndpointChip({ ep, isSource, onTap }: EndpointChipProps) {
  const label = isSource ? `From ${ep.label}` : `To ${ep.label}`;
  return (
    <button
      type="button"
      className={`${styles.endpointChip} ${
        isSource ? styles.endpointSource : styles.endpointSink
      }`}
      onClick={(e) => {
        e.stopPropagation();
        onTap?.(ep.id);
      }}
      title={label}
    >
      <span className={styles.endpointDot} aria-hidden />
      <span className={styles.endpointLabel}>{label}</span>
    </button>
  );
}

interface ConnectionEnd {
  xIn: number;
  yIn: number;
  side: Side;
  signalType?: SignalType;
  /** Present only when the end is a pedal port (not an external endpoint). */
  port?: Port;
}

function lookupConnectionEnd(
  kind: 'pedal' | 'external',
  nodeId: string,
  portId: string | null,
  portIndex: Map<string, Map<string, ResolvedPort>>,
  endpointById: Map<string, ExternalEndpoint>,
  rig: Rig,
  pxPerInch: number,
): ConnectionEnd | null {
  if (kind === 'pedal') {
    if (!portId) return null;
    const resolved = portIndex.get(nodeId)?.get(portId);
    if (!resolved) return null;
    return {
      xIn: resolved.xIn,
      yIn: resolved.yIn,
      side: resolved.visualSide,
      signalType: resolved.port.signalType,
      port: resolved.port,
    };
  }
  // External endpoint — anchor at the corresponding endpoint chip in the
  // strip above the board so cables visibly continue off the board edge
  // and meet the chip. Strip y is ENDPOINT_ROW_OFFSET px above the board;
  // convert to inches via pxPerInch.
  const ep = endpointById.get(nodeId);
  if (!ep) return null;
  const stripYIn = -ENDPOINT_ROW_OFFSET / pxPerInch;
  // Left cluster contains amp_in / amp_fx_send (chips render at the left
  // edge of the strip via space-between). All other kinds cluster right.
  const isLeftCluster = ep.kind === 'amp_in' || ep.kind === 'amp_fx_send';
  const xIn = isLeftCluster ? 0.75 : rig.widthIn - 0.75;
  return { xIn, yIn: stripYIn, side: 'bottom' };
}
