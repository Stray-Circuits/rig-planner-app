import type {
  JackSize,
  Pedal,
  PlacedPedal,
  Port,
  Rig,
  Side,
} from '../data/schema';

/** Footprint of a placed pedal, accounting for 90/270 rotation. */
export function placedFootprint(
  pedal: Pedal,
  rotation: PlacedPedal['rotation'],
): { widthIn: number; depthIn: number } {
  const rotated = rotation === 90 || rotation === 270;
  return {
    widthIn: rotated ? pedal.depthIn : pedal.widthIn,
    depthIn: rotated ? pedal.widthIn : pedal.depthIn,
  };
}

/** Clamp a placed pedal's top-left so it stays fully on the board. */
export function clampToBoard(
  xIn: number,
  yIn: number,
  pedal: Pedal,
  rotation: PlacedPedal['rotation'],
  rig: Rig,
): { xIn: number; yIn: number } {
  const { widthIn, depthIn } = placedFootprint(pedal, rotation);
  const maxX = Math.max(0, rig.widthIn - widthIn);
  const maxY = Math.max(0, rig.depthIn - depthIn);
  return {
    xIn: Math.min(maxX, Math.max(0, xIn)),
    yIn: Math.min(maxY, Math.max(0, yIn)),
  };
}

/**
 * "Keep-out" rect for a placed pedal — the footprint extended outward on
 * each side that has at least one jack (audio, MIDI, or power) so cable
 * barrels have room to live. Used to render translucent shadow strips
 * around pedals and to flag overlap.
 *
 * Returned in board (inch) coordinates. May extend off the board; callers
 * should clip to rig bounds when rendering.
 *
 * Per-jack barrel lengths come from real-world plug bodies:
 *   - TS / TRS / TRS-MIDI / XLR (audio): rig-configurable patch-cable
 *     body size (see {@link JACK_SIZE_INCHES}). TRS-MIDI shares the
 *     audio jack size because it's the same 1/4" plug body.
 *   - 5-pin DIN MIDI: 15mm (~0.5906"), the physical DIN body.
 *   - Power: 12mm (~0.4724"), a standard center-negative 2.1mm barrel.
 *
 * Sides with ports use the connector-derived barrel for each port; the
 * side's pad is the largest barrel across all ports on it (they don't
 * sum). Sides without any ports but flagged in `jackSides` fall back
 * to the legacy "audio = jackSize, midi = 15mm" defaults so older
 * pedals that only carry the boolean flags still get a reasonable pad.
 */
/**
 * Audio jack barrel length per {@link JackSize}. Sizes from issue #16:
 *   - small  = EBS / flat ribbon (~0.25")
 *   - medium = pancake / Switchcraft 228 (~0.4375")
 *   - large  = standard Switchcraft 226 (~0.625")
 */
export const JACK_SIZE_INCHES: Record<JackSize, number> = {
  small: 0.25,
  medium: 0.4375,
  large: 0.625,
};
export const KEEP_OUT_MIDI_INCHES = 15 / 25.4;
export const KEEP_OUT_POWER_INCHES = 12 / 25.4;

export function keepOutRect(
  placed: PlacedPedal,
  pedal: Pedal,
  jackSize: JackSize,
): { xIn: number; yIn: number; widthIn: number; depthIn: number } {
  const { widthIn, depthIn } = placedFootprint(pedal, placed.rotation);
  const audioPad = JACK_SIZE_INCHES[jackSize];
  // Translate each logical jack-bearing side to its visual side after
  // rotation, then take the largest required pad per visual side.
  const padBySide: Record<Side, number> = {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  };
  const bump = (logical: Side, value: number) => {
    const v = rotatedSide(logical, placed.rotation);
    if (value > padBySide[v]) padBySide[v] = value;
  };
  // Primary source of truth: walk the ports list. Each port's
  // connector determines its barrel length — TRS-MIDI is a 1/4" plug
  // so it follows the user jack-size knob; only the 5-pin DIN body
  // gets the fixed 15mm.
  const sidesWithPorts = new Set<Side>();
  for (const port of pedal.ports) {
    let barrel: number;
    switch (port.connector) {
      case 'midi_din':
        barrel = KEEP_OUT_MIDI_INCHES;
        break;
      case 'ts':
      case 'trs':
      case 'midi_trs':
      case 'xlr':
        barrel = audioPad;
        break;
    }
    bump(port.side, barrel);
    sidesWithPorts.add(port.side);
  }
  // Legacy fallback: a side flagged in jackSides but with no port on
  // it still gets a pad. Skip sides that already have ports — the
  // port-driven decision above is more specific and would otherwise
  // get clobbered by the coarser audio/midi defaults.
  const j = pedal.jackSides;
  if (j.top && !sidesWithPorts.has('top')) bump('top', audioPad);
  if (j.bottom && !sidesWithPorts.has('bottom')) bump('bottom', audioPad);
  if (j.left && !sidesWithPorts.has('left')) bump('left', audioPad);
  if (j.right && !sidesWithPorts.has('right')) bump('right', audioPad);
  if (j.midi_top && !sidesWithPorts.has('top'))
    bump('top', KEEP_OUT_MIDI_INCHES);
  if (j.midi_bottom && !sidesWithPorts.has('bottom'))
    bump('bottom', KEEP_OUT_MIDI_INCHES);
  if (j.midi_left && !sidesWithPorts.has('left'))
    bump('left', KEEP_OUT_MIDI_INCHES);
  if (j.midi_right && !sidesWithPorts.has('right'))
    bump('right', KEEP_OUT_MIDI_INCHES);
  if (pedal.powerSide) bump(pedal.powerSide, KEEP_OUT_POWER_INCHES);
  return {
    xIn: placed.xIn - padBySide.left,
    yIn: placed.yIn - padBySide.top,
    widthIn: widthIn + padBySide.left + padBySide.right,
    depthIn: depthIn + padBySide.top + padBySide.bottom,
  };
}

/** Axis-aligned rectangle overlap test (inclusive of edges = no overlap). */
export function rectsOverlap(
  a: { xIn: number; yIn: number; widthIn: number; depthIn: number },
  b: { xIn: number; yIn: number; widthIn: number; depthIn: number },
): boolean {
  return (
    a.xIn < b.xIn + b.widthIn &&
    a.xIn + a.widthIn > b.xIn &&
    a.yIn < b.yIn + b.depthIn &&
    a.yIn + a.depthIn > b.yIn
  );
}

/**
 * Returns the set of placed-pedal IDs whose footprint or keep-out rect
 * overlaps another pedal on the same rig. Used to surface visual warning
 * highlights without changing drag/drop behavior.
 */
export function overlappingPlacedIds(
  placed: readonly PlacedPedal[],
  pedalsById: Map<string, Pedal>,
  jackSize: JackSize,
): Set<string> {
  const rects = placed
    .map((p) => {
      const def = pedalsById.get(p.pedalId);
      return def ? { id: p.id, rect: keepOutRect(p, def, jackSize) } : null;
    })
    .filter(
      (x): x is { id: string; rect: ReturnType<typeof keepOutRect> } =>
        x !== null,
    );
  const flagged = new Set<string>();
  for (let i = 0; i < rects.length; i++) {
    for (let k = i + 1; k < rects.length; k++) {
      const a = rects[i]!;
      const b = rects[k]!;
      if (rectsOverlap(a.rect, b.rect)) {
        flagged.add(a.id);
        flagged.add(b.id);
      }
    }
  }
  return flagged;
}

/** Center a pedal on a rig (used when adding from the sidebar). */
export function centeredOnRig(
  pedal: Pedal,
  rig: Rig,
  rotation: PlacedPedal['rotation'] = 0,
): { xIn: number; yIn: number } {
  const { widthIn, depthIn } = placedFootprint(pedal, rotation);
  return {
    xIn: Math.max(0, (rig.widthIn - widthIn) / 2),
    yIn: Math.max(0, (rig.depthIn - depthIn) / 2),
  };
}

/**
 * After a pedal is rotated, the visual side a port appears on changes. This
 * maps a logical port side (the side declared on the Port row) to the side
 * the port actually faces on the board, given a rotation.
 *
 * For 0°: top -> top, etc.
 * For 90° clockwise: top -> right, right -> bottom, bottom -> left, left -> top.
 * For 180°: top -> bottom, right -> left, etc.
 * For 270°: top -> left, etc.
 */
export function rotatedSide(
  logicalSide: Side,
  rotation: PlacedPedal['rotation'],
): Side {
  const order: Side[] = ['top', 'right', 'bottom', 'left'];
  const idx = order.indexOf(logicalSide);
  const steps = rotation / 90;
  return order[(idx + steps) % 4]!;
}

/**
 * Canonical group ordinal for a port's role, used by visual port layout.
 *   0 = inputs (mono, L, R, stereo)
 *   1 = outputs (mono, L, R, stereo)
 *   2 = fx loop (send + return)
 *   3 = midi (in + out)
 *   4 = expression / cv / remote
 * Lower-ordinal ports anchor at the "input end" of a side so a pedal's
 * sides read consistently regardless of the order ports were created in.
 */
export function portLayoutGroup(role: Port['role']): number {
  switch (role) {
    case 'input':
    case 'input_l':
    case 'input_r':
    case 'stereo_input':
      return 0;
    case 'output':
    case 'output_l':
    case 'output_r':
    case 'stereo_output':
      return 1;
    case 'fx_send':
    case 'fx_return':
      return 2;
    case 'midi_in':
    case 'midi_out':
      return 3;
    case 'expression_in':
    case 'expression_out':
    case 'cv_in':
    case 'cv_out':
    case 'remote_in':
    case 'remote_out':
      return 4;
  }
}

/**
 * Returns the position (in inches, board coordinates) of a port on a placed
 * pedal. Ports on the same side are laid out in canonical role order:
 * inputs → outputs → fx loop → midi → expression. For horizontal sides
 * (top / bottom) the first group anchors at the right edge — matching the
 * convention where inputs live on the right side of a pedal. For vertical
 * sides the first group anchors at the top.
 *
 * `sideOrder` is used as a tiebreaker within a group so users can still
 * nudge two same-category ports relative to each other.
 */
export function portPositionOnBoard(
  placed: PlacedPedal,
  pedal: Pedal,
  port: Port,
): { xIn: number; yIn: number } {
  const { widthIn, depthIn } = placedFootprint(pedal, placed.rotation);
  const visualSide = rotatedSide(port.side, placed.rotation);
  const siblings = pedal.ports
    .filter((p) => rotatedSide(p.side, placed.rotation) === visualSide)
    .sort((a, b) => {
      const ag = portLayoutGroup(a.role);
      const bg = portLayoutGroup(b.role);
      if (ag !== bg) return ag - bg;
      return a.sideOrder - b.sideOrder;
    });
  const idx = Math.max(
    0,
    siblings.findIndex((p) => p.id === port.id),
  );
  // Fraction from 0..1 along the side. For top/bottom we reverse so the
  // first sibling (inputs) lands at the rightmost x; for left/right we
  // keep the natural top-down order.
  const fwd = (idx + 1) / (siblings.length + 1);
  const rev = 1 - fwd;

  switch (visualSide) {
    case 'top':
      return { xIn: placed.xIn + widthIn * rev, yIn: placed.yIn };
    case 'bottom':
      return {
        xIn: placed.xIn + widthIn * rev,
        yIn: placed.yIn + depthIn,
      };
    case 'left':
      return { xIn: placed.xIn, yIn: placed.yIn + depthIn * fwd };
    case 'right':
      return {
        xIn: placed.xIn + widthIn,
        yIn: placed.yIn + depthIn * fwd,
      };
  }
}

/** Axis-aligned rectangle in board (inch) space. */
export interface ObstacleRect {
  xIn: number;
  yIn: number;
  widthIn: number;
  depthIn: number;
}

/** Footprint rect for a placed pedal — useful as an obstacle for cable routing. */
export function placedRect(placed: PlacedPedal, pedal: Pedal): ObstacleRect {
  const { widthIn, depthIn } = placedFootprint(pedal, placed.rotation);
  return { xIn: placed.xIn, yIn: placed.yIn, widthIn, depthIn };
}

/**
 * Whether the axis-aligned segment (a → b) crosses the interior of `rect`.
 * Touching the edges is allowed — cables that come off a pedal port and
 * brush past an adjacent pedal's edge shouldn't trip this. Uses a small
 * epsilon to give grazes the benefit of the doubt.
 */
function segmentHitsRect(
  a: { xIn: number; yIn: number },
  b: { xIn: number; yIn: number },
  rect: ObstacleRect,
): boolean {
  const eps = 0.05;
  const minX = Math.min(a.xIn, b.xIn);
  const maxX = Math.max(a.xIn, b.xIn);
  const minY = Math.min(a.yIn, b.yIn);
  const maxY = Math.max(a.yIn, b.yIn);
  return (
    maxX > rect.xIn + eps &&
    minX < rect.xIn + rect.widthIn - eps &&
    maxY > rect.yIn + eps &&
    minY < rect.yIn + rect.depthIn - eps
  );
}

function pathHitsAny(
  path: { xIn: number; yIn: number }[],
  rects: readonly ObstacleRect[],
): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    for (const r of rects) {
      if (segmentHitsRect(a, b, r)) return true;
    }
  }
  return false;
}

/** Unit vector pointing outward from a pedal edge on the given side. */
export function sideOutwardUnit(side: Side): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 };
    case 'bottom':
      return { x: 0, y: 1 };
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
  }
}

/**
 * Routing options that let the caller bias against lanes already used
 * by previously-routed cables, stagger leader lengths per cable so
 * multiple cables touching the same pedal-side stack on parallel Y
 * lanes, and softly cap how far outside the board the elbow can wander.
 */
export interface RouteOptions {
  /** Y-values of horizontal segments already taken by other cables. */
  claimedY?: readonly number[];
  /** X-values of vertical segments already taken by other cables. */
  claimedX?: readonly number[];
  /** Override the perpendicular leader length at the FROM port. */
  fromLeaderIn?: number;
  /** Override the perpendicular leader length at the TO port. */
  toLeaderIn?: number;
  /** Board width (inches) — used to discourage off-board elbows. */
  boardWidthIn?: number;
  /** Board depth (inches) — used to discourage off-board elbows. */
  boardDepthIn?: number;
  /**
   * How far obstacles are inflated before routing decides what's
   * "clear". Should be ≥ the rig's jack-size keep-out distance so
   * cables route OUTSIDE each pedal's keep-out shadow, not just
   * outside the raw pedal art. Overrides the default (0.15") which
   * was sized for small jacks only.
   */
  obstacleMarginIn?: number;
}

/**
 * Manhattan cable path that *always* exits each pedal perpendicular to
 * its edge for a leader distance before any 90° turn. The leader lets
 * cables visibly "plug into" a pedal — no cable ever pivots flush with
 * the pedal body. Internally builds a Manhattan route between the
 * leader endpoints using the existing routeCablePath obstacle-avoidance
 * candidates.
 *
 * Returns a polyline of points (in the same inch units as the inputs).
 * The first and last segments of the returned polyline are the leaders.
 */
export function routeCableWithLeader(
  from: { xIn: number; yIn: number; side: Side },
  to: { xIn: number; yIn: number; side: Side },
  obstacles: readonly ObstacleRect[] = [],
  options: RouteOptions = {},
  leaderIn = 0.4,
  // Default 0.15" was sized for small jacks only; callers that know
  // the rig's jack size should override via `options.obstacleMarginIn`
  // so cables stay outside the keep-out shadow rendered around each
  // pedal (which is ≥ jackSize wide on jacked sides).
  obstacleMarginIn = 0.15,
): { xIn: number; yIn: number }[] {
  const effectiveMargin = options.obstacleMarginIn ?? obstacleMarginIn;
  const dFrom = sideOutwardUnit(from.side);
  const dTo = sideOutwardUnit(to.side);
  const fromLeaderLen = options.fromLeaderIn ?? leaderIn;
  const toLeaderLen = options.toLeaderIn ?? leaderIn;
  const fromLeader = {
    xIn: from.xIn + dFrom.x * fromLeaderLen,
    yIn: from.yIn + dFrom.y * fromLeaderLen,
    side: from.side,
  };
  const toLeader = {
    xIn: to.xIn + dTo.x * toLeaderLen,
    yIn: to.yIn + dTo.y * toLeaderLen,
    side: to.side,
  };
  // Inflate obstacles by a margin so cables route AROUND pedals with
  // breathing room rather than skimming the footprint edge.
  const inflated = obstacles.map((r) => ({
    xIn: r.xIn - effectiveMargin,
    yIn: r.yIn - effectiveMargin,
    widthIn: r.widthIn + 2 * effectiveMargin,
    depthIn: r.depthIn + 2 * effectiveMargin,
  }));
  const inner = routeCablePath(fromLeader, toLeader, inflated, options);
  return [
    { xIn: from.xIn, yIn: from.yIn },
    ...inner,
    { xIn: to.xIn, yIn: to.yIn },
  ];
}

/**
 * Extract the lane values (horizontal segment Ys, vertical segment Xs)
 * a routed cable occupies. Caller threads these into the next cable's
 * `RouteOptions.claimedY` / `claimedX` so subsequent cables prefer
 * unclaimed lanes. Only counts segments long enough to be "real" lanes
 * (skip leader-length stubs).
 */
export function pathLanes(path: readonly { xIn: number; yIn: number }[]): {
  horizontalY: number[];
  verticalX: number[];
} {
  const horizontalY: number[] = [];
  const verticalX: number[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const dx = Math.abs(b.xIn - a.xIn);
    const dy = Math.abs(b.yIn - a.yIn);
    if (dy < 0.001 && dx > 0.5) horizontalY.push(a.yIn);
    else if (dx < 0.001 && dy > 0.5) verticalX.push(a.xIn);
  }
  return { horizontalY, verticalX };
}

/**
 * Orthogonal cable path between two points. Enumerates candidates
 * from THREE generators in parallel and picks the lowest-scoring
 * clean path:
 *   1. 3-segment Manhattan elbows
 *   2. 5-segment "go around" wraps
 *   3. visibility-grid A* (handles narrow gaps and multi-detour cases
 *      the discrete generators can't express)
 *
 * Picking the global best matters because 3-seg and 5-seg often
 * return *some* clean path that wraps the long way around the board
 * when a more direct route through a narrow gap exists. Only A*'s
 * obstacle-edge grid sees those gaps, so without comparing all three
 * the router would happily pick the ugly wrap and exit early (the
 * actual bug behind #41).
 *
 * `obstacles` MAY include the pedals owning the from/to ports — the
 * caller of `routeCableWithLeader` will arrange that the leader endpoints
 * lie just outside the pedals' inflated rects.
 *
 * Returns a polyline as an array of {x, y} in the same units as the inputs.
 */
export function routeCablePath(
  from: { xIn: number; yIn: number; side: Side },
  to: { xIn: number; yIn: number; side: Side },
  obstacles: readonly ObstacleRect[] = [],
  options: RouteOptions = {},
): { xIn: number; yIn: number }[] {
  const dx = Math.abs(to.xIn - from.xIn);
  const dy = Math.abs(to.yIn - from.yIn);
  if (dx < 0.05 || dy < 0.05) {
    const straight = [
      { xIn: from.xIn, yIn: from.yIn },
      { xIn: to.xIn, yIn: to.yIn },
    ];
    if (!pathHitsAny(straight, obstacles)) return straight;
  }

  const cand3 = generateRouteCandidates(from, to, obstacles);
  const cand5 = generate5SegCandidates(from, to, obstacles);
  const aStar = routeAStar(from, to, obstacles, options);
  const allCands: { xIn: number; yIn: number }[][] = [...cand3, ...cand5];
  if (aStar) allCands.push(aStar);

  // Dedupe each candidate BEFORE the clean/U-turn check. dedupe
  // collapses colinear back-and-forth waypoints into a single
  // segment that *looks* straight to the eye — and if the original
  // candidate went up-then-back-down at the leader, the deduped
  // polyline appears to U-turn at the leader-tip. Checking the
  // deduped form catches that case.
  const dedupedCands = allCands.map((c) => dedupeColinear(c));
  const best = shortestClean(
    dedupedCands,
    obstacles,
    options,
    from.side,
    to.side,
  );
  if (best) return best;

  // No clean candidate survived. Prefer a U-turn-free dirty path over
  // a U-turning one — a cable that crosses a pedal edge reads as a
  // routing problem, but a cable that doubles back on its own leader
  // reads as broken.
  let bestFallback: { xIn: number; yIn: number }[] | null = null;
  let bestFallbackLen = Infinity;
  for (const path of allCands) {
    if (hasEndpointUTurn(path, from.side, to.side)) continue;
    const len = pathLength(path);
    if (len < bestFallbackLen) {
      bestFallback = path;
      bestFallbackLen = len;
    }
  }
  if (bestFallback) return dedupeColinear(bestFallback);

  return dedupeColinear(
    cand3[0] ?? [
      { xIn: from.xIn, yIn: from.yIn },
      { xIn: to.xIn, yIn: to.yIn },
    ],
  );
}

/** Sum of orthogonal segment lengths along the polyline. */
function pathLength(path: readonly { xIn: number; yIn: number }[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    total += Math.abs(b.xIn - a.xIn) + Math.abs(b.yIn - a.yIn);
  }
  return total;
}

/**
 * Score = Manhattan length + off-board penalty + small turn penalty
 * + bounded lane-reuse penalty.
 *
 * Lane reuse penalty: each long segment contributes at most
 * LANE_PENALTY (when sitting exactly on another cable's lane), with
 * smooth linear falloff out to LANE_TOL. Critically the penalty per
 * segment is the MAX over claimed lanes within tolerance, not the
 * sum — so a path crossing N claimed lanes is no more expensive than
 * crossing one. That keeps the bias toward picking a fresh lane when
 * one is available without ballooning the score in dense lane groups
 * (which used to force absurd board-wrap detours).
 *
 * Off-board penalty is large enough that the router prefers a
 * longer on-board route to a short off-board one. The chip strip
 * sits ~0.5" above the board, so cables terminating at chips will
 * naturally touch negative y; only INNER corners off-board pay the
 * penalty.
 *
 * Turn penalty: small per-corner cost so a path with the same length
 * but fewer bends scores better. Addresses the issue's "unnecessary
 * squiggles" criterion.
 */
function pathScore(
  path: readonly { xIn: number; yIn: number }[],
  options: RouteOptions,
): number {
  let score = pathLength(path);
  const boardW = options.boardWidthIn;
  const boardD = options.boardDepthIn;
  const claimedY = options.claimedY ?? [];
  const claimedX = options.claimedX ?? [];
  const OFF_BOARD_PENALTY = 25.0;
  const TURN_PENALTY = 0.3;
  // Wide tolerance + tall penalty: cables within 0.4" of a claimed
  // lane get pushed away with up to 5 inches of "virtual" extra
  // path. Combined with the bounded-MAX accumulation, that strongly
  // biases toward fresh lanes (no stacking) but still lets the
  // router share a lane if going further is impractical.
  const LANE_TOL = 0.4;
  const LANE_PENALTY = 5.0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const dx = Math.abs(b.xIn - a.xIn);
    const dy = Math.abs(b.yIn - a.yIn);
    if (dy < 0.001 && dx > 0.5) {
      let worst = 0;
      for (const y of claimedY) {
        const d = Math.abs(a.yIn - y);
        if (d < LANE_TOL) {
          const p = LANE_PENALTY * (1 - d / LANE_TOL);
          if (p > worst) worst = p;
        }
      }
      score += worst;
    } else if (dx < 0.001 && dy > 0.5) {
      let worst = 0;
      for (const x of claimedX) {
        const d = Math.abs(a.xIn - x);
        if (d < LANE_TOL) {
          const p = LANE_PENALTY * (1 - d / LANE_TOL);
          if (p > worst) worst = p;
        }
      }
      score += worst;
    }
    if (boardW !== undefined && boardD !== undefined) {
      for (const pt of [a, b]) {
        const overshoot =
          Math.max(0, -pt.xIn) +
          Math.max(0, pt.xIn - boardW) +
          Math.max(0, -pt.yIn) +
          Math.max(0, pt.yIn - boardD);
        if (overshoot > 0) score += OFF_BOARD_PENALTY * overshoot;
      }
    }
  }
  // Count interior corners — every vertex except the two endpoints.
  if (path.length > 2) score += TURN_PENALTY * (path.length - 2);
  return score;
}

/**
 * Whether the path U-turns at either leader endpoint. The path's first
 * segment must not reverse direction relative to the from-port's outward
 * leader (which pointed AWAY from the pedal), and the path's last segment
 * must not reverse direction relative to the to-port's inward leader
 * (which points INTO the pedal). Perpendicular turns are fine — that's
 * the normal 90° bend at a leader endpoint. Only 180° reversals get
 * flagged.
 *
 * Catches cases the per-generator constraints miss — notably the
 * mixed-orientation 3-segment L-shapes, where one of the two L-shapes
 * inherently U-turns when the destination is on the "wrong side" of the
 * source's leader axis.
 */
function hasEndpointUTurn(
  path: readonly { xIn: number; yIn: number }[],
  fromSide: Side,
  toSide: Side,
): boolean {
  if (path.length < 2) return false;
  const fromOut = sideOutwardUnit(fromSide);
  const toOut = sideOutwardUnit(toSide);
  const p0 = path[0]!;
  const p1 = path[1]!;
  // First inner segment vs leader-1 (which went in +fromOut). For no
  // reversal: first-segment direction · fromOut ≥ 0.
  const d1x = p1.xIn - p0.xIn;
  const d1y = p1.yIn - p0.yIn;
  if (d1x * fromOut.x + d1y * fromOut.y < -0.001) return true;
  const n = path.length;
  const pNm2 = path[n - 2]!;
  const pNm1 = path[n - 1]!;
  // Last inner segment vs leader-2 (which goes in -toOut, inward). For
  // no reversal: last-segment direction · (-toOut) ≥ 0, equivalently
  // direction · toOut ≤ 0.
  const dNx = pNm1.xIn - pNm2.xIn;
  const dNy = pNm1.yIn - pNm2.yIn;
  if (dNx * toOut.x + dNy * toOut.y > 0.001) return true;
  return false;
}

/** Return the cheapest candidate that doesn't hit any obstacle, or null. */
function shortestClean(
  candidates: readonly { xIn: number; yIn: number }[][],
  obstacles: readonly ObstacleRect[],
  options: RouteOptions = {},
  fromSide?: Side,
  toSide?: Side,
): { xIn: number; yIn: number }[] | null {
  let best: { xIn: number; yIn: number }[] | null = null;
  let bestScore = Infinity;
  for (const path of candidates) {
    if (pathHitsAny(path, obstacles)) continue;
    if (fromSide && toSide && hasEndpointUTurn(path, fromSide, toSide))
      continue;
    const score = pathScore(path, options);
    if (score < bestScore) {
      best = path;
      bestScore = score;
    }
  }
  return best;
}

/** Outward "sign" of a side along its perpendicular axis. */
function outwardSign(side: Side): -1 | 1 {
  return side === 'top' || side === 'left' ? -1 : 1;
}

function generateRouteCandidates(
  from: { xIn: number; yIn: number; side: Side },
  to: { xIn: number; yIn: number; side: Side },
  obstacles: readonly ObstacleRect[],
): { xIn: number; yIn: number }[][] {
  const fromHorizontal = from.side === 'left' || from.side === 'right';
  const toHorizontal = to.side === 'left' || to.side === 'right';
  const cands: { xIn: number; yIn: number }[][] = [];

  const pHFrom = { xIn: from.xIn, yIn: from.yIn };
  const pHTo = { xIn: to.xIn, yIn: to.yIn };

  // Same horizontal anchor orientation → elbow varies along X.
  if (fromHorizontal && toHorizontal) {
    const matchedSign = from.side === to.side ? outwardSign(from.side) : null;
    const elbows = elbowCandidates(
      from.xIn,
      to.xIn,
      obstacles,
      'x',
      matchedSign,
    );
    for (const eX of elbows) {
      cands.push([
        pHFrom,
        { xIn: eX, yIn: from.yIn },
        { xIn: eX, yIn: to.yIn },
        pHTo,
      ]);
    }
    return cands;
  }

  // Same vertical anchor orientation → elbow varies along Y.
  if (!fromHorizontal && !toHorizontal) {
    const matchedSign = from.side === to.side ? outwardSign(from.side) : null;
    const elbows = elbowCandidates(
      from.yIn,
      to.yIn,
      obstacles,
      'y',
      matchedSign,
    );
    for (const eY of elbows) {
      cands.push([
        pHFrom,
        { xIn: from.xIn, yIn: eY },
        { xIn: to.xIn, yIn: eY },
        pHTo,
      ]);
    }
    return cands;
  }

  // Mixed orientations — two natural L-shapes.
  if (fromHorizontal) {
    cands.push([pHFrom, { xIn: to.xIn, yIn: from.yIn }, pHTo]);
    cands.push([pHFrom, { xIn: from.xIn, yIn: to.yIn }, pHTo]);
  } else {
    cands.push([pHFrom, { xIn: from.xIn, yIn: to.yIn }, pHTo]);
    cands.push([pHFrom, { xIn: to.xIn, yIn: from.yIn }, pHTo]);
  }
  return cands;
}

/**
 * Elbow positions along a 1D axis between leader endpoints `a` and `b`.
 *
 * When `outSign` is null (mixed orientation — one port vertical, one
 * horizontal), the elbow is free to live anywhere in [lo, hi] including
 * midpoints and just-outside-obstacle positions.
 *
 * When `outSign` is set (both ports share a side — both top, both right,
 * etc.), the elbow must be on the OUTWARD side of both leader endpoints
 * (≤ lo for sign=-1, ≥ hi for sign=+1). Any value strictly between fl
 * and tl would force a U-turn at one end (the leader exits the pedal
 * outward, then immediately reverses direction to reach the in-range
 * elbow). This shape is invariant when leader lengths are staggered per
 * cable for lane assignment.
 */
function elbowCandidates(
  a: number,
  b: number,
  obstacles: readonly ObstacleRect[],
  axis: 'x' | 'y',
  outSign: -1 | 1 | null,
): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const clearance = 0.3;
  const out: number[] = [];

  if (outSign === null) {
    const inRange = (v: number) => v >= lo && v <= hi;
    const candidates = [(a + b) / 2, a + (b - a) * 0.25, a + (b - a) * 0.75];
    for (const c of candidates) if (inRange(c)) out.push(c);
    for (const r of obstacles) {
      const rLo = axis === 'x' ? r.xIn : r.yIn;
      const rHi = rLo + (axis === 'x' ? r.widthIn : r.depthIn);
      if (rHi >= lo && rLo <= hi) {
        const before = rLo - clearance;
        const after = rHi + clearance;
        if (inRange(before)) out.push(before);
        if (inRange(after)) out.push(after);
      }
    }
  } else if (outSign === -1) {
    // Same outward direction (top/left): elbow must be ≤ lo.
    out.push(lo);
    out.push(lo - 0.4);
    out.push(lo - 0.8);
    out.push(lo - 1.2);
    for (const r of obstacles) {
      const rLo = axis === 'x' ? r.xIn : r.yIn;
      const v = rLo - clearance;
      if (v <= lo) out.push(v);
    }
  } else {
    // Same outward direction (bottom/right): elbow must be ≥ hi.
    out.push(hi);
    out.push(hi + 0.4);
    out.push(hi + 0.8);
    out.push(hi + 1.2);
    for (const r of obstacles) {
      const rLo = axis === 'x' ? r.xIn : r.yIn;
      const rHi = rLo + (axis === 'x' ? r.widthIn : r.depthIn);
      const v = rHi + clearance;
      if (v >= hi) out.push(v);
    }
  }
  if (out.length === 0) out.push((a + b) / 2);
  return out;
}

/**
 * 5-segment "go around" candidates. Used when no 3-segment Manhattan
 * works — typically when one of the endpoints' approach column passes
 * through the OTHER endpoint's pedal body.
 *
 * For same-vertical-side ports (both top / both bottom), the shape is:
 *   from → (a, from.y) → (a, b) → (c, b) → (c, to.y) → to
 * For same-horizontal-side (both left / both right), the X/Y roles flip.
 * For mixed orientation (one vertical, one horizontal), only one mid
 * coordinate is free; structure: from → (?, ?) → (?, ?) → (?, ?) → to
 * with directions matched to each leader.
 */
function generate5SegCandidates(
  from: { xIn: number; yIn: number; side: Side },
  to: { xIn: number; yIn: number; side: Side },
  obstacles: readonly ObstacleRect[],
): { xIn: number; yIn: number }[][] {
  const fh = from.side === 'left' || from.side === 'right';
  const th = to.side === 'left' || to.side === 'right';
  const pf = { xIn: from.xIn, yIn: from.yIn };
  const pt = { xIn: to.xIn, yIn: to.yIn };
  const cands: { xIn: number; yIn: number }[][] = [];
  const epsZero = 0.05;
  if (!fh && !th) {
    // Both vertical (top/bottom) — inner direction sequence X-Y-X-Y-X.
    const xEscapes = obstacleEdgeCandidates(obstacles, 'x');
    const yTransits = transitCandidates(from.yIn, to.yIn, obstacles, 'y');
    for (const a of xEscapes) {
      if (Math.abs(a - from.xIn) < epsZero) continue;
      for (const c of xEscapes) {
        if (Math.abs(c - to.xIn) < epsZero) continue;
        for (const b of yTransits) {
          if (Math.abs(b - from.yIn) < epsZero) continue;
          if (Math.abs(b - to.yIn) < epsZero) continue;
          cands.push([
            pf,
            { xIn: a, yIn: from.yIn },
            { xIn: a, yIn: b },
            { xIn: c, yIn: b },
            { xIn: c, yIn: to.yIn },
            pt,
          ]);
        }
      }
    }
    return cands;
  }
  if (fh && th) {
    // Both horizontal (left/right) — inner direction Y-X-Y-X-Y.
    const yEscapes = obstacleEdgeCandidates(obstacles, 'y');
    const xTransits = transitCandidates(from.xIn, to.xIn, obstacles, 'x');
    for (const a of yEscapes) {
      if (Math.abs(a - from.yIn) < epsZero) continue;
      for (const c of yEscapes) {
        if (Math.abs(c - to.yIn) < epsZero) continue;
        for (const b of xTransits) {
          if (Math.abs(b - from.xIn) < epsZero) continue;
          if (Math.abs(b - to.xIn) < epsZero) continue;
          cands.push([
            pf,
            { xIn: from.xIn, yIn: a },
            { xIn: b, yIn: a },
            { xIn: b, yIn: c },
            { xIn: to.xIn, yIn: c },
            pt,
          ]);
        }
      }
    }
    return cands;
  }
  // Mixed orientation. 4-inner-segment path with 2 free parameters.
  // Unlike same-side cables, mixed orientation has no valid "staple
  // outward" shape — the two leaders point in perpendicular directions.
  // BOTH transit values must stay in-range (between fl and tl on their
  // respective axes); a transit outside that range forces one segment
  // to exit in the OPPOSITE direction of the destination, creating a
  // visible U-turn at the leader endpoint.
  const yLo = Math.min(from.yIn, to.yIn);
  const yHi = Math.max(from.yIn, to.yIn);
  const xLo = Math.min(from.xIn, to.xIn);
  const xHi = Math.max(from.xIn, to.xIn);
  const yTransits = transitCandidates(from.yIn, to.yIn, obstacles, 'y');
  const xTransits = transitCandidates(from.xIn, to.xIn, obstacles, 'x');
  if (fh) {
    // from is horizontal (leader along X), to is vertical (leader along Y).
    // Inner direction: Y-X-Y-X.
    for (const a of yTransits) {
      if (a < yLo - epsZero || a > yHi + epsZero) continue;
      if (Math.abs(a - from.yIn) < epsZero) continue;
      if (Math.abs(a - to.yIn) < epsZero) continue;
      for (const b of xTransits) {
        if (b < xLo - epsZero || b > xHi + epsZero) continue;
        if (Math.abs(b - from.xIn) < epsZero) continue;
        if (Math.abs(b - to.xIn) < epsZero) continue;
        cands.push([
          pf,
          { xIn: from.xIn, yIn: a },
          { xIn: b, yIn: a },
          { xIn: b, yIn: to.yIn },
          pt,
        ]);
      }
    }
    return cands;
  }
  // from vertical, to horizontal — inner direction X-Y-X-Y.
  for (const a of xTransits) {
    if (a < xLo - epsZero || a > xHi + epsZero) continue;
    if (Math.abs(a - from.xIn) < epsZero) continue;
    if (Math.abs(a - to.xIn) < epsZero) continue;
    for (const b of yTransits) {
      if (b < yLo - epsZero || b > yHi + epsZero) continue;
      if (Math.abs(b - from.yIn) < epsZero) continue;
      if (Math.abs(b - to.yIn) < epsZero) continue;
      cands.push([
        pf,
        { xIn: a, yIn: from.yIn },
        { xIn: a, yIn: b },
        { xIn: to.xIn, yIn: b },
        pt,
      ]);
    }
  }
  return cands;
}

/** Candidate coordinates just outside each obstacle's axis extent. */
function obstacleEdgeCandidates(
  obstacles: readonly ObstacleRect[],
  axis: 'x' | 'y',
): number[] {
  const clearance = 0.3;
  const out: number[] = [];
  for (const r of obstacles) {
    if (axis === 'x') {
      out.push(r.xIn - clearance);
      out.push(r.xIn + r.widthIn + clearance);
    } else {
      out.push(r.yIn - clearance);
      out.push(r.yIn + r.depthIn + clearance);
    }
  }
  return out;
}

/**
 * Candidate "transit" coordinates: positions that traverse the gap
 * between two endpoints along one axis. Used for the middle segment of
 * a 5-segment detour. Includes positions just inside/outside obstacle
 * edges along the axis, plus outward extensions past the endpoint span.
 */
function transitCandidates(
  a: number,
  b: number,
  obstacles: readonly ObstacleRect[],
  axis: 'x' | 'y',
): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const clearance = 0.3;
  const out: number[] = [(a + b) / 2];
  for (const r of obstacles) {
    const rLo = axis === 'x' ? r.xIn : r.yIn;
    const rHi = rLo + (axis === 'x' ? r.widthIn : r.depthIn);
    out.push(rLo - clearance);
    out.push(rHi + clearance);
  }
  for (const d of [0.4, 0.8, 1.2]) {
    out.push(lo - d);
    out.push(hi + d);
  }
  return out;
}

/**
 * Visibility-grid A* router. Used as a third tier after the 3-segment
 * and 5-segment generators fail to find a clean path. Builds a sparse
 * grid from obstacle edges + endpoint coordinates, then searches over
 * (xi, yi, incomingDir) states with a turn penalty so the result
 * minimises corners ("unnecessary squiggles" per #41).
 *
 * Returns null when no clean orthogonal path exists between the leader
 * endpoints — callers should fall through to the dirty fallback in that
 * case.
 *
 * The grid resolution is intentionally coarse: nodes only sit at
 * obstacle edges (with a small epsilon margin) and at the supplied
 * endpoints. By a classical visibility-graph result, the optimal
 * orthogonal path's corners always lie on those lines, so a finer grid
 * would just slow A* down without finding better paths.
 *
 * U-turn avoidance: the first move out of the start node and the last
 * move into the end node are masked so the cable can't double back over
 * its own leader at either pedal.
 */
function routeAStar(
  from: { xIn: number; yIn: number; side: Side },
  to: { xIn: number; yIn: number; side: Side },
  obstacles: readonly ObstacleRect[],
  options: RouteOptions,
): { xIn: number; yIn: number }[] | null {
  const EDGE_EPS = 0.02;
  const xsRaw: number[] = [from.xIn, to.xIn];
  const ysRaw: number[] = [from.yIn, to.yIn];
  for (const r of obstacles) {
    xsRaw.push(r.xIn - EDGE_EPS, r.xIn + r.widthIn + EDGE_EPS);
    ysRaw.push(r.yIn - EDGE_EPS, r.yIn + r.depthIn + EDGE_EPS);
  }
  // Include a small "outer rail" past the board edge so paths can wrap
  // around obstacles that touch the rim without leaving the grid.
  if (options.boardWidthIn !== undefined) {
    xsRaw.push(-0.5, options.boardWidthIn + 0.5);
  }
  if (options.boardDepthIn !== undefined) {
    ysRaw.push(-0.5, options.boardDepthIn + 0.5);
  }
  const xs = sortedDedupNumbers(xsRaw, 0.005);
  const ys = sortedDedupNumbers(ysRaw, 0.005);
  const nx = xs.length;
  const ny = ys.length;
  if (nx < 2 || ny < 2) return null;
  const findIdx = (arr: number[], v: number): number => {
    let best = 0;
    let bestD = Math.abs(arr[0]! - v);
    for (let i = 1; i < arr.length; i++) {
      const d = Math.abs(arr[i]! - v);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const startXi = findIdx(xs, from.xIn);
  const startYi = findIdx(ys, from.yIn);
  const endXi = findIdx(xs, to.xIn);
  const endYi = findIdx(ys, to.yIn);

  const segmentClear = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ): boolean => {
    const a = { xIn: ax, yIn: ay };
    const b = { xIn: bx, yIn: by };
    for (const r of obstacles) {
      if (segmentHitsRect(a, b, r)) return false;
    }
    return true;
  };

  // Direction codes: 0=up (yi-1), 1=down (yi+1), 2=left (xi-1), 3=right
  // (xi+1). dir=4 is the "no incoming direction" state used only at the
  // start node so the first move doesn't pay a turn penalty.
  const DIRS = 5;
  const dirDelta: readonly (readonly [number, number])[] = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  const reverseDir = (d: number): number => {
    if (d === 0) return 1;
    if (d === 1) return 0;
    if (d === 2) return 3;
    return 2;
  };
  const sideDir = (side: Side): number => {
    switch (side) {
      case 'top':
        return 0;
      case 'bottom':
        return 1;
      case 'left':
        return 2;
      case 'right':
        return 3;
    }
  };
  const fromOutDir = sideDir(from.side);
  const toOutDir = sideDir(to.side);
  // First move out of the start node can't reverse the leader (the
  // leader already extended in fromOutDir — reversing it walks back
  // into the source pedal). The last move into the end node can't be
  // in toOutDir (that would arrive going outward past the leader-tip
  // and U-turn into the dest pedal).
  const bannedFromStart = reverseDir(fromOutDir);
  const bannedIntoEnd = toOutDir;

  const TURN_PENALTY = 0.5;
  const OFF_BOARD_PENALTY = 25.0;
  const LANE_TOL = 0.4;
  const LANE_PENALTY = 5.0;
  const boardW = options.boardWidthIn;
  const boardD = options.boardDepthIn;
  const claimedY = options.claimedY ?? [];
  const claimedX = options.claimedX ?? [];

  const nodeIdx = (xi: number, yi: number): number => xi * ny + yi;
  const stateIdx = (xi: number, yi: number, dir: number): number =>
    nodeIdx(xi, yi) * DIRS + dir;
  const numStates = nx * ny * DIRS;
  const g = new Float64Array(numStates);
  g.fill(Number.POSITIVE_INFINITY);
  const parent = new Int32Array(numStates);
  parent.fill(-1);

  interface HeapItem {
    f: number;
    state: number;
  }
  const heap: HeapItem[] = [];
  const heapPush = (item: HeapItem): void => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]!.f <= heap[i]!.f) break;
      const tmp = heap[p]!;
      heap[p] = heap[i]!;
      heap[i] = tmp;
      i = p;
    }
  };
  const heapPop = (): HeapItem | undefined => {
    if (heap.length === 0) return undefined;
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      const n = heap.length;
      while (true) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < n && heap[l]!.f < heap[smallest]!.f) smallest = l;
        if (r < n && heap[r]!.f < heap[smallest]!.f) smallest = r;
        if (smallest === i) break;
        const tmp = heap[smallest]!;
        heap[smallest] = heap[i]!;
        heap[i] = tmp;
        i = smallest;
      }
    }
    return top;
  };

  const heuristic = (xi: number, yi: number): number =>
    Math.abs(xs[xi]! - xs[endXi]!) + Math.abs(ys[yi]! - ys[endYi]!);

  const startState = stateIdx(startXi, startYi, 4);
  g[startState] = 0;
  heapPush({ f: heuristic(startXi, startYi), state: startState });

  let foundState = -1;
  // Generous safety bound: state space is small (≤ 5 * nx * ny) but
  // capping prevents runaway in pathological fixtures.
  const ITERATION_CAP = numStates * 4;
  let iterations = 0;
  while (heap.length > 0 && iterations < ITERATION_CAP) {
    iterations += 1;
    const top = heapPop()!;
    const state = top.state;
    const dir = state % DIRS;
    const node = (state - dir) / DIRS;
    const yi = node % ny;
    const xi = (node - yi) / ny;
    // Stale heap entry — accept the current best and move on.
    if (top.f > g[state]! + heuristic(xi, yi) + 1e-6) continue;
    if (xi === endXi && yi === endYi && dir !== bannedIntoEnd) {
      foundState = state;
      break;
    }
    for (let nd = 0; nd < 4; nd++) {
      // Block the U-turn moves at start / end.
      if (dir === 4 && nd === bannedFromStart) continue;
      // Block 180° in-path reversals. dedupeColinear collapses three
      // colinear vertices into two, hiding the back-and-forth and
      // turning the visual polyline into what looks like a direct
      // U-turn at the previous vertex. Forbidding the reversal in
      // A* itself keeps the rendered cable honest.
      if (dir !== 4 && nd === reverseDir(dir)) continue;
      const delta = dirDelta[nd]!;
      const nxi = xi + delta[0];
      const nyi = yi + delta[1];
      if (nxi < 0 || nxi >= nx || nyi < 0 || nyi >= ny) continue;
      if (!segmentClear(xs[xi]!, ys[yi]!, xs[nxi]!, ys[nyi]!)) continue;
      const dx = Math.abs(xs[nxi]! - xs[xi]!);
      const dy = Math.abs(ys[nyi]! - ys[yi]!);
      const segLen = dx + dy;
      if (segLen < 1e-6) continue; // duplicate node from dedup edge case
      let edge = segLen;
      if (dir !== 4 && dir !== nd) edge += TURN_PENALTY;
      // Lane-reuse penalty (bounded MAX, not sum) — matches the
      // pathScore formula so 3-seg/5-seg/A* are scored on the same
      // basis. Only long moves count as "lane" segments; short hops
      // through the grid don't claim a lane on their own.
      if (segLen > 0.5) {
        let worst = 0;
        if (delta[1] !== 0) {
          // Vertical-axis move — segment lives at xs[xi].
          const x = xs[xi]!;
          for (const cx of claimedX) {
            const d = Math.abs(x - cx);
            if (d < LANE_TOL) {
              const p = LANE_PENALTY * (1 - d / LANE_TOL);
              if (p > worst) worst = p;
            }
          }
        } else {
          const y = ys[yi]!;
          for (const cy of claimedY) {
            const d = Math.abs(y - cy);
            if (d < LANE_TOL) {
              const p = LANE_PENALTY * (1 - d / LANE_TOL);
              if (p > worst) worst = p;
            }
          }
        }
        edge += worst;
      }
      if (boardW !== undefined && boardD !== undefined) {
        const px = xs[nxi]!;
        const py = ys[nyi]!;
        const overshoot =
          Math.max(0, -px) +
          Math.max(0, px - boardW) +
          Math.max(0, -py) +
          Math.max(0, py - boardD);
        if (overshoot > 0) edge += OFF_BOARD_PENALTY * overshoot;
      }
      const newG = g[state]! + edge;
      const newState = stateIdx(nxi, nyi, nd);
      if (newG < g[newState]!) {
        g[newState] = newG;
        parent[newState] = state;
        heapPush({ f: newG + heuristic(nxi, nyi), state: newState });
      }
    }
  }

  if (foundState === -1) return null;

  // Reconstruct path back to start.
  const pts: { xIn: number; yIn: number }[] = [];
  let cur = foundState;
  while (cur !== -1) {
    const dir = cur % DIRS;
    const node = (cur - dir) / DIRS;
    const yi = node % ny;
    const xi = (node - yi) / ny;
    pts.push({ xIn: xs[xi]!, yIn: ys[yi]! });
    cur = parent[cur]!;
  }
  pts.reverse();
  return pts;
}

function sortedDedupNumbers(values: number[], tol: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || Math.abs(v - out[out.length - 1]!) > tol) {
      out.push(v);
    }
  }
  return out;
}

/**
 * Remove consecutive colinear / zero-length points so 5-segment paths
 * that degenerate to 3-segment shapes don't carry vestigial corners.
 */
function dedupeColinear(
  pts: readonly { xIn: number; yIn: number }[],
): { xIn: number; yIn: number }[] {
  if (pts.length < 3) return pts.slice();
  const out: { xIn: number; yIn: number }[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[out.length - 1]!;
    const cur = pts[i]!;
    if (
      Math.abs(cur.xIn - prev.xIn) < 0.001 &&
      Math.abs(cur.yIn - prev.yIn) < 0.001
    ) {
      continue; // zero-length
    }
    if (out.length >= 2) {
      const a = out[out.length - 2]!;
      const b = prev;
      const c = cur;
      const colinear =
        (Math.abs(a.xIn - b.xIn) < 0.001 && Math.abs(b.xIn - c.xIn) < 0.001) ||
        (Math.abs(a.yIn - b.yIn) < 0.001 && Math.abs(b.yIn - c.yIn) < 0.001);
      if (colinear) {
        out[out.length - 1] = cur;
        continue;
      }
    }
    out.push(cur);
  }
  return out;
}
