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
  keepOutRect,
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
      rig: {
        widthIn: number;
        depthIn: number;
        jackSize: 'small' | 'medium' | 'large';
      };
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
    const keepOutByPlaced = new Map<string, ObstacleRect>();
    const rawByPlaced = new Map<string, ObstacleRect>();
    for (const p of data.placedPedals) {
      placedById.set(p.id, p);
      const def = pedalsById.get(p.pedalId);
      if (!def) continue;
      keepOutByPlaced.set(p.id, keepOutRect(p, def, rig.jackSize));
      rawByPlaced.set(p.id, placedRect(p, def));
    }
    const portIndex = buildPortIndex(data.placedPedals, pedalsById);

    // Mirror ChainOverlay: leader-length clamp uses KEEP-OUT rects so
    // a leader-tip can't land inside a neighbouring pedal's keep-out
    // shadow. routingMargin=0.05 matches production.
    const routingMarginIn = 0.05;
    const leaderLengths = computeLeaderLengths(
      data.connections,
      portIndex,
      keepOutByPlaced,
      undefined,
      undefined,
      routingMarginIn,
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
      // Per-cable obstacles match production: keep-out for foreign,
      // raw for own (source + destination).
      const obstaclesForCable: ObstacleRect[] = [];
      for (const [pid, ko] of keepOutByPlaced) {
        const isOwn = pid === from.placedId || pid === to.placedId;
        const raw = rawByPlaced.get(pid);
        obstaclesForCable.push(isOwn && raw ? raw : ko);
      }
      const fullPath = routeCableWithLeader(from, to, obstaclesForCable, {
        boardWidthIn: rig.widthIn,
        boardDepthIn: rig.depthIn,
        claimedY,
        claimedX,
        fromLeaderIn: leaderLengths.get(`${c.id}:from`) ?? LEADER_BASE_IN,
        toLeaderIn: leaderLengths.get(`${c.id}:to`) ?? LEADER_BASE_IN,
        obstacleMarginIn: routingMarginIn,
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
    applyLaneRenderOffsets(cables, [...keepOutByPlaced.values()]);

    const failures: string[] = [];
    for (const cable of cables) {
      // Walk every segment of the path. Check against every FOREIGN
      // pedal's keep-out (i.e. excluding the cable's own source +
      // destination). Own-keep-out crossings are expected near the
      // leader endpoints and aren't visible-overlap defects.
      for (let i = 0; i < cable.path.length - 1; i++) {
        const a = cable.path[i]!;
        const b = cable.path[i + 1]!;
        for (const [pid, r] of keepOutByPlaced) {
          if (cable.ownIds.has(pid)) continue;
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
