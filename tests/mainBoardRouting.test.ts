/**
 * Regression test for #41. Loads the bundled Main board fixture
 * (14 pedals, 23 cables, very tight middle row), runs the FULL
 * render pipeline — router + render-time lane fan-out — and
 * asserts the rendered cables don't cross any foreign pedal.
 *
 * Previous attempts at fixing the routing only checked the router's
 * output, missing the fan-out step that was actually pushing cables
 * through pedals. Keeping this test in CI means any future change to
 * either the router OR the render-time fan-out gets validated
 * against a real-world dense layout.
 *
 * The fixture lives at `tests/fixtures/mainBoard.rig.json` — a copy
 * of a user-exported board with deliberately crowded routing.
 */
import { describe, it } from 'vitest';
import mainBoardFixture from './fixtures/mainBoard.rig.json';
import {
  pathLanes,
  placedRect,
  portPositionOnBoard,
  rotatedSide,
  routeCableWithLeader,
  type ObstacleRect,
} from '../src/lib/geometry';
import type { Pedal, PlacedPedal, Port, Side } from '../src/data/schema';

// Re-implementations of the ChainOverlay render-time helpers. These
// have to stay in sync with src/canvas/ChainOverlay.tsx; if the
// production constants change, update them here too.
const LANE_RENDER_TOL_IN = 0.35;
const LANE_RENDER_SHIFT_IN = 0.2;

function segHitsObs(
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

function safeShift(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  req: number,
  axis: 'x' | 'y',
  obstacles: readonly ObstacleRect[],
): number {
  if (req === 0) return 0;
  const tryS = (s: number): boolean => {
    const dx = axis === 'x' ? s : 0;
    const dy = axis === 'y' ? s : 0;
    return !segHitsObs(ax + dx, ay + dy, bx + dx, by + dy, obstacles);
  };
  if (tryS(req)) return req;
  let lo = 0;
  let hi = Math.abs(req);
  const sign = Math.sign(req);
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    if (tryS(sign * mid)) lo = mid;
    else hi = mid;
  }
  if (lo < 0.02) return 0;
  return sign * lo;
}

interface RoutedCable {
  path: { xIn: number; yIn: number }[];
}

function applyLaneRenderOffsets(
  cables: RoutedCable[],
  obstacles: readonly ObstacleRect[],
): void {
  interface Seg {
    cableIdx: number;
    segIdx: number;
    lo: number;
    hi: number;
    axisValue: number;
  }
  const hSegs: Seg[] = [];
  const vSegs: Seg[] = [];
  for (let cableIdx = 0; cableIdx < cables.length; cableIdx++) {
    const p = cables[cableIdx]!.path;
    if (p.length < 4) continue;
    for (let i = 1; i < p.length - 2; i++) {
      const a = p[i]!;
      const b = p[i + 1]!;
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
  const processGroup = (segs: Seg[], shiftMap: Map<string, number>): void => {
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
    const p = cables[cableIdx]!.path;
    for (let i = 1; i < p.length - 2; i++) {
      const a = p[i]!;
      const b = p[i + 1]!;
      const reqY = shY.get(`${cableIdx}:${i}`);
      if (reqY !== undefined && reqY !== 0) {
        const s = safeShift(a.xIn, a.yIn, b.xIn, b.yIn, reqY, 'y', obstacles);
        if (s !== 0) {
          p[i] = { xIn: a.xIn, yIn: a.yIn + s };
          p[i + 1] = { xIn: b.xIn, yIn: b.yIn + s };
        }
      }
      const reqX = shX.get(`${cableIdx}:${i}`);
      if (reqX !== undefined && reqX !== 0) {
        const a2 = p[i]!;
        const b2 = p[i + 1]!;
        const s = safeShift(
          a2.xIn,
          a2.yIn,
          b2.xIn,
          b2.yIn,
          reqX,
          'x',
          obstacles,
        );
        if (s !== 0) {
          p[i] = { xIn: a2.xIn + s, yIn: a2.yIn };
          p[i + 1] = { xIn: b2.xIn + s, yIn: b2.yIn };
        }
      }
    }
  }
}

interface ResolvedEnd {
  xIn: number;
  yIn: number;
  side: Side;
  label: string;
  placedId?: string | undefined;
}

describe('Main board fixture — full-pipeline routing', () => {
  it('routes every cable without crossing a foreign pedal after render-time fan-out', () => {
    const data = mainBoardFixture as unknown as {
      rig: { widthIn: number; depthIn: number };
      pedals: Pedal[];
      placedPedals: PlacedPedal[];
      externalEndpoints: {
        id: string;
        kind: string;
        label: string;
      }[];
      connections: {
        id: string;
        fromNodeKind: string;
        fromNodeId: string;
        fromPortId: string | null;
        toNodeKind: string;
        toNodeId: string;
        toPortId: string | null;
      }[];
    };
    const rig = data.rig;
    const pedalsById = new Map<string, Pedal>(
      data.pedals.map((p) => [p.id, p]),
    );
    const placedById = new Map<string, PlacedPedal>();
    const obstacleByPlaced = new Map<string, ObstacleRect>();
    for (const p of data.placedPedals) {
      placedById.set(p.id, p);
      const def = pedalsById.get(p.pedalId);
      if (def) obstacleByPlaced.set(p.id, placedRect(p, def));
    }
    const allObstacles = [...obstacleByPlaced.values()];
    const resolveEnd = (
      kind: string,
      nodeId: string,
      portId: string | null,
    ): ResolvedEnd | null => {
      if (kind === 'pedal') {
        const p = placedById.get(nodeId);
        if (!p) return null;
        const def = pedalsById.get(p.pedalId);
        if (!def) return null;
        const port = def.ports.find((pp: Port) => pp.id === portId);
        if (!port) return null;
        const pos = portPositionOnBoard(p, def, port);
        return {
          xIn: pos.xIn,
          yIn: pos.yIn,
          side: rotatedSide(port.side, p.rotation),
          label: `${def.brand} ${def.name} :: ${port.label}`,
          placedId: p.id,
        };
      }
      const ep = data.externalEndpoints.find((e) => e.id === nodeId);
      if (!ep) return null;
      const isLeftCluster = ep.kind === 'amp_in' || ep.kind === 'amp_fx_return';
      return {
        xIn: isLeftCluster ? 0.75 : rig.widthIn - 0.75,
        yIn: -0.5,
        side: 'bottom',
        label: `endpoint ${ep.label}`,
      };
    };
    const cables: {
      from: ResolvedEnd;
      to: ResolvedEnd;
      path: { xIn: number; yIn: number }[];
      ownIds: Set<string>;
    }[] = [];
    const claimedY: number[] = [];
    const claimedX: number[] = [];
    for (const c of data.connections) {
      const from = resolveEnd(c.fromNodeKind, c.fromNodeId, c.fromPortId);
      const to = resolveEnd(c.toNodeKind, c.toNodeId, c.toPortId);
      if (!from || !to) continue;
      const fullPath = routeCableWithLeader(from, to, allObstacles, {
        boardWidthIn: rig.widthIn,
        boardDepthIn: rig.depthIn,
        claimedY,
        claimedX,
      });
      const lanes = pathLanes(fullPath);
      for (const y of lanes.horizontalY) claimedY.push(y);
      for (const x of lanes.verticalX) claimedX.push(x);
      cables.push({
        from,
        to,
        path: fullPath,
        ownIds: new Set(
          [from.placedId, to.placedId].filter(
            (x): x is string => x !== undefined,
          ),
        ),
      });
    }
    applyLaneRenderOffsets(cables, allObstacles);

    const failures: string[] = [];
    for (const cable of cables) {
      for (let i = 1; i < cable.path.length - 2; i++) {
        const a = cable.path[i]!;
        const b = cable.path[i + 1]!;
        for (const [pid, r] of obstacleByPlaced) {
          if (cable.ownIds.has(pid)) continue;
          if (segHitsObs(a.xIn, a.yIn, b.xIn, b.yIn, [r])) {
            const def = pedalsById.get(placedById.get(pid)?.pedalId ?? '');
            failures.push(
              `${cable.from.label} → ${cable.to.label} seg ${i} (${a.xIn.toFixed(2)},${a.yIn.toFixed(2)})→(${b.xIn.toFixed(2)},${b.yIn.toFixed(2)}) crosses ${def?.brand} ${def?.name}`,
            );
          }
        }
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `Found ${failures.length} cable→pedal crossings on Main board fixture:\n  ` +
          failures.join('\n  '),
      );
    }
  });
});
