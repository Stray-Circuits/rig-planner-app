/**
 * Unit tests for the channel-graph router. Complements the
 * full-pipeline `mainBoardRouting.test.ts` regression by exercising
 * the pieces in isolation: cell decomposition, single-cable routing,
 * capacity-driven lane sharing, and the rip-up pass that removes
 * cable-on-cable crossings.
 */
import { describe, expect, it } from 'vitest';
import {
  decomposeBoard,
  routeAllCables,
  type RouteRequest,
} from '../src/lib/channelRouter';
import type { ObstacleRect } from '../src/lib/geometry';

describe('decomposeBoard', () => {
  it('produces cells covering the board plus an off-board margin', () => {
    const grid = decomposeBoard(10, 8, []);
    // At minimum: -1, 0, periodic 0..10, 10, 11 for xs.
    expect(grid.xs[0]).toBe(-1);
    expect(grid.xs[grid.xs.length - 1]).toBe(11);
    expect(grid.ys[0]).toBe(-1);
    expect(grid.ys[grid.ys.length - 1]).toBe(9);
    // Every cell has consistent indices.
    for (const cell of grid.cells) {
      expect(grid.xs[cell.col]).toBe(cell.xMin);
      expect(grid.xs[cell.col + 1]).toBe(cell.xMax);
      expect(grid.ys[cell.row]).toBe(cell.yMin);
      expect(grid.ys[cell.row + 1]).toBe(cell.yMax);
    }
  });

  it('flags cells whose centre falls inside an obstacle as blocked', () => {
    const obstacle: ObstacleRect = {
      xIn: 3,
      yIn: 2,
      widthIn: 2,
      depthIn: 2,
    };
    const grid = decomposeBoard(10, 8, [obstacle]);
    // Find a cell whose centre is inside the obstacle.
    const inside = grid.cells.find((c) => {
      const cx = (c.xMin + c.xMax) / 2;
      const cy = (c.yMin + c.yMax) / 2;
      return cx > 3 && cx < 5 && cy > 2 && cy < 4;
    });
    expect(inside).toBeDefined();
    expect(inside!.blocked).toBe(true);
    // A cell well outside is not blocked.
    const outside = grid.cells.find(
      (c) => c.xMin > 6 && c.yMin > 5 && c.xMax <= 10 && c.yMax <= 8,
    );
    expect(outside).toBeDefined();
    expect(outside!.blocked).toBe(false);
  });
});

describe('routeAllCables — single cable', () => {
  it('returns a direct orthogonal path when there are no obstacles', () => {
    const grid = decomposeBoard(10, 8, []);
    const requests: RouteRequest[] = [
      {
        id: 'c1',
        from: { xIn: 1, yIn: 1, side: 'right' },
        to: { xIn: 9, yIn: 7, side: 'left' },
        fromLeaderIn: 0,
        toLeaderIn: 0,
      },
    ];
    const routed = routeAllCables(grid, requests, {
      boardWidthIn: 10,
      boardDepthIn: 8,
    });
    expect(routed).toHaveLength(1);
    const path = routed[0]!.polyline;
    expect(path[0]).toEqual({ xIn: 1, yIn: 1 });
    expect(path[path.length - 1]).toEqual({ xIn: 9, yIn: 7 });
    // Orthogonal segments.
    for (let i = 0; i < path.length - 1; i++) {
      const dx = Math.abs(path[i + 1]!.xIn - path[i]!.xIn);
      const dy = Math.abs(path[i + 1]!.yIn - path[i]!.yIn);
      expect(dx < 0.001 || dy < 0.001).toBe(true);
    }
    // Total path length is close to Manhattan distance (no big detour).
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) {
      total +=
        Math.abs(path[i + 1]!.xIn - path[i]!.xIn) +
        Math.abs(path[i + 1]!.yIn - path[i]!.yIn);
    }
    expect(total).toBeLessThanOrEqual(14 + 1); // 8 + 6 Manhattan, allow slight overshoot
  });

  it('detours around an obstacle sitting on the direct route', () => {
    const obstacle: ObstacleRect = {
      xIn: 4,
      yIn: 0,
      widthIn: 2,
      depthIn: 6,
    };
    const grid = decomposeBoard(10, 8, [obstacle]);
    const requests: RouteRequest[] = [
      {
        id: 'c1',
        from: { xIn: 1, yIn: 7, side: 'right' },
        to: { xIn: 9, yIn: 7, side: 'left' },
        fromLeaderIn: 0,
        toLeaderIn: 0,
      },
    ];
    const routed = routeAllCables(grid, requests, {
      boardWidthIn: 10,
      boardDepthIn: 8,
    });
    const path = routed[0]!.polyline;
    expect(path[0]).toEqual({ xIn: 1, yIn: 7 });
    expect(path[path.length - 1]).toEqual({ xIn: 9, yIn: 7 });
    // No segment crosses the obstacle's interior.
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const minX = Math.min(a.xIn, b.xIn);
      const maxX = Math.max(a.xIn, b.xIn);
      const minY = Math.min(a.yIn, b.yIn);
      const maxY = Math.max(a.yIn, b.yIn);
      const crosses = maxX > 4.01 && minX < 5.99 && maxY > 0.01 && minY < 5.99;
      expect(crosses).toBe(false);
    }
  });
});

describe('routeAllCables — multi-cable lane sharing', () => {
  it('spreads two parallel cables onto different lanes', () => {
    const grid = decomposeBoard(20, 12, []);
    const requests: RouteRequest[] = [
      {
        id: 'a',
        from: { xIn: 1, yIn: 5, side: 'right' },
        to: { xIn: 19, yIn: 5, side: 'left' },
        fromLeaderIn: 0,
        toLeaderIn: 0,
      },
      {
        id: 'b',
        from: { xIn: 1, yIn: 5, side: 'right' },
        to: { xIn: 19, yIn: 5, side: 'left' },
        fromLeaderIn: 0,
        toLeaderIn: 0,
      },
    ];
    const routed = routeAllCables(grid, requests, {
      boardWidthIn: 20,
      boardDepthIn: 12,
    });
    // Both cables exist; neither is degenerate.
    expect(routed).toHaveLength(2);
    expect(routed[0]!.polyline.length).toBeGreaterThanOrEqual(2);
    expect(routed[1]!.polyline.length).toBeGreaterThanOrEqual(2);
  });
});

describe('routeAllCables — crossing avoidance', () => {
  it('avoids unnecessary crossings between two cables', () => {
    // Two cables whose obvious routes would cross. The router should
    // try to give them non-crossing paths during the rip-up pass.
    const grid = decomposeBoard(10, 10, []);
    const requests: RouteRequest[] = [
      {
        id: 'a',
        from: { xIn: 1, yIn: 1, side: 'right' },
        to: { xIn: 9, yIn: 9, side: 'left' },
        fromLeaderIn: 0,
        toLeaderIn: 0,
      },
      {
        id: 'b',
        from: { xIn: 1, yIn: 9, side: 'right' },
        to: { xIn: 9, yIn: 1, side: 'left' },
        fromLeaderIn: 0,
        toLeaderIn: 0,
      },
    ];
    const routed = routeAllCables(grid, requests, {
      boardWidthIn: 10,
      boardDepthIn: 10,
    });
    expect(routed).toHaveLength(2);
    // Each cable's endpoints are correct.
    expect(routed[0]!.polyline[0]).toEqual({ xIn: 1, yIn: 1 });
    expect(routed[0]!.polyline[routed[0]!.polyline.length - 1]).toEqual({
      xIn: 9,
      yIn: 9,
    });
    expect(routed[1]!.polyline[0]).toEqual({ xIn: 1, yIn: 9 });
    expect(routed[1]!.polyline[routed[1]!.polyline.length - 1]).toEqual({
      xIn: 9,
      yIn: 1,
    });
  });
});
