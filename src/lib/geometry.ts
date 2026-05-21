import type { Pedal, PlacedPedal, Port, Rig, Side } from '../data/schema';

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
 * each side that has at least one jack (audio or MIDI) so cables and
 * jack barrels have room to live. Used to render translucent shadow
 * strips around pedals and to flag overlap.
 *
 * Returned in board (inch) coordinates. May extend off the board; callers
 * should clip to rig bounds when rendering.
 *
 * 0.625" matches the body of a standard 1/4" jack plug — the room a
 * cable barrel actually needs before it bends. Bigger values (e.g. the
 * old 1.0") were too pessimistic and produced overlap warnings on tight
 * but real-world layouts.
 */
export const KEEP_OUT_INCHES = 0.625;

export function keepOutRect(
  placed: PlacedPedal,
  pedal: Pedal,
): { xIn: number; yIn: number; widthIn: number; depthIn: number } {
  const { widthIn, depthIn } = placedFootprint(pedal, placed.rotation);
  // Translate each logical jack-bearing side to its visual side after
  // rotation, then accumulate which visual sides should be padded.
  const visualSides = new Set<Side>();
  const j = pedal.jackSides;
  const addIf = (cond: boolean, logical: Side) => {
    if (cond) visualSides.add(rotatedSide(logical, placed.rotation));
  };
  addIf(j.top || j.midi_top, 'top');
  addIf(j.bottom || j.midi_bottom, 'bottom');
  addIf(j.left || j.midi_left, 'left');
  addIf(j.right || j.midi_right, 'right');
  const padTop = visualSides.has('top') ? KEEP_OUT_INCHES : 0;
  const padBot = visualSides.has('bottom') ? KEEP_OUT_INCHES : 0;
  const padLeft = visualSides.has('left') ? KEEP_OUT_INCHES : 0;
  const padRight = visualSides.has('right') ? KEEP_OUT_INCHES : 0;
  return {
    xIn: placed.xIn - padLeft,
    yIn: placed.yIn - padTop,
    widthIn: widthIn + padLeft + padRight,
    depthIn: depthIn + padTop + padBot,
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
): Set<string> {
  const rects = placed
    .map((p) => {
      const def = pedalsById.get(p.pedalId);
      return def ? { id: p.id, rect: keepOutRect(p, def) } : null;
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
 * Returns the position (in inches, board coordinates) of a port on a placed
 * pedal. Ports are distributed evenly along the visible side, ordered by the
 * port's `sideOrder` among same-side siblings.
 */
export function portPositionOnBoard(
  placed: PlacedPedal,
  pedal: Pedal,
  port: Port,
): { xIn: number; yIn: number } {
  const { widthIn, depthIn } = placedFootprint(pedal, placed.rotation);
  const visualSide = rotatedSide(port.side, placed.rotation);
  // Find all ports that share this same visual side, sorted by sideOrder.
  const siblings = pedal.ports
    .filter((p) => rotatedSide(p.side, placed.rotation) === visualSide)
    .sort((a, b) => a.sideOrder - b.sideOrder);
  const idx = Math.max(
    0,
    siblings.findIndex((p) => p.id === port.id),
  );
  const fraction = (idx + 1) / (siblings.length + 1);

  switch (visualSide) {
    case 'top':
      return { xIn: placed.xIn + widthIn * fraction, yIn: placed.yIn };
    case 'bottom':
      return {
        xIn: placed.xIn + widthIn * fraction,
        yIn: placed.yIn + depthIn,
      };
    case 'left':
      return { xIn: placed.xIn, yIn: placed.yIn + depthIn * fraction };
    case 'right':
      return {
        xIn: placed.xIn + widthIn,
        yIn: placed.yIn + depthIn * fraction,
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

/**
 * Orthogonal 3-segment cable path between two points. Generates several
 * candidate Manhattan routes (varying the elbow position) and returns the
 * first one that doesn't cross any obstacle. Falls back to the natural
 * mid-point route if no candidate is clean.
 *
 * `obstacles` should NOT include the pedals owning the from/to ports —
 * the cable necessarily touches their edges.
 *
 * Returns a polyline as an array of {x, y} in the same units as the inputs.
 */
export function routeCablePath(
  from: { xIn: number; yIn: number; side: Side },
  to: { xIn: number; yIn: number; side: Side },
  obstacles: readonly ObstacleRect[] = [],
): { xIn: number; yIn: number }[] {
  // Straight cable if endpoints are essentially colinear AND the straight
  // line doesn't cross any obstacle.
  const dx = Math.abs(to.xIn - from.xIn);
  const dy = Math.abs(to.yIn - from.yIn);
  if (dx < 0.05 || dy < 0.05) {
    const straight = [
      { xIn: from.xIn, yIn: from.yIn },
      { xIn: to.xIn, yIn: to.yIn },
    ];
    if (!pathHitsAny(straight, obstacles)) return straight;
    // Otherwise fall through to elbowed candidates — note that a perfectly
    // colinear cable can't truly detour with just a 3-segment Manhattan
    // path, so the obstacle will still be hit. Real ports rarely line up
    // exactly so this is an edge case.
  }

  const candidates = generateRouteCandidates(from, to, obstacles);
  for (const path of candidates) {
    if (!pathHitsAny(path, obstacles)) return path;
  }
  // No clean route — return the first candidate so something draws.
  return candidates[0]!;
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
    const elbows = elbowCandidates(from.xIn, to.xIn, obstacles, 'x');
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
    const elbows = elbowCandidates(from.yIn, to.yIn, obstacles, 'y');
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

  // Mixed orientations — two natural L-shapes plus their detour variants.
  if (fromHorizontal) {
    // Prefer "horizontal first, then vertical".
    cands.push([pHFrom, { xIn: to.xIn, yIn: from.yIn }, pHTo]);
    cands.push([pHFrom, { xIn: from.xIn, yIn: to.yIn }, pHTo]);
  } else {
    cands.push([pHFrom, { xIn: from.xIn, yIn: to.yIn }, pHTo]);
    cands.push([pHFrom, { xIn: to.xIn, yIn: from.yIn }, pHTo]);
  }
  return cands;
}

/**
 * Suggest elbow positions along a 1D axis between `a` and `b`. Includes the
 * midpoint plus offsets, plus positions that route just outside each
 * obstacle's extent on that axis so a cable can sidestep a pedal.
 */
function elbowCandidates(
  a: number,
  b: number,
  obstacles: readonly ObstacleRect[],
  axis: 'x' | 'y',
): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const out: number[] = [(a + b) / 2, a + (b - a) * 0.25, a + (b - a) * 0.75];
  const clearance = 0.6;
  for (const r of obstacles) {
    const rLo = axis === 'x' ? r.xIn : r.yIn;
    const rHi = rLo + (axis === 'x' ? r.widthIn : r.depthIn);
    if (rHi >= lo && rLo <= hi) {
      // Obstacle is in the cable's axial span — try going just outside it.
      out.push(rLo - clearance);
      out.push(rHi + clearance);
    }
  }
  return out;
}
