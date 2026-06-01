/**
 * Regression test for #41. Loads the bundled Main board fixture
 * (14 pedals, 23 cables, very tight middle row), runs the *exact*
 * production routing pipeline — leader-length computation +
 * `routeCableWithLeader` + render-time lane fan-out — and asserts
 * the rendered cables don't cross any foreign pedal.
 *
 * The pipeline functions live in `src/canvas/cableRender.ts` and are
 * imported here directly (no re-implementation), so the test can't
 * drift from production. Any change to either the router OR the
 * render-time fan-out is exercised against a real-world dense layout
 * in CI.
 */
import { describe, it } from 'vitest';
import mainBoardFixture from './fixtures/mainBoard.rig.json';
import {
  pathLanes,
  placedRect,
  routeCableWithLeader,
  type ObstacleRect,
} from '../src/lib/geometry';
import {
  applyLaneRenderOffsets,
  buildPortIndex,
  computeLeaderLengths,
  LEADER_BASE_IN,
} from '../src/canvas/cableRender';
import type {
  Connection,
  Pedal,
  PlacedPedal,
  Port,
  Side,
} from '../src/data/schema';

interface ResolvedEnd {
  xIn: number;
  yIn: number;
  side: Side;
  label: string;
  placedId?: string | undefined;
}

function segmentHitsRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: ObstacleRect,
): boolean {
  const eps = 0.05;
  const minX = Math.min(ax, bx);
  const maxX = Math.max(ax, bx);
  const minY = Math.min(ay, by);
  const maxY = Math.max(ay, by);
  return (
    maxX > r.xIn + eps &&
    minX < r.xIn + r.widthIn - eps &&
    maxY > r.yIn + eps &&
    minY < r.yIn + r.depthIn - eps
  );
}

describe('Main board fixture — full-pipeline routing', () => {
  it('routes every cable without crossing a foreign pedal after render-time fan-out', () => {
    const data = mainBoardFixture as unknown as {
      rig: { widthIn: number; depthIn: number };
      pedals: Pedal[];
      placedPedals: PlacedPedal[];
      externalEndpoints: { id: string; kind: string; label: string }[];
      connections: Connection[];
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
    const portIndex = buildPortIndex(data.placedPedals, pedalsById);

    // Mirror production: compute per-cable-end leader lengths with
    // obstacle-aware clamping. This is what ChainOverlay does.
    const leaderLengths = computeLeaderLengths(
      data.connections,
      portIndex,
      obstacleByPlaced,
    );

    const resolveEnd = (
      kind: 'pedal' | 'external',
      nodeId: string,
      portId: string | null,
    ): ResolvedEnd | null => {
      if (kind === 'pedal') {
        const resolved = portIndex.get(nodeId)?.get(portId ?? '');
        if (!resolved) return null;
        const def = resolved.pedal;
        const port: Port = resolved.port;
        return {
          xIn: resolved.xIn,
          yIn: resolved.yIn,
          side: resolved.visualSide,
          label: `${def.brand} ${def.name} :: ${port.label}`,
          placedId: resolved.placed.id,
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
        fromLeaderIn: leaderLengths.get(`${c.id}:from`) ?? LEADER_BASE_IN,
        toLeaderIn: leaderLengths.get(`${c.id}:to`) ?? LEADER_BASE_IN,
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
      // Walk every segment of the path. For each segment, check
      // against EVERY pedal rect.
      //
      // The own-pedal-of-this-cable rects (source / destination) are
      // *only* excluded for the LEADER segments — path[0]→path[1] and
      // path[n-2]→path[n-1] — which by construction sit on those
      // pedals' edges. Inner segments must NOT touch their own
      // source/dest pedal's interior either (the original test had
      // this excluded across all segments, hiding the case where the
      // router's inner path looped back through its own source
      // pedal).
      for (let i = 0; i < cable.path.length - 1; i++) {
        const a = cable.path[i]!;
        const b = cable.path[i + 1]!;
        const isLeaderSeg = i === 0 || i === cable.path.length - 2;
        for (const [pid, r] of obstacleByPlaced) {
          if (isLeaderSeg && cable.ownIds.has(pid)) continue;
          if (segmentHitsRect(a.xIn, a.yIn, b.xIn, b.yIn, r)) {
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
