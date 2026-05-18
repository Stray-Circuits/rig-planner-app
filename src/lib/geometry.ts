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

/**
 * Orthogonal 3-segment cable path between two points. If the points share an
 * X or Y coordinate the cable is a single straight segment; otherwise we
 * choose an intermediate axis based on which side each endpoint anchors to.
 *
 * Returns a polyline as an array of {x, y} in the same units as the inputs.
 */
export function routeCablePath(
  from: { xIn: number; yIn: number; side: Side },
  to: { xIn: number; yIn: number; side: Side },
): { xIn: number; yIn: number }[] {
  // Straight cable if endpoints are essentially colinear.
  const dx = Math.abs(to.xIn - from.xIn);
  const dy = Math.abs(to.yIn - from.yIn);
  if (dx < 0.05 || dy < 0.05) {
    return [
      { xIn: from.xIn, yIn: from.yIn },
      { xIn: to.xIn, yIn: to.yIn },
    ];
  }
  // Decide whether the elbow runs horizontally first (from side is top/bottom)
  // or vertically first (left/right). This keeps the cable's first segment
  // leaving perpendicular to the pedal edge.
  const fromHorizontal = from.side === 'left' || from.side === 'right';
  const toHorizontal = to.side === 'left' || to.side === 'right';

  if (fromHorizontal && toHorizontal) {
    // Both anchors face horizontally → elbow uses two horizontal segments
    // around a midpoint X.
    const midX = (from.xIn + to.xIn) / 2;
    return [
      { xIn: from.xIn, yIn: from.yIn },
      { xIn: midX, yIn: from.yIn },
      { xIn: midX, yIn: to.yIn },
      { xIn: to.xIn, yIn: to.yIn },
    ];
  }
  if (!fromHorizontal && !toHorizontal) {
    const midY = (from.yIn + to.yIn) / 2;
    return [
      { xIn: from.xIn, yIn: from.yIn },
      { xIn: from.xIn, yIn: midY },
      { xIn: to.xIn, yIn: midY },
      { xIn: to.xIn, yIn: to.yIn },
    ];
  }
  // Mixed: from horizontal anchor leaves horizontally, then turns to meet
  // the vertical anchor's column.
  if (fromHorizontal) {
    return [
      { xIn: from.xIn, yIn: from.yIn },
      { xIn: to.xIn, yIn: from.yIn },
      { xIn: to.xIn, yIn: to.yIn },
    ];
  }
  return [
    { xIn: from.xIn, yIn: from.yIn },
    { xIn: from.xIn, yIn: to.yIn },
    { xIn: to.xIn, yIn: to.yIn },
  ];
}
