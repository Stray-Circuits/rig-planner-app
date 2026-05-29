import { useLayoutEffect, useRef, useState } from 'react';
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
  pathLanes,
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
  onEndpointTap?: (endpointId: string) => void;
}

/** Base perpendicular leader length (inches) before any lane offset. */
const LEADER_BASE_IN = 0.4;
/**
 * Per-lane increment added to the leader length so cables touching the
 * same pedal-side stack on parallel Y lanes. At default zoom (~50px/in)
 * each lane is ~6px apart — visibly distinct from the 2.5px cable
 * stroke while keeping leader extensions modest.
 */
const LEADER_LANE_STEP_IN = 0.12;

/**
 * Assign a lane index to each cable end relative to the other cable
 * ends touching the same (placedId, visual side). Lanes are ordered by
 * the port's physical position along the side (left-to-right or
 * top-to-bottom); cables sharing the same port get sequential lanes via
 * stable cable-id tiebreak so their final 90° turn into the shared
 * destination happens at different Y values.
 *
 * Returns a map keyed by `${connectionId}:${end}` (end is 'from'|'to').
 */
function computeLeaderLanes(
  connections: readonly Connection[],
  portIndex: Map<string, Map<string, ResolvedPort>>,
  pedalsById: Map<string, Pedal>,
): Map<string, number> {
  const result = new Map<string, number>();
  interface SideMember {
    connectionId: string;
    end: 'from' | 'to';
    portAxisCoord: number; // x for top/bottom, y for left/right
  }
  const groups = new Map<string, SideMember[]>();
  const collect = (
    connectionId: string,
    end: 'from' | 'to',
    nodeKind: 'pedal' | 'external',
    nodeId: string,
    portId: string | null,
  ) => {
    if (nodeKind !== 'pedal' || !portId) return;
    const resolved = portIndex.get(nodeId)?.get(portId);
    if (!resolved) return;
    // Don't bother looking up the pedal twice — we already have the
    // resolved port + its visual side.
    const def = pedalsById.get(resolved.placed.pedalId);
    if (!def) return;
    const side = resolved.visualSide;
    const key = `${nodeId}:${side}`;
    const axisCoord =
      side === 'top' || side === 'bottom' ? resolved.xIn : resolved.yIn;
    const list = groups.get(key) ?? [];
    list.push({ connectionId, end, portAxisCoord: axisCoord });
    groups.set(key, list);
  };
  for (const c of connections) {
    collect(c.id, 'from', c.fromNodeKind, c.fromNodeId, c.fromPortId);
    collect(c.id, 'to', c.toNodeKind, c.toNodeId, c.toPortId);
  }
  for (const members of groups.values()) {
    members.sort((a, b) => {
      if (a.portAxisCoord !== b.portAxisCoord) {
        return a.portAxisCoord - b.portAxisCoord;
      }
      // Same port → tiebreak by connection id for a stable order.
      return a.connectionId.localeCompare(b.connectionId);
    });
    members.forEach((m, idx) => {
      result.set(`${m.connectionId}:${m.end}`, idx);
    });
  }
  return result;
}

/**
 * Two segments count as living in the same lane when their axis values
 * are within this many inches AND their perpendicular-range overlaps.
 * Picked so cables that visually crowd each other (within ~4x cable
 * stroke width at default zoom) get pulled apart. Wider than the
 * route-time LANE_TOL so render-time offset catches what the router
 * couldn't separate.
 */
const LANE_RENDER_TOL_IN = 0.35;
/**
 * Perpendicular nudge per cable slot. With a 2-cable group, this is the
 * full gap between the two cables (~10px at default zoom 50 px/in,
 * ~4x cable stroke width — comfortably distinct).
 */
const LANE_RENDER_SHIFT_IN = 0.2;

interface RoutedCable {
  path: { xIn: number; yIn: number }[];
}

/**
 * Post-processing pass: when two cables end up on near-identical
 * Y-lanes (horizontal segments) or X-lanes (vertical segments) with
 * overlapping ranges, nudge each one perpendicular by a small amount
 * so they render as visually distinct lines instead of stacking.
 *
 * Mutates the path arrays. Skips the leader segments (path[0]->path[1]
 * and path[N-2]->path[N-1]) so the cable still terminates exactly at
 * the port endpoints — only the inner crossbar shifts.
 */
interface SegRef {
  cableIdx: number;
  segIdx: number;
  lo: number; // start of segment along the lane axis
  hi: number;
  axisValue: number; // y for horizontal, x for vertical
}

function applyLaneRenderOffsets(cables: RoutedCable[]): void {
  // Collect all eligible inner segments (skipping leaders).
  const hSegs: SegRef[] = [];
  const vSegs: SegRef[] = [];
  for (let cableIdx = 0; cableIdx < cables.length; cableIdx++) {
    const path = cables[cableIdx]!.path;
    if (path.length < 4) continue; // need at least port + leader endpoints
    for (let i = 1; i < path.length - 2; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const dx = Math.abs(b.xIn - a.xIn);
      const dy = Math.abs(b.yIn - a.yIn);
      if (dy < 0.001 && dx > 0.3) {
        hSegs.push({
          cableIdx,
          segIdx: i,
          lo: Math.min(a.xIn, b.xIn),
          hi: Math.max(a.xIn, b.xIn),
          axisValue: a.yIn,
        });
      } else if (dx < 0.001 && dy > 0.3) {
        vSegs.push({
          cableIdx,
          segIdx: i,
          lo: Math.min(a.yIn, b.yIn),
          hi: Math.max(a.yIn, b.yIn),
          axisValue: a.xIn,
        });
      }
    }
  }
  // Union-find grouping: two segments belong to the same lane group iff
  // their axis values are within LANE_RENDER_TOL_IN AND their lengthwise
  // ranges overlap. Pair-wise pass — N is small (one segment per cable
  // per axis at most a few times), so O(N²) is fine.
  const segShiftY = new Map<string, number>();
  const segShiftX = new Map<string, number>();
  const processGroup = (
    segs: SegRef[],
    shiftMap: Map<string, number>,
  ): void => {
    if (segs.length < 2) return;
    const parent: number[] = segs.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]!]!;
        i = parent[i]!;
      }
      return i;
    };
    const union = (a: number, b: number): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const a = segs[i]!;
        const b = segs[j]!;
        if (Math.abs(a.axisValue - b.axisValue) >= LANE_RENDER_TOL_IN) continue;
        if (a.lo >= b.hi - 0.05 || a.hi <= b.lo + 0.05) continue;
        union(i, j);
      }
    }
    // Bucket members by root.
    const groups = new Map<number, number[]>();
    for (let i = 0; i < segs.length; i++) {
      const root = find(i);
      const arr = groups.get(root) ?? [];
      arr.push(i);
      groups.set(root, arr);
    }
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      members.sort((a, b) => segs[a]!.axisValue - segs[b]!.axisValue);
      const center = (members.length - 1) / 2;
      for (let k = 0; k < members.length; k++) {
        const seg = segs[members[k]!]!;
        shiftMap.set(
          `${seg.cableIdx}:${seg.segIdx}`,
          (k - center) * LANE_RENDER_SHIFT_IN,
        );
      }
    }
  };
  processGroup(hSegs, segShiftY);
  processGroup(vSegs, segShiftX);
  // Apply shifts to path points. Shift BOTH endpoints of each affected
  // segment so the segment itself moves; the connecting (perpendicular)
  // segments stretch slightly to follow, which is fine.
  for (let cableIdx = 0; cableIdx < cables.length; cableIdx++) {
    const path = cables[cableIdx]!.path;
    for (let i = 1; i < path.length - 2; i++) {
      const shiftY = segShiftY.get(`${cableIdx}:${i}`);
      if (shiftY !== undefined) {
        path[i] = { xIn: path[i]!.xIn, yIn: path[i]!.yIn + shiftY };
        path[i + 1] = {
          xIn: path[i + 1]!.xIn,
          yIn: path[i + 1]!.yIn + shiftY,
        };
      }
      const shiftX = segShiftX.get(`${cableIdx}:${i}`);
      if (shiftX !== undefined) {
        path[i] = { xIn: path[i]!.xIn + shiftX, yIn: path[i]!.yIn };
        path[i + 1] = {
          xIn: path[i + 1]!.xIn + shiftX,
          yIn: path[i + 1]!.yIn,
        };
      }
    }
  }
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
  onEndpointTap,
}: ChainOverlayProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Measured chip positions (board-px) — the chip strip uses flex so each
  // chip takes its natural width; we read the rendered position after
  // layout and use it as the cable termination point for that endpoint.
  // Falls back to a per-cluster default on the first render (before the
  // measurement effect fires).
  const chipRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [chipCenters, setChipCenters] = useState<
    Map<string, { x: number; bottomY: number }>
  >(new Map());
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

  // Read each chip's actual rendered bbox after layout and convert to
  // board-local px coords. Runs when endpoints, scale, or board size
  // changes; the `changed` check prevents state-update loops.
  useLayoutEffect(() => {
    const svgRect = svgRef.current?.getBoundingClientRect();
    if (!svgRect) return;
    const next = new Map<string, { x: number; bottomY: number }>();
    for (const [id, btn] of chipRefs.current) {
      if (!btn.isConnected) continue;
      const r = btn.getBoundingClientRect();
      next.set(id, {
        x: r.left + r.width / 2 - svgRect.left,
        bottomY: r.bottom - svgRect.top,
      });
    }
    let changed = next.size !== chipCenters.size;
    if (!changed) {
      for (const [id, pos] of next) {
        const prev = chipCenters.get(id);
        if (
          !prev ||
          Math.abs(prev.x - pos.x) > 0.5 ||
          Math.abs(prev.bottomY - pos.bottomY) > 0.5
        ) {
          changed = true;
          break;
        }
      }
    }
    if (changed) setChipCenters(next);
  }, [endpoints, pxPerInch, widthPx, heightPx, chipCenters]);

  // Pre-route every cable in render order so each successive cable can
  // see which Y/X lanes prior cables took, biasing the router toward
  // unclaimed lanes (cable-vs-cable visual separation). All pedals are
  // obstacles; the leader segment provides the only clearance for the
  // port the cable plugs into.
  const allObstacles: ObstacleRect[] = [];
  for (const rect of obstacleByPlaced.values()) {
    allObstacles.push(rect);
  }
  // Assign each cable-END (from / to) a "leader lane" index relative to
  // the other cables touching the same (placed pedal, visual side). The
  // lane index inflates the perpendicular leader length, so cables
  // exiting/entering the same pedal-side stack on parallel Y lanes
  // outside the pedal rather than sharing a single lane.
  //
  // Cables sharing a destination port get *different* lane indices via
  // the cable-id tiebreak below, so their final 90° turn into the port
  // happens at a different Y per cable — only the port itself is shared.
  const leaderLanes = computeLeaderLanes(
    orderedConnections,
    portIndex,
    pedalsById,
  );
  const claimedY: number[] = [];
  const claimedX: number[] = [];
  const routedCables = orderedConnections
    .map((c) => {
      const from = lookupConnectionEnd(
        c.fromNodeKind,
        c.fromNodeId,
        c.fromPortId,
        portIndex,
        endpointById,
        chipCenters,
        rig,
        pxPerInch,
      );
      const to = lookupConnectionEnd(
        c.toNodeKind,
        c.toNodeId,
        c.toPortId,
        portIndex,
        endpointById,
        chipCenters,
        rig,
        pxPerInch,
      );
      if (!from || !to) return null;
      const fromColor = from.port
        ? colorForPort(from.port)
        : colorForSignal(from.signalType ?? 'instrument');
      const toColor = to.port
        ? colorForPort(to.port)
        : colorForSignal(to.signalType ?? 'instrument');
      const cableColor = fromColor;
      const isExternal =
        c.fromNodeKind === 'external' || c.toNodeKind === 'external';
      const fromLaneIdx = leaderLanes.get(`${c.id}:from`) ?? 0;
      const toLaneIdx = leaderLanes.get(`${c.id}:to`) ?? 0;
      const path = routeCableWithLeader(
        { xIn: from.xIn, yIn: from.yIn, side: from.side },
        { xIn: to.xIn, yIn: to.yIn, side: to.side },
        allObstacles,
        {
          claimedY,
          claimedX,
          fromLeaderIn: LEADER_BASE_IN + fromLaneIdx * LEADER_LANE_STEP_IN,
          toLeaderIn: LEADER_BASE_IN + toLaneIdx * LEADER_LANE_STEP_IN,
          boardWidthIn: rig.widthIn,
          boardDepthIn: rig.depthIn,
        },
      );
      // Claim this cable's primary lanes so later cables route around.
      const lanes = pathLanes(path);
      for (const y of lanes.horizontalY) claimedY.push(y);
      for (const x of lanes.verticalX) claimedX.push(x);
      return { c, from, to, path, cableColor, fromColor, toColor, isExternal };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Render-time fan-out for cables that share a lane: nudge each one's
  // horizontal/vertical segment perpendicular by a small amount so two
  // cables that *had* to route at very close y/x values render as two
  // distinct lines instead of looking like one stacked stroke. Pure
  // visual offset — leaves the underlying path geometry intact for the
  // claimed-lane and routing logic above.
  applyLaneRenderOffsets(routedCables);

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
        {routedCables.map(
          ({
            c,
            from,
            to,
            path,
            cableColor,
            fromColor,
            toColor,
            isExternal,
          }) => {
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
          },
        )}
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
              <div
                key={`${p.id}-${port.id}`}
                className={`${styles.portDot} ${isArmed ? styles.portDotArmed : ''} ${isWarning ? styles.portDotWarning : ''}`}
                style={{
                  left: resolved.xIn * pxPerInch,
                  top: resolved.yIn * pxPerInch,
                  background: isWarning ? 'var(--warning)' : colorForPort(port),
                }}
                aria-hidden
                title={
                  isWarning
                    ? `${port.label} — required, no cable connected`
                    : `${port.label} (${port.signalType})`
                }
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
                registerRef={(el) => {
                  if (el) chipRefs.current.set(ep.id, el);
                  else chipRefs.current.delete(ep.id);
                }}
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
                registerRef={(el) => {
                  if (el) chipRefs.current.set(ep.id, el);
                  else chipRefs.current.delete(ep.id);
                }}
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

/**
 * Approximate pixel offset above the board of the chip's BOTTOM edge —
 * = strip top (`-ENDPOINT_ROW_OFFSET`) + chip height (~22px from 11px
 * font + 6px*2 vertical padding + 0.5px border). Cables terminating at
 * an external endpoint anchor at this y so the end-cap sits flush with
 * the chip's underside, matching where a real jack would plug in. If
 * the chip CSS in ChainOverlay.module.css changes, retune this.
 */
const ENDPOINT_CHIP_BOTTOM_PX = ENDPOINT_ROW_OFFSET - 23;

interface EndpointChipProps {
  ep: ExternalEndpoint;
  isSource: boolean;
  onTap: ((id: string) => void) | undefined;
  registerRef: (el: HTMLButtonElement | null) => void;
}

function EndpointChip({ ep, isSource, onTap, registerRef }: EndpointChipProps) {
  const label = isSource ? `From ${ep.label}` : `To ${ep.label}`;
  return (
    <button
      ref={registerRef}
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
  chipCenters: Map<string, { x: number; bottomY: number }>,
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
  // External endpoint — anchor at the actual rendered chip. The chip
  // strip is flex-laid-out, so chip widths depend on label text; we
  // measure each chip's bbox after layout (chipCenters) and terminate
  // the cable at its center-bottom. Without per-chip measurement,
  // multiple chips in one cluster collapse to a single cable anchor.
  //
  // First-render fallback (before useLayoutEffect runs): anchor near
  // the cluster edge so a cable still draws.
  const ep = endpointById.get(nodeId);
  if (!ep) return null;
  const measured = chipCenters.get(nodeId);
  if (measured) {
    return {
      xIn: measured.x / pxPerInch,
      yIn: measured.bottomY / pxPerInch,
      side: 'bottom',
    };
  }
  const yIn = -ENDPOINT_CHIP_BOTTOM_PX / pxPerInch;
  const isLeftCluster = ep.kind === 'amp_in' || ep.kind === 'amp_fx_send';
  const xIn = isLeftCluster ? 0.75 : rig.widthIn - 0.75;
  return { xIn, yIn, side: 'bottom' };
}
