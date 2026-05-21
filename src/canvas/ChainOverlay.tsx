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
  portPositionOnBoard,
  rotatedSide,
  routeCablePath,
} from '../lib/geometry';
import { colorForSignal } from '../lib/signalColors';
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
  onPortTap?: (placedId: string, portId: string) => void;
  onCableTap?: (connectionId: string) => void;
  onEndpointTap?: (endpointId: string) => void;
}

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
  onCableTap,
  onEndpointTap,
}: ChainOverlayProps) {
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

  return (
    <>
      <svg
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
          const color = colorForSignal(
            from.signalType ?? to.signalType ?? 'instrument',
          );
          const isExternal =
            c.fromNodeKind === 'external' || c.toNodeKind === 'external';
          const path = routeCablePath(
            { xIn: from.xIn, yIn: from.yIn, side: from.side },
            { xIn: to.xIn, yIn: to.yIn, side: to.side },
          );
          const d = path
            .map((p, i) =>
              i === 0
                ? `M ${p.xIn * pxPerInch} ${p.yIn * pxPerInch}`
                : `L ${p.xIn * pxPerInch} ${p.yIn * pxPerInch}`,
            )
            .join(' ');
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
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={isExternal ? '5 3' : undefined}
              />
            </g>
          );
        })}
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
                className={`${styles.portDot} ${isArmed ? styles.portDotArmed : ''} ${isWarning ? styles.portDotWarning : ''}`}
                style={{
                  left: resolved.xIn * pxPerInch,
                  top: resolved.yIn * pxPerInch,
                  background: isWarning
                    ? 'var(--warning)'
                    : colorForSignal(port.signalType),
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
                onClick={(e) => {
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
