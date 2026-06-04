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
  buildPortIndex,
  computeLeaderLengths,
  maxSafeLeaderLength,
} from '../src/canvas/cableRender';
import { placedRect, type ObstacleRect } from '../src/lib/geometry';
import type { Connection, Pedal, PlacedPedal } from '../src/data/schema';

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
    // 6.15 - safe. For leader-tip to clear Tortie's INFLATED rect
    // (router inflates by 0.15" margin), safe must leave > 0.2" gap
    // to Tortie's raw edge → safe ≤ 6.15 - 5.38 - 0.2 = 0.57.
    expect(safe).toBeLessThanOrEqual(0.57 + 1e-9);
    // And the leader-tip lands clear of Tortie's inflated rect
    // (raw bottom + obstacle margin = 5.38 + 0.15 = 5.53).
    const leaderTipY = 6.15 - safe;
    expect(leaderTipY).toBeGreaterThanOrEqual(5.53);
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
      // minus the default 0.2" clearance the function reserves so the
      // leader-tip lands outside the router's inflated obstacle band
      // (router inflates by 0.15").
      expect(safe).toBeCloseTo(0.8, 5);
    }
  });
});

describe('computeLeaderLengths', () => {
  it('gives cables in the same side group DIFFERENT leader lengths even when both clamp against the same neighbour', () => {
    // Replicates the Wampler Tumnus + Meris LVX case from #41.
    // Tumnus top-side ports sit at y=6.22 with Meris LVX directly
    // above (raw bottom at y=5.43). With margin 0.15", the safe
    // band is too small to fit two natural staggered leaders
    // (0.4" + 0.6"), so distribute logic must redistribute the
    // group across the available range — without it, both cables
    // clamp to the same max-safe value and visually stack.
    const tumnusDef: Pedal = {
      id: 'tumnus',
      brand: 'Wampler',
      name: 'Tumnus Deluxe',
      widthIn: 2.5,
      depthIn: 4.5,
      imagePath: null,
      imageSourceUrl: null,
      jackSides: {
        top: true,
        bottom: false,
        left: false,
        right: false,
        midi_top: false,
        midi_bottom: false,
        midi_left: false,
        midi_right: false,
      },
      powerSide: null,
      ports: [
        {
          id: 'tumnus-in',
          pedalId: 'tumnus',
          label: 'In',
          role: 'input',
          signalType: 'instrument',
          connector: 'ts',
          side: 'top',
          sideOrder: 0,
          optional: false,
        },
        {
          id: 'tumnus-out',
          pedalId: 'tumnus',
          label: 'Out',
          role: 'output',
          signalType: 'instrument',
          connector: 'ts',
          side: 'top',
          sideOrder: 1,
          optional: false,
        },
      ],
      createdAt: '',
      updatedAt: '',
    };
    const merisDef: Pedal = {
      ...tumnusDef,
      id: 'meris',
      brand: 'Meris',
      name: 'LVX',
      widthIn: 7.25,
      depthIn: 4.5,
      ports: [],
    };
    const tumnusPlaced: PlacedPedal = {
      id: 'tumnusP',
      rigId: 'r',
      pedalId: 'tumnus',
      xIn: 3.16,
      yIn: 6.22,
      rotation: 0,
    };
    const merisPlaced: PlacedPedal = {
      id: 'merisP',
      rigId: 'r',
      pedalId: 'meris',
      xIn: 3.44,
      yIn: 0.93,
      rotation: 0,
    };
    const pedalsById = new Map<string, Pedal>([
      ['tumnus', tumnusDef],
      ['meris', merisDef],
    ]);
    const placed = [tumnusPlaced, merisPlaced];
    const portIndex = buildPortIndex(placed, pedalsById);
    const obstacleByPlaced = new Map([
      ['tumnusP', placedRect(tumnusPlaced, tumnusDef)],
      ['merisP', placedRect(merisPlaced, merisDef)],
    ]);
    // Two cables both leaving Tumnus's top — one from the In port
    // (a stand-in for an incoming cable that terminates at the
    // pedal) and one from the Out port.
    const connections: Connection[] = [
      {
        id: 'cable-in',
        rigId: 'r',
        fromNodeKind: 'pedal',
        fromNodeId: 'tumnusP',
        fromPortId: 'tumnus-in',
        toNodeKind: 'external',
        toNodeId: 'somewhere',
        toPortId: null,
      },
      {
        id: 'cable-out',
        rigId: 'r',
        fromNodeKind: 'pedal',
        fromNodeId: 'tumnusP',
        fromPortId: 'tumnus-out',
        toNodeKind: 'external',
        toNodeId: 'elsewhere',
        toPortId: null,
      },
    ];
    const lengths = computeLeaderLengths(
      connections,
      portIndex,
      obstacleByPlaced,
    );
    const inLen = lengths.get('cable-in:from');
    const outLen = lengths.get('cable-out:from');
    expect(inLen).toBeDefined();
    expect(outLen).toBeDefined();
    // The whole point: lengths must differ so cables don't stack.
    expect(inLen).not.toBe(outLen);
    // And neither can be zero (would be no leader at all).
    expect(inLen!).toBeGreaterThan(0);
    expect(outLen!).toBeGreaterThan(0);
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
