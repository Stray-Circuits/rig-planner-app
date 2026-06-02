/**
 * Cable rendering helpers split out from ChainOverlay so the routing
 * pipeline (leader-length computation + render-time lane fan-out) can
 * be tested directly against fixtures. Before this split, the test
 * suite re-implemented this logic in a sibling file and drifted from
 * production silently — see #41 follow-ups for the regression that
 * caused.
 *
 * NOTHING in this module touches React or the DOM. It's pure
 * geometry + Map manipulation so tests can import it without mocking.
 */
import type {
  Connection,
  Pedal,
  PlacedPedal,
  Port,
  Side,
} from '../data/schema';
import {
  type ObstacleRect,
  portPositionOnBoard,
  rotatedSide,
} from '../lib/geometry';

/** Base perpendicular leader length (inches). */
export const LEADER_BASE_IN = 0.4;

/**
 * Per-lane increment added to the leader length so cables touching the
 * same pedal-side stack on parallel Y lanes. At default zoom (~50px/in)
 * each lane is ~10px apart — visibly distinct from the 2.5px cable
 * stroke. The actual leader length is CLAMPED by
 * {@link computeLeaderLengths} so the longer leaders don't extend
 * into neighbouring pedals.
 */
export const LEADER_LANE_STEP_IN = 0.2;

/**
 * Two segments count as living in the same lane when their axis values
 * are within this many inches AND their perpendicular-range overlaps.
 * Picked so cables that visually crowd each other (within ~4x cable
 * stroke width at default zoom) get pulled apart. Wider than the
 * route-time LANE_TOL so render-time offset catches what the router
 * couldn't separate.
 */
export const LANE_RENDER_TOL_IN = 0.35;

/**
 * Perpendicular nudge per cable slot. With a 2-cable group, this is the
 * full gap between the two cables (~10px at default zoom 50 px/in,
 * ~4x cable stroke width — comfortably distinct).
 */
export const LANE_RENDER_SHIFT_IN = 0.2;

/** Resolved geometry for one port on one placed pedal. */
export interface ResolvedPort {
  placed: PlacedPedal;
  pedal: Pedal;
  port: Port;
  xIn: number;
  yIn: number;
  visualSide: Side;
}

/** Cable polyline + bookkeeping. */
export interface RoutedCable {
  path: { xIn: number; yIn: number }[];
}

/** Resolve every port on every placed pedal into a lookup map. */
export function buildPortIndex(
  placed: readonly PlacedPedal[],
  pedalsById: Map<string, Pedal>,
): Map<string, Map<string, ResolvedPort>> {
  const result = new Map<string, Map<string, ResolvedPort>>();
  for (const p of placed) {
    const def = pedalsById.get(p.pedalId);
    if (!def) continue;
    const inner = new Map<string, ResolvedPort>();
    for (const port of def.ports) {
      const pos = portPositionOnBoard(p, def, port);
      inner.set(port.id, {
        placed: p,
        pedal: def,
        port,
        xIn: pos.xIn,
        yIn: pos.yIn,
        visualSide: rotatedSide(port.side, p.rotation),
      });
    }
    result.set(p.id, inner);
  }
  return result;
}

/**
 * For each cable-end (key `${cableId}:from` or `${cableId}:to`) on a
 * pedal port, assign a "lane index" relative to the other cable-ends
 * on the same (placedId, visual side). Lower indices land closer to
 * the pedal; higher indices get longer leaders to stack outward.
 *
 * Cable-ends on external endpoints (chips) don't get a lane index.
 */
function laneIndicesPerSide(
  connections: readonly Connection[],
  portIndex: Map<string, Map<string, ResolvedPort>>,
): Map<string, number> {
  interface Member {
    cableId: string;
    end: 'from' | 'to';
    portAxisCoord: number;
  }
  const groups = new Map<string, Member[]>();
  const collect = (
    cableId: string,
    end: 'from' | 'to',
    nodeKind: 'pedal' | 'external',
    nodeId: string,
    portId: string | null,
  ): void => {
    if (nodeKind !== 'pedal' || !portId) return;
    const resolved = portIndex.get(nodeId)?.get(portId);
    if (!resolved) return;
    const side = resolved.visualSide;
    const key = `${nodeId}:${side}`;
    const axisCoord =
      side === 'top' || side === 'bottom' ? resolved.xIn : resolved.yIn;
    const list = groups.get(key) ?? [];
    list.push({ cableId, end, portAxisCoord: axisCoord });
    groups.set(key, list);
  };
  for (const c of connections) {
    collect(c.id, 'from', c.fromNodeKind, c.fromNodeId, c.fromPortId);
    collect(c.id, 'to', c.toNodeKind, c.toNodeId, c.toPortId);
  }
  const result = new Map<string, number>();
  for (const members of groups.values()) {
    members.sort((a, b) => {
      if (a.portAxisCoord !== b.portAxisCoord) {
        return a.portAxisCoord - b.portAxisCoord;
      }
      // Same port → tiebreak by cable id for a stable order.
      return a.cableId.localeCompare(b.cableId);
    });
    members.forEach((m, idx) => {
      result.set(`${m.cableId}:${m.end}`, idx);
    });
  }
  return result;
}

/**
 * Distance (inches) from `port` along its outward direction until the
 * leader axis enters `obstacle`'s strict interior, or -1 if the
 * obstacle isn't on the leader's path.
 */
function leaderHitDistance(
  port: { xIn: number; yIn: number; side: Side },
  obstacle: ObstacleRect,
): number {
  // Tiny epsilon so a leader that grazes the obstacle's edge counts
  // as not crossing (the source pedal's port literally sits on its
  // own edge by construction).
  const edgeEps = 0.001;
  switch (port.side) {
    case 'top': {
      if (
        port.xIn <= obstacle.xIn + edgeEps ||
        port.xIn >= obstacle.xIn + obstacle.widthIn - edgeEps
      ) {
        return -1;
      }
      const obsBottom = obstacle.yIn + obstacle.depthIn;
      if (obsBottom >= port.yIn - edgeEps) return -1;
      return port.yIn - obsBottom;
    }
    case 'bottom': {
      if (
        port.xIn <= obstacle.xIn + edgeEps ||
        port.xIn >= obstacle.xIn + obstacle.widthIn - edgeEps
      ) {
        return -1;
      }
      if (obstacle.yIn <= port.yIn + edgeEps) return -1;
      return obstacle.yIn - port.yIn;
    }
    case 'left': {
      if (
        port.yIn <= obstacle.yIn + edgeEps ||
        port.yIn >= obstacle.yIn + obstacle.depthIn - edgeEps
      ) {
        return -1;
      }
      const obsRight = obstacle.xIn + obstacle.widthIn;
      if (obsRight >= port.xIn - edgeEps) return -1;
      return port.xIn - obsRight;
    }
    case 'right': {
      if (
        port.yIn <= obstacle.yIn + edgeEps ||
        port.yIn >= obstacle.yIn + obstacle.depthIn - edgeEps
      ) {
        return -1;
      }
      if (obstacle.xIn <= port.xIn + edgeEps) return -1;
      return obstacle.xIn - port.xIn;
    }
  }
}

/**
 * Largest leader length before the leader axis would enter any
 * non-source obstacle's strict interior. Returns Infinity if no
 * obstacle is on the path. Pure look-up; no clamping to a requested
 * value (use {@link maxSafeLeaderLength} for that).
 */
function maxLeaderRoom(
  port: { xIn: number; yIn: number; side: Side },
  sourcePedalRect: ObstacleRect | null,
  obstacles: readonly ObstacleRect[],
  clearance: number,
): number {
  let allowed = Infinity;
  for (const r of obstacles) {
    if (sourcePedalRect && r === sourcePedalRect) continue;
    const dist = leaderHitDistance(port, r);
    if (dist < 0) continue;
    const cap = dist - clearance;
    if (cap < allowed) allowed = cap;
  }
  return allowed;
}

/**
 * Largest leader length in [minLen, requested] that doesn't push the
 * leader axis through any obstacle other than the source pedal
 * itself. `clearance` is the gap left between the leader-tip and the
 * blocking obstacle's raw edge — the router then has at least this
 * much room to start its inner path without immediately hitting the
 * obstacle's INFLATED rect.
 *
 * Default 0.2" matches `routeCableWithLeader`'s `obstacleMarginIn`
 * (0.15") plus a small epsilon, so a clamped leader-tip lands
 * *outside* the inflated obstacle, not just outside the raw pedal
 * art. Without this margin the leader-tip can land in the inflation
 * band and the router then can't escape cleanly — it picks a path
 * that crosses the neighbour because every starting move is already
 * "inside" it.
 */
export function maxSafeLeaderLength(
  port: { xIn: number; yIn: number; side: Side },
  sourcePedalRect: ObstacleRect | null,
  obstacles: readonly ObstacleRect[],
  requested: number,
  clearance = 0.2,
  minLen = 0.2,
): number {
  const allowed = maxLeaderRoom(port, sourcePedalRect, obstacles, clearance);
  return Math.max(minLen, Math.min(requested, allowed));
}

/**
 * Distribute leader lengths across N cables sharing a pedal side so
 * each cable ends up at a DIFFERENT length (visual lane separation),
 * subject to a hard upper cap `maxSafe`. Returns an array of length N
 * indexed by lane index (0 = closest to pedal, N-1 = furthest).
 *
 *   - When the natural staggered lengths (base, base+step, …,
 *     base+(N-1)*step) all fit under `maxSafe`, returns them
 *     unchanged.
 *   - Otherwise, anchors the longest lane at `maxSafe` and shifts
 *     the others down so the inter-lane step is preserved.
 *   - If even the shortest would be below `minLen`, compresses the
 *     step so all lengths fit in [minLen, maxSafe].
 *   - If `maxSafe < minLen` (the corridor is too thin to even reach
 *     the minimum visible leader), every cable gets `minLen` and
 *     accepts the visual stack — there's no room to spread.
 */
function distributeLeaderLengths(
  N: number,
  maxSafe: number,
  baseLength: number,
  step: number,
  minLen: number,
): number[] {
  if (N <= 0) return [];
  if (N === 1) {
    return [Math.max(minLen, Math.min(baseLength, maxSafe))];
  }
  const maxRequested = baseLength + (N - 1) * step;
  if (maxRequested <= maxSafe) {
    return Array.from({ length: N }, (_, k) => baseLength + k * step);
  }
  if (maxSafe < minLen) {
    return Array.from({ length: N }, () => minLen);
  }
  // Anchor longest at maxSafe, shift down. Reduce step if shifted
  // shortest would dip below minLen.
  let bottom = maxSafe - (N - 1) * step;
  if (bottom < minLen) bottom = minLen;
  const actualStep = (maxSafe - bottom) / (N - 1);
  return Array.from({ length: N }, (_, k) => bottom + k * actualStep);
}

/**
 * For each cable-end on a pedal port, compute the leader length to
 * use. Lane index drives the *requested* length (base + idx * step),
 * but the result is clamped per-side so the leader doesn't extend
 * into a neighbouring pedal AND each cable in a side-group still
 * gets a unique length (preventing visual stacking when the natural
 * staggered lengths all collide with the same neighbour).
 *
 * Returned map key: `${cableId}:from` or `${cableId}:to`.
 * Cable-ends on external endpoints don't get an entry; callers
 * should default to {@link LEADER_BASE_IN} for those.
 */
export function computeLeaderLengths(
  connections: readonly Connection[],
  portIndex: Map<string, Map<string, ResolvedPort>>,
  obstacleByPlaced: Map<string, ObstacleRect>,
  baseLength = LEADER_BASE_IN,
  step = LEADER_LANE_STEP_IN,
  // `routingMargin` is the same value the router uses for
  // `obstacleMarginIn`. The clamp's clearance and minLen are derived
  // from it so the clamped leader-tip lands outside the router's
  // inflated obstacle band — both for the source pedal (so the
  // router can start cleanly) and for neighbours (so the leader
  // doesn't pierce a neighbouring pedal's keep-out shadow).
  routingMargin = 0.15,
): Map<string, number> {
  const laneIdx = laneIndicesPerSide(connections, portIndex);
  const allObstacles = [...obstacleByPlaced.values()];
  const clearance = routingMargin + 0.05;
  const minLen = routingMargin + 0.05;
  // Group cable-ends by their (placedId, visualSide) so we can
  // redistribute leader lengths across the whole group when the
  // requested staggered lengths don't all fit under the available
  // clearance.
  interface CableEnd {
    key: string;
    xIn: number;
    yIn: number;
    side: Side;
    sourcePedalRect: ObstacleRect | null;
    laneIdx: number;
  }
  const groups = new Map<string, CableEnd[]>();
  for (const c of connections) {
    for (const end of ['from', 'to'] as const) {
      const nodeKind = end === 'from' ? c.fromNodeKind : c.toNodeKind;
      const nodeId = end === 'from' ? c.fromNodeId : c.toNodeId;
      const portId = end === 'from' ? c.fromPortId : c.toPortId;
      if (nodeKind !== 'pedal' || !portId) continue;
      const resolved = portIndex.get(nodeId)?.get(portId);
      if (!resolved) continue;
      const key = `${c.id}:${end}`;
      const groupKey = `${nodeId}:${resolved.visualSide}`;
      const arr = groups.get(groupKey) ?? [];
      arr.push({
        key,
        xIn: resolved.xIn,
        yIn: resolved.yIn,
        side: resolved.visualSide,
        sourcePedalRect: obstacleByPlaced.get(nodeId) ?? null,
        laneIdx: laneIdx.get(key) ?? 0,
      });
      groups.set(groupKey, arr);
    }
  }
  const result = new Map<string, number>();
  for (const members of groups.values()) {
    // Group max-safe = the tightest cap any member faces. Using min
    // across members keeps all leaders inside every member's safe
    // range (worst-case clearance, but simple and correct).
    let groupMax = Infinity;
    for (const m of members) {
      const room = maxLeaderRoom(
        { xIn: m.xIn, yIn: m.yIn, side: m.side },
        m.sourcePedalRect,
        allObstacles,
        clearance,
      );
      if (room < groupMax) groupMax = room;
    }
    members.sort((a, b) => a.laneIdx - b.laneIdx);
    const lengths = distributeLeaderLengths(
      members.length,
      groupMax,
      baseLength,
      step,
      minLen,
    );
    members.forEach((m, i) => {
      result.set(m.key, lengths[i]!);
    });
  }
  return result;
}

/** Strict-interior AABB collision check. */
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
 * Largest |shift| in [0, requested] that keeps the post-shift
 * segment clear of every obstacle. Bisects toward zero so even a
 * partial shift gives some visual separation when a full shift
 * would push the cable into a pedal. Returns 0 if even a tiny shift
 * is unsafe.
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
  let lo = 0;
  let hi = Math.abs(requestedShift);
  const sign = Math.sign(requestedShift);
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    if (tryShift(sign * mid)) lo = mid;
    else hi = mid;
  }
  if (lo < 0.02) return 0;
  return sign * lo;
}

interface SegRef {
  cableIdx: number;
  segIdx: number;
  lo: number;
  hi: number;
  axisValue: number;
}

/**
 * Post-processing pass over already-routed cables: when several
 * cables end up on near-identical Y lanes (horizontal segments) or
 * X lanes (vertical segments) with overlapping x/y ranges, nudge
 * each one perpendicular by {@link LANE_RENDER_SHIFT_IN} so they
 * render as distinct lines instead of stacking. The shift for each
 * segment is clamped against `obstacles` so the nudge never pushes
 * a cable through a pedal.
 *
 * Mutates the cables' `path` arrays in place.
 */
export function applyLaneRenderOffsets(
  cables: RoutedCable[],
  obstacles: readonly ObstacleRect[],
): void {
  const hSegs: SegRef[] = [];
  const vSegs: SegRef[] = [];
  for (let cableIdx = 0; cableIdx < cables.length; cableIdx++) {
    const path = cables[cableIdx]!.path;
    if (path.length < 4) continue;
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
  const shY = new Map<string, number>();
  const shX = new Map<string, number>();
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
  processGroup(hSegs, shY);
  processGroup(vSegs, shX);
  for (let cableIdx = 0; cableIdx < cables.length; cableIdx++) {
    const path = cables[cableIdx]!.path;
    for (let i = 1; i < path.length - 2; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const reqY = shY.get(`${cableIdx}:${i}`);
      if (reqY !== undefined && reqY !== 0) {
        const s = safeShiftForSegment(
          a.xIn,
          a.yIn,
          b.xIn,
          b.yIn,
          reqY,
          'y',
          obstacles,
        );
        if (s !== 0) {
          path[i] = { xIn: a.xIn, yIn: a.yIn + s };
          path[i + 1] = { xIn: b.xIn, yIn: b.yIn + s };
        }
      }
      const reqX = shX.get(`${cableIdx}:${i}`);
      if (reqX !== undefined && reqX !== 0) {
        const a2 = path[i]!;
        const b2 = path[i + 1]!;
        const s = safeShiftForSegment(
          a2.xIn,
          a2.yIn,
          b2.xIn,
          b2.yIn,
          reqX,
          'x',
          obstacles,
        );
        if (s !== 0) {
          path[i] = { xIn: a2.xIn + s, yIn: a2.yIn };
          path[i + 1] = { xIn: b2.xIn + s, yIn: b2.yIn };
        }
      }
    }
  }
}
