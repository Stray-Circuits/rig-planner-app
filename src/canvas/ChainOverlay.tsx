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
import {
  colorForPort,
  colorForSignal,
  STEREO_STRAND_COLORS,
} from '../lib/signalColors';
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
  /** Currently-armed external endpoint chip, if any. Renders highlighted. */
  armedEndpointId?: string | null;
  /** Set of "${placedId}:${portId}" keys to render as warnings. */
  unconnectedRequired: Set<string>;
  onEndpointTap?: (endpointId: string) => void;
}

/** Base perpendicular leader length (inches) before any lane offset. */
const LEADER_BASE_IN = 0.4;
/**
 * Stereo cables render as two parallel strands offset perpendicular to
 * the routed path. Half-gap between strand centerlines, in inches.
 * At default zoom (~50px/in) this is ~4.5px centre-to-centre, leaving
 * ~2px of background showing between the two 2.2px strokes — closer
 * and chunkier than the first pass so the cable reads as one solid
 * stereo pair rather than two faint lines.
 */
const STEREO_STRAND_OFFSET_IN = 0.045;
/** Stroke width per stereo strand. Tighter than the mono 2.5px but
 *  the pair together carries more visual weight. */
const STEREO_STRAND_WIDTH_PX = 2.2;
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
 * Stereo channel role assigned to each cable for rendering purposes.
 * 'stereo' marks a true TRS↔TRS cable carrying L+R on one conductor
 * pair; 'L' / 'R' mark each leg of a Y-split off a stereo TRS port.
 */
type CableChannel = 'stereo' | 'L' | 'R';

function computeCableChannels(
  connections: readonly Connection[],
  portIndex: Map<string, Map<string, ResolvedPort>>,
): Map<string, CableChannel> {
  const out = new Map<string, CableChannel>();
  // Cables that touch a stereo TRS port but couldn't be tagged by an
  // explicit L/R role on the OTHER end. Keyed by `${placedId}:${portId}`
  // of the stereo end → list of connection ids in declaration order.
  // Sorted + assigned L/R after the first pass.
  const pendingByStereoPort = new Map<string, string[]>();

  const portFor = (
    nodeKind: 'pedal' | 'external',
    nodeId: string,
    portId: string | null,
  ): Port | null => {
    if (nodeKind !== 'pedal' || !portId) return null;
    return portIndex.get(nodeId)?.get(portId)?.port ?? null;
  };

  const channelFromRole = (port: Port | null): 'L' | 'R' | null => {
    if (!port) return null;
    if (port.role === 'input_l' || port.role === 'output_l') return 'L';
    if (port.role === 'input_r' || port.role === 'output_r') return 'R';
    return null;
  };

  // Pass 1: cables that directly touch a stereo TRS port.
  for (const c of connections) {
    const fromPort = portFor(c.fromNodeKind, c.fromNodeId, c.fromPortId);
    const toPort = portFor(c.toNodeKind, c.toNodeId, c.toPortId);
    const fromStereo = fromPort?.signalType === 'stereo';
    const toStereo = toPort?.signalType === 'stereo';
    if (fromStereo && toStereo) {
      out.set(c.id, 'stereo');
      continue;
    }
    if (!fromStereo && !toStereo) continue;
    // Exactly one end is stereo — figure out which channel this leg
    // carries. Prefer an explicit L/R role on the other end; fall back
    // to deferred per-port indexing.
    const otherChannel = channelFromRole(fromStereo ? toPort : fromPort);
    if (otherChannel) {
      out.set(c.id, otherChannel);
      continue;
    }
    const stereoKey = fromStereo
      ? `${c.fromNodeId}:${c.fromPortId}`
      : `${c.toNodeId}:${c.toPortId}`;
    const arr = pendingByStereoPort.get(stereoKey) ?? [];
    arr.push(c.id);
    pendingByStereoPort.set(stereoKey, arr);
  }
  for (const ids of pendingByStereoPort.values()) {
    // Stable order by connection id so the L/R assignment doesn't
    // shuffle as unrelated cables are added/removed elsewhere.
    ids.sort();
    ids.forEach((id, idx) => {
      out.set(id, idx === 0 ? 'L' : 'R');
    });
  }

  // Pass 2: cables anchored to an explicit L/R port role anywhere in
  // the chain (e.g. an output_r feeding the next pedal's input_r).
  for (const c of connections) {
    if (out.has(c.id)) continue;
    const fromPort = portFor(c.fromNodeKind, c.fromNodeId, c.fromPortId);
    const toPort = portFor(c.toNodeKind, c.toNodeId, c.toPortId);
    const ch = channelFromRole(fromPort) ?? channelFromRole(toPort);
    if (ch) out.set(c.id, ch);
  }

  // Pass 3: propagate channel through pedals. A mono pedal that
  // receives a single-channel signal on its input should send that
  // same channel out — so a left-leg Y-split feeding into a tube
  // screamer keeps the left color all the way to whatever the tube
  // screamer feeds next. Iterate until stable; bail out at a
  // generous cap in case the graph is more tangled than expected.
  const inbound = new Map<string, string[]>();
  const outbound = new Map<string, string[]>();
  for (const c of connections) {
    if (c.toNodeKind === 'pedal') {
      const arr = inbound.get(c.toNodeId) ?? [];
      arr.push(c.id);
      inbound.set(c.toNodeId, arr);
    }
    if (c.fromNodeKind === 'pedal') {
      const arr = outbound.get(c.fromNodeId) ?? [];
      arr.push(c.id);
      outbound.set(c.fromNodeId, arr);
    }
  }
  const connectionsById = new Map(connections.map((c) => [c.id, c]));
  const ITERATION_CAP = 32;
  for (let iter = 0; iter < ITERATION_CAP; iter++) {
    let changed = false;
    for (const [placedId, inIds] of inbound) {
      // Dominant inbound channel: every channeled inbound cable agrees,
      // OR there's one inbound cable and it has a channel. Mixed L+R
      // means the pedal sums to mono → no propagation.
      let dominant: 'L' | 'R' | null = null;
      let mixed = false;
      for (const cid of inIds) {
        const ch = out.get(cid);
        if (ch === 'L' || ch === 'R') {
          if (dominant === null) dominant = ch;
          else if (dominant !== ch) {
            mixed = true;
            break;
          }
        }
      }
      if (mixed || dominant === null) continue;
      const outIds = outbound.get(placedId) ?? [];
      for (const cid of outIds) {
        if (out.has(cid)) continue;
        const conn = connectionsById.get(cid);
        if (!conn) continue;
        const fromPort = portFor(
          conn.fromNodeKind,
          conn.fromNodeId,
          conn.fromPortId,
        );
        // Skip stereo TRS source outputs — those are handled in pass 1
        // and shouldn't be overwritten with a single-channel tag.
        if (fromPort?.signalType === 'stereo') continue;
        out.set(cid, dominant);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return out;
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
 * Miter-offset a polyline perpendicular to its direction of travel.
 * Used to draw stereo cables as two parallel strands. Offsets each
 * vertex along its bisector with the standard miter formula so 90°
 * corners preserve the offset distance on both adjacent segments.
 *
 * `offsetIn` is the perpendicular displacement (positive = "left" of
 * travel direction); pass the negation for the other strand.
 */
function offsetPolyline(
  path: readonly { xIn: number; yIn: number }[],
  offsetIn: number,
): { xIn: number; yIn: number }[] {
  if (path.length < 2) return path.map((p) => ({ xIn: p.xIn, yIn: p.yIn }));
  const perp = (
    a: { xIn: number; yIn: number },
    b: { xIn: number; yIn: number },
  ) => {
    const dx = b.xIn - a.xIn;
    const dy = b.yIn - a.yIn;
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  };
  const result: { xIn: number; yIn: number }[] = [];
  for (let i = 0; i < path.length; i++) {
    const before = i > 0 ? perp(path[i - 1]!, path[i]!) : null;
    const after = i < path.length - 1 ? perp(path[i]!, path[i + 1]!) : null;
    let nx: number;
    let ny: number;
    if (before && after) {
      const sx = before.x + after.x;
      const sy = before.y + after.y;
      const denom = 1 + before.x * after.x + before.y * after.y;
      if (Math.abs(denom) < 1e-6) {
        nx = before.x;
        ny = before.y;
      } else {
        nx = sx / denom;
        ny = sy / denom;
      }
    } else if (before) {
      nx = before.x;
      ny = before.y;
    } else {
      nx = after!.x;
      ny = after!.y;
    }
    result.push({
      xIn: path[i]!.xIn + nx * offsetIn,
      yIn: path[i]!.yIn + ny * offsetIn,
    });
  }
  return result;
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

/**
 * Largest absolute perpendicular shift the fan-out is allowed to
 * apply to a single segment when an obstacle is nearby. Picked to be
 * smaller than the router's `obstacleMarginIn` (0.3") so even a
 * shift clamped to this magnitude can't push a cable through a
 * pedal that the router was hugging.
 */
const LANE_RENDER_SHIFT_MAX_NEAR_OBSTACLE_IN = 0.05;

function segmentHitsObstacle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  obstacles: readonly ObstacleRect[],
): boolean {
  const eps = 0.05;
  const minX = Math.min(ax, bx);
  const maxX = Math.max(ax, bx);
  const minY = Math.min(ay, by);
  const maxY = Math.max(ay, by);
  for (const r of obstacles) {
    if (
      maxX > r.xIn + eps &&
      minX < r.xIn + r.widthIn - eps &&
      maxY > r.yIn + eps &&
      minY < r.yIn + r.depthIn - eps
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Largest |shift| in [0, requested] that keeps the post-shift segment
 * clear of every obstacle. Bisect-searches the safe range so we still
 * get *some* visual separation when a full shift would push the cable
 * into a pedal. Returns 0 if even a tiny shift is unsafe (which
 * shouldn't happen — the unshifted segment was clean before this ran).
 */
function safeShiftForSegment(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  requestedShift: number,
  axis: 'x' | 'y',
  obstacles: readonly ObstacleRect[],
): number {
  if (requestedShift === 0) return 0;
  const tryShift = (s: number): boolean => {
    const dxOff = axis === 'x' ? s : 0;
    const dyOff = axis === 'y' ? s : 0;
    return !segmentHitsObstacle(
      ax + dxOff,
      ay + dyOff,
      bx + dxOff,
      by + dyOff,
      obstacles,
    );
  };
  if (tryShift(requestedShift)) return requestedShift;
  // Bisect down toward zero to find the largest safe magnitude.
  let lo = 0;
  let hi = requestedShift;
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2;
    if (tryShift(mid)) lo = mid;
    else hi = mid;
  }
  // Don't return a tiny shift that won't visibly separate but might
  // still graze; if it's smaller than the "near obstacle" cap return 0.
  if (Math.abs(lo) < 0.02) return 0;
  return (
    Math.sign(requestedShift) *
    Math.min(Math.abs(lo), LANE_RENDER_SHIFT_MAX_NEAR_OBSTACLE_IN)
  );
}

function applyLaneRenderOffsets(
  cables: RoutedCable[],
  obstacles: readonly ObstacleRect[],
): void {
  // Collect all eligible inner segments. Skip not just the leader
  // segments (path[0]→path[1] and path[n-2]→path[n-1]) but also the
  // segments TOUCHING the leader-tip vertices (path[1]→path[2] and
  // path[n-3]→path[n-2]). Shifting a leader-adjacent segment moves
  // the leader-tip with it, which tilts the leader off-axis and can
  // drag it through the pedal it's supposed to plug into. Leader
  // length staggering (`computeLeaderLanes`) already keeps cables
  // exiting the same pedal-side on different lanes, so giving up
  // fan-out for those segments costs little.
  const hSegs: SegRef[] = [];
  const vSegs: SegRef[] = [];
  for (let cableIdx = 0; cableIdx < cables.length; cableIdx++) {
    const path = cables[cableIdx]!.path;
    if (path.length < 6) continue; // need >= 2 non-leader-adjacent verts
    for (let i = 2; i < path.length - 3; i++) {
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
  // Apply shifts to path points, BUT clamp each shift to the largest
  // magnitude that keeps the post-shift segment clear of pedals.
  // Without this, dense lane groups (several cables stacked on one
  // y-axis or x-axis) get spread by up to 0.5"+, which used to push
  // cables straight through neighbouring pedals — the actual bug
  // behind the "cables on top of pedals" reports in #41.
  for (let cableIdx = 0; cableIdx < cables.length; cableIdx++) {
    const path = cables[cableIdx]!.path;
    // Mirror the collection loop's bounds — only segments collected
    // above are eligible to shift.
    for (let i = 2; i < path.length - 3; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const requestedY = segShiftY.get(`${cableIdx}:${i}`);
      if (requestedY !== undefined && requestedY !== 0) {
        const safe = safeShiftForSegment(
          a.xIn,
          a.yIn,
          b.xIn,
          b.yIn,
          requestedY,
          'y',
          obstacles,
        );
        if (safe !== 0) {
          path[i] = { xIn: a.xIn, yIn: a.yIn + safe };
          path[i + 1] = { xIn: b.xIn, yIn: b.yIn + safe };
        }
      }
      const requestedX = segShiftX.get(`${cableIdx}:${i}`);
      if (requestedX !== undefined && requestedX !== 0) {
        const a2 = path[i]!;
        const b2 = path[i + 1]!;
        const safe = safeShiftForSegment(
          a2.xIn,
          a2.yIn,
          b2.xIn,
          b2.yIn,
          requestedX,
          'x',
          obstacles,
        );
        if (safe !== 0) {
          path[i] = { xIn: a2.xIn + safe, yIn: a2.yIn };
          path[i + 1] = { xIn: b2.xIn + safe, yIn: b2.yIn };
        }
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
  armedEndpointId = null,
  unconnectedRequired,
  onEndpointTap,
}: ChainOverlayProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Measured tip positions (board-px) — each chip ends in a plug-tip dot;
  // we read the rendered tip center after layout and use it as the cable
  // termination point for that endpoint. Falls back to a per-cluster
  // default on the first render (before the measurement effect fires).
  const tipRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [tipCenters, setTipCenters] = useState<
    Map<string, { x: number; y: number }>
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
    const next = new Map<string, { x: number; y: number }>();
    for (const [id, tip] of tipRefs.current) {
      if (!tip.isConnected) continue;
      const r = tip.getBoundingClientRect();
      next.set(id, {
        x: r.left + r.width / 2 - svgRect.left,
        y: r.top + r.height / 2 - svgRect.top,
      });
    }
    let changed = next.size !== tipCenters.size;
    if (!changed) {
      for (const [id, pos] of next) {
        const prev = tipCenters.get(id);
        if (
          !prev ||
          Math.abs(prev.x - pos.x) > 0.5 ||
          Math.abs(prev.y - pos.y) > 0.5
        ) {
          changed = true;
          break;
        }
      }
    }
    if (changed) setTipCenters(next);
  }, [endpoints, pxPerInch, widthPx, heightPx, tipCenters]);

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
  // Assign each cable a stereo channel role. Drives the cable color:
  //   'stereo' → render as parallel L+R strands (true TRS↔TRS cable)
  //   'L' / 'R' → single strand in that channel's color (Y-split leg
  //               from a stereo TRS port to a mono TS)
  //   null     → not a stereo cable; use the normal signal color
  // For Y-splits we prefer an explicit input_l/output_l/_r role on the
  // mono end when present; otherwise we sort the cables on the stereo
  // TRS port by id and assign the first one L, the second R. That
  // works for the common case where the user wires two generic mono
  // inputs and never tagged them L/R.
  const cableChannel = computeCableChannels(orderedConnections, portIndex);
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
        tipCenters,
        rig,
        pxPerInch,
      );
      const to = lookupConnectionEnd(
        c.toNodeKind,
        c.toNodeId,
        c.toPortId,
        portIndex,
        endpointById,
        tipCenters,
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
      const isExternal =
        c.fromNodeKind === 'external' || c.toNodeKind === 'external';
      const channel = cableChannel.get(c.id) ?? null;
      const isStereo = channel === 'stereo';
      // Y-split legs (channel = 'L' / 'R') pick up the matching strand
      // color so two cables off the same TRS port read as left + right
      // even when both destination ports are generic mono inputs.
      const cableColor =
        channel === 'R'
          ? STEREO_STRAND_COLORS[1]
          : channel === 'L'
            ? STEREO_STRAND_COLORS[0]
            : fromColor;
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
      return {
        c,
        from,
        to,
        path,
        cableColor,
        fromColor,
        toColor,
        isExternal,
        isStereo,
        channel,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // Render-time fan-out for cables that share a lane: nudge each one's
  // horizontal/vertical segment perpendicular by a small amount so two
  // cables that *had* to route at very close y/x values render as two
  // distinct lines instead of looking like one stacked stroke. Pure
  // visual offset — leaves the underlying path geometry intact for the
  // claimed-lane and routing logic above.
  applyLaneRenderOffsets(routedCables, allObstacles);

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
            isStereo,
            channel,
          }) => {
            const toD = (pts: readonly { xIn: number; yIn: number }[]) =>
              pts
                .map((p, i) => {
                  const cmd = i === 0 ? 'M' : 'L';
                  return `${cmd} ${p.xIn * pxPerInch} ${p.yIn * pxPerInch}`;
                })
                .join(' ');
            const fromCx = from.xIn * pxPerInch;
            const fromCy = from.yIn * pxPerInch;
            const toCx = to.xIn * pxPerInch;
            const toCy = to.yIn * pxPerInch;
            // Stereo cables render as two parallel strands so they read
            // as two conductors at a glance. Each strand is a thinner
            // stroke than the mono 2.5px line; together they cover the
            // same visual weight while encoding the physical reality.
            // The two strands are colored L (green) + R (vermillion)
            // from STEREO_STRAND_COLORS so the cable carries the same
            // channel cues as a pair of mono Y-split cables would.
            const dashArray = isExternal ? '5 3' : undefined;
            // TRS↔TRS (isStereo) renders both L and R on one cable
            // path. Y-split legs (channel = 'L' / 'R' AND directly
            // touching a stereo TRS port) render as a single strand
            // offset to the matching side so the two legs emerge from
            // the shared TRS port in parallel rather than overlapping.
            // Cables that picked up L/R via downstream propagation
            // (mono pedal carrying a channeled signal forward) get the
            // matching color but stay centered — no companion strand
            // to pair with along their own routing.
            const touchesStereoTRS =
              from.port?.signalType === 'stereo' ||
              to.port?.signalType === 'stereo';
            const offsetSign = channel === 'L' ? +1 : channel === 'R' ? -1 : 0;
            const channelColor =
              channel === 'L'
                ? STEREO_STRAND_COLORS[0]
                : channel === 'R'
                  ? STEREO_STRAND_COLORS[1]
                  : cableColor;
            const strands: {
              path: { xIn: number; yIn: number }[];
              color: string;
            }[] = isStereo
              ? [
                  {
                    path: offsetPolyline(path, STEREO_STRAND_OFFSET_IN),
                    color: STEREO_STRAND_COLORS[0],
                  },
                  {
                    path: offsetPolyline(path, -STEREO_STRAND_OFFSET_IN),
                    color: STEREO_STRAND_COLORS[1],
                  },
                ]
              : offsetSign !== 0 && touchesStereoTRS
                ? [
                    {
                      path: offsetPolyline(
                        path,
                        offsetSign * STEREO_STRAND_OFFSET_IN,
                      ),
                      color: channelColor,
                    },
                  ]
                : [{ path, color: channelColor }];
            // Stereo strand width applies to TRS↔TRS strands and to
            // Y-split legs paired at the TRS port. Propagated mono
            // cables keep the normal 2.5px so they don't look weirdly
            // thinner than their neighbours mid-chain.
            const strandWidth =
              isStereo || (touchesStereoTRS && offsetSign !== 0)
                ? STEREO_STRAND_WIDTH_PX
                : 2.5;
            return (
              <g key={c.id}>
                {strands.map((strand, i) => (
                  <path
                    key={i}
                    d={toD(strand.path)}
                    fill="none"
                    stroke={strand.color}
                    strokeWidth={strandWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={dashArray}
                  />
                ))}
                {/* End-caps: colored dots at each pedal port. Slightly
                  larger than the cable stroke so the connection visibly
                  "plugs into" the pedal edge. External endpoints render
                  their own jack-tip dot, so suppress the SVG cap there
                  to avoid a doubled / misaligned terminus. */}
                {c.fromNodeKind === 'pedal' ? (
                  <circle
                    cx={fromCx}
                    cy={fromCy}
                    r={4}
                    fill={
                      from.port?.signalType === 'stereo'
                        ? fromColor
                        : channelColor
                    }
                    stroke="rgba(255,255,255,0.9)"
                    strokeWidth={1}
                  />
                ) : null}
                {c.toNodeKind === 'pedal' ? (
                  <circle
                    cx={toCx}
                    cy={toCy}
                    r={4}
                    fill={
                      to.port?.signalType === 'stereo' ? toColor : channelColor
                    }
                    stroke="rgba(255,255,255,0.9)"
                    strokeWidth={1}
                  />
                ) : null}
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
        style={{ width: widthPx }}
        data-chip-strip
      >
        <div className={styles.endpointsCluster}>
          {endpoints
            .filter((ep) => ep.kind === 'amp_in' || ep.kind === 'amp_fx_return')
            .map((ep) => (
              <EndpointChip
                key={ep.id}
                ep={ep}
                isSource={false}
                isArmed={armedEndpointId === ep.id}
                onTap={onEndpointTap}
                registerTipRef={(el) => {
                  if (el) tipRefs.current.set(ep.id, el);
                  else tipRefs.current.delete(ep.id);
                }}
              />
            ))}
        </div>
        <div className={styles.endpointsCluster}>
          {endpoints
            .filter((ep) => ep.kind === 'guitar' || ep.kind === 'amp_fx_send')
            .map((ep) => (
              <EndpointChip
                key={ep.id}
                ep={ep}
                isSource={true}
                isArmed={armedEndpointId === ep.id}
                onTap={onEndpointTap}
                registerTipRef={(el) => {
                  if (el) tipRefs.current.set(ep.id, el);
                  else tipRefs.current.delete(ep.id);
                }}
              />
            ))}
        </div>
      </div>
    </>
  );
}

/**
 * First-render fallback for the cable terminus when a chip hasn't been
 * measured yet. The strip is CSS-positioned at `bottom: 100%` with an
 * ~8px margin, so the chip tip sits roughly 8px above the board top.
 * Real placement is taken from the tip's measured bbox once layout
 * settles.
 */
const ENDPOINT_TIP_FALLBACK_PX = 8;

interface EndpointChipProps {
  ep: ExternalEndpoint;
  isSource: boolean;
  /** True while this chip is the armed source waiting for completion. */
  isArmed: boolean;
  onTap: ((id: string) => void) | undefined;
  registerTipRef: (el: HTMLElement | null) => void;
}

/**
 * Inline SVG path for the chip silhouette: a Dunlop Flow style pick —
 * three slightly convex arcs (top, lower-right, lower-left) meeting at
 * three rounded corners. The bottom corner is the cable's plug point.
 * Authored against a 120×130 viewBox (taller than wide) so the chip
 * reads as a real pick. `preserveAspectRatio="none"` lets the body
 * stretch; the body is sized close to the authored aspect, keeping
 * distortion mild.
 */
const PICK_PATH =
  'M 25 15 ' +
  'C 50 5 70 5 95 15 ' + // top arc (bulges up)
  'C 110 22 118 32 118 45 ' + // top-right rounded corner
  'C 118 75 100 108 70 124 ' + // lower-right arc (bulges right)
  'C 65 132 55 132 50 124 ' + // bottom rounded point (lowest y = 130)
  'C 20 108 2 75 2 45 ' + // lower-left arc (bulges left)
  'C 2 32 10 22 25 15 ' + // top-left rounded corner
  'Z';

function EndpointChip({
  ep,
  isSource,
  isArmed,
  onTap,
  registerTipRef,
}: EndpointChipProps) {
  const label = isSource ? `From ${ep.label}` : `To ${ep.label}`;
  return (
    <button
      type="button"
      className={`${styles.endpointChip} ${
        isSource ? styles.endpointSource : styles.endpointSink
      } ${isArmed ? styles.endpointChipArmed : ''}`}
      aria-pressed={isArmed}
      onClick={(e) => {
        e.stopPropagation();
        onTap?.(ep.id);
      }}
      title={label}
    >
      <span className={styles.endpointBody}>
        <svg
          className={styles.endpointShape}
          viewBox="0 0 120 130"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path d={PICK_PATH} />
        </svg>
        <span className={styles.endpointLabel}>{label}</span>
      </span>
      {/* Tip lives outside the body so the body's silhouette doesn't
       * crop it. Positioned absolutely at the button's bottom-center,
       * which coincides with the pentagon's point. */}
      <span ref={registerTipRef} className={styles.endpointTip} aria-hidden />
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
  tipCenters: Map<string, { x: number; y: number }>,
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
  // External endpoint — anchor at the chip's plug-tip dot. The chip
  // strip is flex-laid-out, so chip widths depend on label text; we
  // measure each tip's bbox after layout (tipCenters) and terminate the
  // cable at its center. Without per-tip measurement, multiple chips in
  // one cluster collapse to a single cable anchor.
  //
  // First-render fallback (before useLayoutEffect runs): anchor near
  // the cluster edge so a cable still draws.
  const ep = endpointById.get(nodeId);
  if (!ep) return null;
  const measured = tipCenters.get(nodeId);
  if (measured) {
    return {
      xIn: measured.x / pxPerInch,
      yIn: measured.y / pxPerInch,
      side: 'bottom',
    };
  }
  const yIn = -ENDPOINT_TIP_FALLBACK_PX / pxPerInch;
  const isLeftCluster = ep.kind === 'amp_in' || ep.kind === 'amp_fx_return';
  const xIn = isLeftCluster ? 0.75 : rig.widthIn - 0.75;
  return { xIn, yIn, side: 'bottom' };
}
