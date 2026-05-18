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
import styles from './ChainOverlay.module.css';

interface ChainOverlayProps {
  rig: Rig;
  placed: PlacedPedal[];
  pedalsById: Map<string, Pedal>;
  connections: Connection[];
  endpoints: ExternalEndpoint[];
  pxPerInch: number;
  armedPort: { placedId: string; portId: string } | null;
  onPortTap?: (placedId: string, portId: string) => void;
  onCableTap?: (connectionId: string) => void;
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
  onPortTap,
  onCableTap,
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

  return (
    <>
      <svg
        className={styles.cableLayer}
        width={widthPx}
        height={heightPx}
        viewBox={`0 0 ${widthPx} ${heightPx}`}
        aria-hidden
      >
        {connections.map((c) => {
          const from = lookupConnectionEnd(
            c.fromNodeKind,
            c.fromNodeId,
            c.fromPortId,
            portIndex,
            endpointById,
            rig,
          );
          const to = lookupConnectionEnd(
            c.toNodeKind,
            c.toNodeId,
            c.toPortId,
            portIndex,
            endpointById,
            rig,
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
            return (
              <button
                key={`${p.id}-${port.id}`}
                type="button"
                className={`${styles.portDot} ${isArmed ? styles.portDotArmed : ''}`}
                style={{
                  left: resolved.xIn * pxPerInch,
                  top: resolved.yIn * pxPerInch,
                  background: colorForSignal(port.signalType),
                  touchAction: 'none',
                }}
                aria-label={`${def.name} ${port.label}`}
                title={`${port.label} (${port.signalType})`}
                onClick={(e) => {
                  e.stopPropagation();
                  onPortTap?.(p.id, port.id);
                }}
              />
            );
          });
        })}
      </div>
    </>
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
  // External endpoint — anchor near the right edge for sources (guitar/fx_return)
  // and the left edge for sinks (amp_in, amp_fx_send). Placed half an inch outside
  // the board so the cable visibly runs off the edge.
  const ep = endpointById.get(nodeId);
  if (!ep) return null;
  const offset = 0.5;
  switch (ep.kind) {
    case 'guitar':
      return { xIn: rig.widthIn + offset, yIn: rig.depthIn / 2, side: 'left' };
    case 'amp_in':
      return { xIn: -offset, yIn: rig.depthIn / 2, side: 'right' };
    case 'amp_fx_send':
      return { xIn: -offset, yIn: rig.depthIn / 4, side: 'right' };
    case 'amp_fx_return':
      return {
        xIn: -offset,
        yIn: (rig.depthIn * 3) / 4,
        side: 'right',
      };
    default:
      return { xIn: rig.widthIn + offset, yIn: rig.depthIn / 2, side: 'left' };
  }
}
