import type {
  JackSize,
  Pedal,
  PlacedPedal,
  Port,
  Rig,
  Side,
} from '../data/schema';
import { routeSingleCable } from './channelRouter';

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
  /**
   * Per-segment claimed lanes with their perpendicular extent.
   * Used for the cross-penalty so we only penalize a horizontal that
   * would VISUALLY cross a prior cable's vertical (i.e. the prior
   * vertical's y range includes the horizontal's y). Without ranges,
   * the cross-penalty pessimistically fires whenever the X falls
   * within the horizontal's x span — which over-penalizes incidental
   * crossings outside the prior cable's visible footprint.
   */
  claimedVerticals?: readonly { xIn: number; yMin: number; yMax: number }[];
  claimedHorizontals?: readonly { yIn: number; xMin: number; xMax: number }[];
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
 * Manhattan cable path with port-perpendicular leader segments. Thin
 * shim around the channel-graph router (`channelRouter.routeSingleCable`).
 * Callers batching many cables should prefer `routeAllCables` so the
 * router can balance lane usage globally; this single-cable entry
 * point is for legacy call sites and tests.
 */
export function routeCableWithLeader(
  from: { xIn: number; yIn: number; side: Side },
  to: { xIn: number; yIn: number; side: Side },
  obstacles: readonly ObstacleRect[] = [],
  options: RouteOptions = {},
  leaderIn = 0.4,
  obstacleMarginIn = 0.15,
): { xIn: number; yIn: number }[] {
  const opts: RouteOptions = {
    ...options,
    obstacleMarginIn: options.obstacleMarginIn ?? obstacleMarginIn,
    fromLeaderIn: options.fromLeaderIn ?? leaderIn,
    toLeaderIn: options.toLeaderIn ?? leaderIn,
  };
  return routeSingleCable(from, to, obstacles, opts);
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
  horizontals: { yIn: number; xMin: number; xMax: number }[];
  verticals: { xIn: number; yMin: number; yMax: number }[];
} {
  const horizontalY: number[] = [];
  const verticalX: number[] = [];
  const horizontals: { yIn: number; xMin: number; xMax: number }[] = [];
  const verticals: { xIn: number; yMin: number; yMax: number }[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const dx = Math.abs(b.xIn - a.xIn);
    const dy = Math.abs(b.yIn - a.yIn);
    if (dy < 0.001 && dx > 0.5) {
      horizontalY.push(a.yIn);
      horizontals.push({
        yIn: a.yIn,
        xMin: Math.min(a.xIn, b.xIn),
        xMax: Math.max(a.xIn, b.xIn),
      });
    } else if (dx < 0.001 && dy > 0.5) {
      verticalX.push(a.xIn);
      verticals.push({
        xIn: a.xIn,
        yMin: Math.min(a.yIn, b.yIn),
        yMax: Math.max(a.yIn, b.yIn),
      });
    }
  }
  return { horizontalY, verticalX, horizontals, verticals };
}

/**
 * Orthogonal cable path between two points (no leader extension —
 * `from` and `to` are routed verbatim). Thin shim around the
 * channel-graph router for callers that want raw point-to-point
 * routing.
 */
export function routeCablePath(
  from: { xIn: number; yIn: number; side: Side },
  to: { xIn: number; yIn: number; side: Side },
  obstacles: readonly ObstacleRect[] = [],
  options: RouteOptions = {},
): { xIn: number; yIn: number }[] {
  const opts: RouteOptions = {
    ...options,
    fromLeaderIn: 0,
    toLeaderIn: 0,
  };
  return routeSingleCable(from, to, obstacles, opts);
}
