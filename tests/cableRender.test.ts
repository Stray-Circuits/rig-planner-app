/**
 * Unit tests for cable rendering helpers. These complement
 * `mainBoardRouting.test.ts` (which runs the full pipeline on a
 * real fixture) by locking in specific behaviour of individual
 * helpers — most importantly the obstacle-aware leader clamp that
 * fixes the "leader pierces a neighbour" bug from #41.
 */
import { describe, expect, it } from 'vitest';
import {
  applyLaneRenderOffsets,
  maxSafeLeaderLength,
} from '../src/canvas/cableRender';
import type { ObstacleRect } from '../src/lib/geometry';

describe('maxSafeLeaderLength', () => {
  it('returns the requested length when no obstacle is on the leader path', () => {
    const port = { xIn: 5, yIn: 5, side: 'top' as const };
    const sourceRect: ObstacleRect = {
      xIn: 3,
      yIn: 5,
      widthIn: 4,
      depthIn: 4,
    };
    const safe = maxSafeLeaderLength(port, sourceRect, [sourceRect], 0.6);
    expect(safe).toBe(0.6);
  });

  it('caps the leader so it stops short of a neighbouring obstacle', () => {
    // Replicates the Tabby Terror → Tortie Tude case from the Main
    // board fixture. Tabby top-edge port at (14.5, 6.15) wants a
    // 0.8" leader (lane idx 2 × 0.20 step + 0.40 base). Tortie's
    // bottom is at y=5.38, so naive 0.8" leader would land at
    // y=5.35 — INSIDE Tortie's rect. The clamp must back off so the
    // leader stops at y > 5.38 with the configured clearance.
    const port = { xIn: 14.5, yIn: 6.15, side: 'top' as const };
    const tabby: ObstacleRect = {
      xIn: 13.22,
      yIn: 6.15,
      widthIn: 2.63,
      depthIn: 4.7,
    };
    const tortie: ObstacleRect = {
      xIn: 12.44,
      yIn: 0.68,
      widthIn: 2.6,
      depthIn: 4.7,
    };
    const safe = maxSafeLeaderLength(port, tabby, [tabby, tortie], 0.8);
    // Tortie bottom y = 5.38. Leader extends to y = port.y - safe =
    // 6.15 - safe. For leader-tip to clear Tortie, safe < 6.15 - 5.38
    // = 0.77. With the default 0.1" clearance, safe ≤ 0.67.
    expect(safe).toBeLessThanOrEqual(0.77);
    expect(safe).toBeLessThanOrEqual(0.67 + 1e-9);
    // And the leader must not actually enter Tortie's rect.
    const leaderTipY = 6.15 - safe;
    expect(leaderTipY).toBeGreaterThanOrEqual(5.38);
  });

  it('ignores obstacles that are NOT on the leader path (different x)', () => {
    // Port at (5, 6) facing up. Neighbour at x=10 doesn't block
    // the vertical leader at x=5.
    const port = { xIn: 5, yIn: 6, side: 'top' as const };
    const source: ObstacleRect = {
      xIn: 4,
      yIn: 6,
      widthIn: 2,
      depthIn: 4,
    };
    const irrelevant: ObstacleRect = {
      xIn: 10,
      yIn: 0,
      widthIn: 2,
      depthIn: 6,
    };
    expect(maxSafeLeaderLength(port, source, [source, irrelevant], 0.6)).toBe(
      0.6,
    );
  });

  it('falls back to minLen when even the requested length is unsafe', () => {
    // Neighbour sits right above the port, requested leader can't fit.
    const port = { xIn: 5, yIn: 6, side: 'top' as const };
    const source: ObstacleRect = {
      xIn: 4,
      yIn: 6,
      widthIn: 2,
      depthIn: 4,
    };
    const close: ObstacleRect = {
      xIn: 4,
      yIn: 5.9,
      widthIn: 2,
      depthIn: 0.1, // bottom at y = 6.0; touches source pedal top
    };
    const safe = maxSafeLeaderLength(port, source, [source, close], 0.6);
    // Min length guarantees the cable still has a visible plug-in;
    // clamping shouldn't return 0.
    expect(safe).toBeGreaterThan(0);
  });

  it('handles each of the four sides correctly', () => {
    // Symmetric obstacle 1" outward from a centered port on each side.
    const cases = [
      {
        port: { xIn: 5, yIn: 5, side: 'top' as const },
        block: { xIn: 4, yIn: 3, widthIn: 2, depthIn: 1 },
      },
      {
        port: { xIn: 5, yIn: 5, side: 'bottom' as const },
        block: { xIn: 4, yIn: 6, widthIn: 2, depthIn: 1 },
      },
      {
        port: { xIn: 5, yIn: 5, side: 'left' as const },
        block: { xIn: 3, yIn: 4, widthIn: 1, depthIn: 2 },
      },
      {
        port: { xIn: 5, yIn: 5, side: 'right' as const },
        block: { xIn: 6, yIn: 4, widthIn: 1, depthIn: 2 },
      },
    ];
    for (const { port, block } of cases) {
      const safe = maxSafeLeaderLength(port, null, [block], 1.5);
      // Obstacle starts 1" from the port along the outward axis,
      // minus the 0.1" clearance the function reserves.
      expect(safe).toBeCloseTo(0.9, 5);
    }
  });
});

describe('applyLaneRenderOffsets', () => {
  it('spreads two cables sharing a horizontal lane perpendicular', () => {
    // Two cables each routed as a proper Z (Manhattan) with a long
    // horizontal middle segment at y=5. The fan-out should shift
    // the two middle segments to different y values.
    const mkCable = () => ({
      path: [
        { xIn: 0, yIn: 0 }, // port
        { xIn: 0, yIn: 5 }, // leader-tip
        { xIn: 10, yIn: 5 }, // long horizontal
        { xIn: 10, yIn: 8 }, // dest leader-tip
        { xIn: 10, yIn: 8 }, // dest port
      ],
    });
    const cables = [mkCable(), mkCable()];
    applyLaneRenderOffsets(cables, []);
    const ya = cables[0]!.path[2]!.yIn;
    const yb = cables[1]!.path[2]!.yIn;
    expect(ya).not.toBe(yb);
  });

  it('clamps shift when it would push a cable into a pedal', () => {
    // Pedal sits just below the cable lane. The full fan-out shift
    // would push the cable into the pedal; safe-shift should back
    // off so each post-shift segment stays clear.
    const pedal: ObstacleRect = {
      xIn: 2,
      yIn: 5.1,
      widthIn: 3,
      depthIn: 2.9,
    };
    const mkCable = () => ({
      path: [
        { xIn: 0, yIn: 0 },
        { xIn: 0, yIn: 5 },
        { xIn: 10, yIn: 5 },
        { xIn: 10, yIn: 8 },
        { xIn: 10, yIn: 8 },
      ],
    });
    const cables = [mkCable(), mkCable()];
    applyLaneRenderOffsets(cables, [pedal]);
    for (const cable of cables) {
      for (let i = 0; i < cable.path.length - 1; i++) {
        const a = cable.path[i]!;
        const b = cable.path[i + 1]!;
        const minX = Math.min(a.xIn, b.xIn);
        const maxX = Math.max(a.xIn, b.xIn);
        const minY = Math.min(a.yIn, b.yIn);
        const maxY = Math.max(a.yIn, b.yIn);
        const crosses =
          maxX > pedal.xIn + 0.05 &&
          minX < pedal.xIn + pedal.widthIn - 0.05 &&
          maxY > pedal.yIn + 0.05 &&
          minY < pedal.yIn + pedal.depthIn - 0.05;
        expect(crosses).toBe(false);
      }
    }
  });
});
