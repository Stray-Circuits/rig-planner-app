import { describe, expect, it } from 'vitest';
import { routeCableWithLeader, type ObstacleRect } from '../src/lib/geometry';
import type { Side } from '../src/data/schema';

/**
 * Issue #41 fixture: two rows of pedals with deliberately crossing
 * inter-row connections. Each cable must reach its destination without
 * crossing any pedal body. This was the original failure mode — the
 * 3-seg + 5-seg generators couldn't cover routes that need to wrap
 * around a third pedal, so the dirty fallback fired and cables visibly
 * cut across other pedals on the deck.
 */

const PEDAL_W = 2.6;
const PEDAL_D = 4.7;

// Two rows of three pedals each, evenly spaced across a 24×12 board.
// Row A sits along the top (y ≈ 0.5); row B along the bottom
// (y ≈ 6.8). All ports face inward (row A's "bottom" side, row B's
// "top" side) so cables have to navigate the open lane between rows
// *and* the gaps between pedals when destinations don't line up.
function row(yIn: number, count: number, leftIn = 1, gapIn = 1.4) {
  const rects: ObstacleRect[] = [];
  for (let i = 0; i < count; i++) {
    rects.push({
      xIn: leftIn + i * (PEDAL_W + gapIn),
      yIn,
      widthIn: PEDAL_W,
      depthIn: PEDAL_D,
    });
  }
  return rects;
}

interface PortOnSide {
  rect: ObstacleRect;
  side: Side;
  /** 0..1 fraction along the chosen side. */
  along: number;
}

function portPoint(p: PortOnSide): { xIn: number; yIn: number; side: Side } {
  const r = p.rect;
  switch (p.side) {
    case 'top':
      return { xIn: r.xIn + r.widthIn * p.along, yIn: r.yIn, side: 'top' };
    case 'bottom':
      return {
        xIn: r.xIn + r.widthIn * p.along,
        yIn: r.yIn + r.depthIn,
        side: 'bottom',
      };
    case 'left':
      return { xIn: r.xIn, yIn: r.yIn + r.depthIn * p.along, side: 'left' };
    case 'right':
      return {
        xIn: r.xIn + r.widthIn,
        yIn: r.yIn + r.depthIn * p.along,
        side: 'right',
      };
  }
}

function segCrossesRect(
  a: { xIn: number; yIn: number },
  b: { xIn: number; yIn: number },
  r: ObstacleRect,
): boolean {
  const eps = 0.05;
  const minX = Math.min(a.xIn, b.xIn);
  const maxX = Math.max(a.xIn, b.xIn);
  const minY = Math.min(a.yIn, b.yIn);
  const maxY = Math.max(a.yIn, b.yIn);
  return (
    maxX > r.xIn + eps &&
    minX < r.xIn + r.widthIn - eps &&
    maxY > r.yIn + eps &&
    minY < r.yIn + r.depthIn - eps
  );
}

function pathCrossesAny(
  path: { xIn: number; yIn: number }[],
  rects: ObstacleRect[],
  ownRects: ObstacleRect[],
): { idx: number; rect: ObstacleRect } | null {
  // Only the inner segments (after the leader, before the final leader)
  // matter — the cable physically *starts* on the source pedal's edge
  // and *ends* on the destination's edge, so the first and last segments
  // trivially "touch" their own pedals. Anything else crossing any
  // pedal — including the source/destination interior — is a failure.
  for (let i = 1; i < path.length - 2; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    for (const r of rects) {
      if (ownRects.includes(r)) continue;
      if (segCrossesRect(a, b, r)) return { idx: i, rect: r };
    }
  }
  return null;
}

describe('issue #41 — cable routing over pedals', () => {
  it('routes the two-row crossing fixture without any pedal crossings', () => {
    // Row A (top of board): three pedals, ports on bottom edge.
    const rowA = row(0.6, 3);
    // Row B (lower half): three pedals, ports on top edge.
    const rowB = row(6.8, 3);
    const allRects = [...rowA, ...rowB];

    // Build crossing inter-row connections: A1→B3, A3→B1, A2→B2.
    // The first two cross the third pedal in their own row if routed
    // naively; A2→B2 is the easy straight-line baseline.
    const conns: { from: PortOnSide; to: PortOnSide }[] = [
      {
        from: { rect: rowA[0]!, side: 'bottom', along: 0.7 },
        to: { rect: rowB[2]!, side: 'top', along: 0.3 },
      },
      {
        from: { rect: rowA[2]!, side: 'bottom', along: 0.3 },
        to: { rect: rowB[0]!, side: 'top', along: 0.7 },
      },
      {
        from: { rect: rowA[1]!, side: 'bottom', along: 0.5 },
        to: { rect: rowB[1]!, side: 'top', along: 0.5 },
      },
    ];

    for (const { from, to } of conns) {
      const fp = portPoint(from);
      const tp = portPoint(to);
      const path = routeCableWithLeader(fp, tp, allRects, {
        boardWidthIn: 24,
        boardDepthIn: 12,
      });
      const hit = pathCrossesAny(path, allRects, [from.rect, to.rect]);
      if (hit) {
        const printable = path.map(
          (p) => `(${p.xIn.toFixed(2)}, ${p.yIn.toFixed(2)})`,
        );
        throw new Error(
          `Cable from (${fp.xIn},${fp.yIn})→(${tp.xIn},${tp.yIn}) crossed a foreign pedal at segment ${hit.idx}. Path: ${printable.join(' → ')}`,
        );
      }
    }
  });

  it('routes a same-row crossover cable around the middle pedal', () => {
    // Three pedals in a single row, all with bottom-side ports. A cable
    // from pedal 0 to pedal 2 (both bottom ports) has to detour around
    // pedal 1 — the straight Z-path would cut through it.
    const rects = row(0.6, 3);
    const fp = portPoint({ rect: rects[0]!, side: 'bottom', along: 0.5 });
    const tp = portPoint({ rect: rects[2]!, side: 'bottom', along: 0.5 });
    const path = routeCableWithLeader(fp, tp, rects, {
      boardWidthIn: 24,
      boardDepthIn: 12,
    });
    const hit = pathCrossesAny(path, rects, [rects[0]!, rects[2]!]);
    expect(hit).toBeNull();
  });

  it('keeps the inter-row baseline cable straight (no unnecessary squiggles)', () => {
    // The straight A2→B2 case should still resolve to a clean
    // 3-segment Z-shape — A* must NOT replace it with a longer wrap.
    // We assert the routed path has ≤ 5 unique vertices (leader + Z
    // + leader = 5 max). Anything more means the router took a detour
    // it didn't need.
    const rowA = row(0.6, 3);
    const rowB = row(6.8, 3);
    const allRects = [...rowA, ...rowB];
    const fp = portPoint({ rect: rowA[1]!, side: 'bottom', along: 0.5 });
    const tp = portPoint({ rect: rowB[1]!, side: 'top', along: 0.5 });
    const path = routeCableWithLeader(fp, tp, allRects, {
      boardWidthIn: 24,
      boardDepthIn: 12,
    });
    expect(path.length).toBeLessThanOrEqual(5);
  });

  it('threads a three-obstacle comb that the 5-seg generator cannot express', () => {
    // Three blockers alternating top-bottom-top across the source-dest
    // span. A clean route needs THREE horizontal lanes (under B1, over
    // B2, under B3), but `generate5SegCandidates` is restricted to two
    // — its Y-X-Y-X-Y structure has only `a` and `c` as Y-escapes. The
    // A* tier is the only one that can find this without crossing.
    const src: ObstacleRect = { xIn: 1, yIn: 5, widthIn: 1.5, depthIn: 2 };
    const dst: ObstacleRect = { xIn: 17, yIn: 5, widthIn: 1.5, depthIn: 2 };
    const B1: ObstacleRect = { xIn: 4, yIn: 0, widthIn: 2, depthIn: 6.2 };
    const B2: ObstacleRect = { xIn: 8.5, yIn: 5.8, widthIn: 2, depthIn: 6.2 };
    const B3: ObstacleRect = { xIn: 13, yIn: 0, widthIn: 2, depthIn: 6.2 };
    const all = [src, dst, B1, B2, B3];
    const fp = portPoint({ rect: src, side: 'right', along: 0.5 });
    const tp = portPoint({ rect: dst, side: 'left', along: 0.5 });
    const path = routeCableWithLeader(fp, tp, all, {
      boardWidthIn: 24,
      boardDepthIn: 12,
    });
    const hit = pathCrossesAny(path, all, [src, dst]);
    if (hit) {
      const printable = path.map(
        (p) => `(${p.xIn.toFixed(2)}, ${p.yIn.toFixed(2)})`,
      );
      throw new Error(
        `Comb cable crossed a foreign pedal at segment ${hit.idx}. Path: ${printable.join(' → ')}`,
      );
    }
  });

  it('finds a clean path through a slalom that defeats 3-seg and 5-seg', () => {
    // Forces the A* tier: a horizontal slalom of three offset blockers
    // between the source and destination. Each blocker forces the
    // cable to switch lane; no 3-seg Z or single-wrap 5-seg covers it.
    //
    // Layout (board is 24 × 12):
    //   src ●─────────────────────────● dst        y=6
    //              ▓▓▓▓▓                           y=0..5  (B1: forces under)
    //                          ▓▓▓▓▓               y=4..9  (B2: forces over)
    //                                  ▓▓▓▓▓       y=3..8  (B3: forces under)
    //
    // The straight Z hits B2 at y=6. Wrapping over B1 then under B2
    // then over B3 needs ≥7 segments, which neither the 3-seg nor
    // 5-seg generators emit.
    const src: ObstacleRect = { xIn: 1, yIn: 4, widthIn: 2.6, depthIn: 4 };
    const dst: ObstacleRect = { xIn: 20.4, yIn: 4, widthIn: 2.6, depthIn: 4 };
    const B1: ObstacleRect = { xIn: 6, yIn: 0, widthIn: 2.4, depthIn: 5 };
    const B2: ObstacleRect = { xIn: 10.5, yIn: 4, widthIn: 2.4, depthIn: 5 };
    const B3: ObstacleRect = { xIn: 15, yIn: 3, widthIn: 2.4, depthIn: 5 };
    const all = [src, dst, B1, B2, B3];
    const fp = portPoint({ rect: src, side: 'right', along: 0.5 });
    const tp = portPoint({ rect: dst, side: 'left', along: 0.5 });
    const path = routeCableWithLeader(fp, tp, all, {
      boardWidthIn: 24,
      boardDepthIn: 12,
    });
    const hit = pathCrossesAny(path, all, [src, dst]);
    if (hit) {
      const printable = path.map(
        (p) => `(${p.xIn.toFixed(2)}, ${p.yIn.toFixed(2)})`,
      );
      throw new Error(
        `Slalom cable crossed a foreign pedal at segment ${hit.idx}. Path: ${printable.join(' → ')}`,
      );
    }
  });

  it('routes a cable that has to wrap two pedals between its endpoints', () => {
    // Source on the left, destination on the right, with two pedals
    // stacked vertically between them blocking every straight 3-seg
    // and most 5-seg routes. The router must wrap around the stack.
    const blocker1: ObstacleRect = {
      xIn: 8,
      yIn: 1,
      widthIn: 2.6,
      depthIn: 4,
    };
    const blocker2: ObstacleRect = {
      xIn: 8,
      yIn: 6.5,
      widthIn: 2.6,
      depthIn: 4,
    };
    const sourceRect: ObstacleRect = {
      xIn: 2,
      yIn: 4,
      widthIn: 2.6,
      depthIn: 4,
    };
    const destRect: ObstacleRect = {
      xIn: 16,
      yIn: 4,
      widthIn: 2.6,
      depthIn: 4,
    };
    const fp = portPoint({ rect: sourceRect, side: 'right', along: 0.5 });
    const tp = portPoint({ rect: destRect, side: 'left', along: 0.5 });
    const path = routeCableWithLeader(
      fp,
      tp,
      [sourceRect, destRect, blocker1, blocker2],
      { boardWidthIn: 24, boardDepthIn: 12 },
    );
    const hit = pathCrossesAny(
      path,
      [sourceRect, destRect, blocker1, blocker2],
      [sourceRect, destRect],
    );
    expect(hit).toBeNull();
  });
});
