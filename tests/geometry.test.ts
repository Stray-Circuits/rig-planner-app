import { describe, expect, it } from 'vitest';
import {
  centeredOnRig,
  clampToBoard,
  keepOutRect,
  overlappingPlacedIds,
  placedFootprint,
  rectsOverlap,
  routeCablePath,
  routeCableWithLeader,
} from '../src/lib/geometry';
import type { Pedal, PlacedPedal, Rig } from '../src/data/schema';

const pedal: Pedal = {
  id: 'p',
  brand: 'Boss',
  name: 'DS-1',
  widthIn: 3,
  depthIn: 5,
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
  ports: [],
  createdAt: '',
  updatedAt: '',
};

const rig: Rig = {
  id: 'r',
  name: 'Test',
  widthIn: 24,
  depthIn: 12,
  style: 'rail',
  createdAt: '',
  updatedAt: '',
};

describe('geometry', () => {
  it('placedFootprint swaps dimensions for 90/270 rotation', () => {
    expect(placedFootprint(pedal, 0)).toEqual({ widthIn: 3, depthIn: 5 });
    expect(placedFootprint(pedal, 180)).toEqual({ widthIn: 3, depthIn: 5 });
    expect(placedFootprint(pedal, 90)).toEqual({ widthIn: 5, depthIn: 3 });
    expect(placedFootprint(pedal, 270)).toEqual({ widthIn: 5, depthIn: 3 });
  });

  it('clampToBoard keeps a pedal inside the board', () => {
    // Inside — unchanged
    expect(clampToBoard(5, 3, pedal, 0, rig)).toEqual({ xIn: 5, yIn: 3 });
    // Negative — clamped to 0
    expect(clampToBoard(-1, -1, pedal, 0, rig)).toEqual({ xIn: 0, yIn: 0 });
    // Past right edge — clamped to rig.widthIn - pedal.widthIn
    expect(clampToBoard(100, 100, pedal, 0, rig)).toEqual({
      xIn: 21,
      yIn: 7,
    });
    // Rotated 90: footprint becomes 5 × 3
    expect(clampToBoard(100, 100, pedal, 90, rig)).toEqual({
      xIn: 19,
      yIn: 9,
    });
  });

  it('centeredOnRig returns the centered top-left', () => {
    expect(centeredOnRig(pedal, rig)).toEqual({ xIn: 10.5, yIn: 3.5 });
  });

  it('keepOutRect pads only sides with jacks; rotation maps logical → visual', () => {
    const placed: PlacedPedal = {
      id: 'pl',
      rigId: 'r',
      pedalId: 'p',
      xIn: 4,
      yIn: 4,
      rotation: 0,
    };
    // The fixture has only top jacks → only the top side should be
    // padded by KEEP_OUT_INCHES (0.625).
    expect(keepOutRect(placed, pedal)).toEqual({
      xIn: 4,
      yIn: 4 - 0.625,
      widthIn: 3,
      depthIn: 5 + 0.625,
    });
    // Rotated 90°: the logical "top" becomes visual "right", so the right
    // side is padded and the footprint flips to 5×3.
    const r90 = keepOutRect({ ...placed, rotation: 90 }, pedal);
    expect(r90).toEqual({
      xIn: 4,
      yIn: 4,
      widthIn: 5 + 0.625,
      depthIn: 3,
    });
  });

  it('rectsOverlap detects strict AABB overlap', () => {
    const a = { xIn: 0, yIn: 0, widthIn: 2, depthIn: 2 };
    const b = { xIn: 1, yIn: 1, widthIn: 2, depthIn: 2 };
    const c = { xIn: 2, yIn: 0, widthIn: 2, depthIn: 2 };
    expect(rectsOverlap(a, b)).toBe(true);
    expect(rectsOverlap(a, c)).toBe(false);
  });

  it('routeCablePath detours around a pedal sitting on the natural midpoint', () => {
    // From port at left edge, to port at right edge with a slight y
    // offset (real ports rarely line up perfectly). A pedal occupies the
    // geometric midpoint between them.
    const from = { xIn: 0, yIn: 5, side: 'right' as const };
    const to = { xIn: 20, yIn: 3, side: 'left' as const };
    // Obstacle is a small pedal between the two ports, only blocking the
    // upper half of the cable's vertical span (y 4–6). A 3-segment elbow
    // shifted to one side has room to detour around it.
    const obstacle = { xIn: 9, yIn: 4, widthIn: 2, depthIn: 2 };

    // Without obstacles the default elbow is at midX=10 → cable would
    // bisect the obstacle.
    const noObstacles = routeCablePath(from, to);
    expect(noObstacles[1]).toEqual({ xIn: 10, yIn: 5 });

    // With the obstacle declared, no segment of the chosen path should
    // cross the obstacle's interior.
    const path = routeCablePath(from, to, [obstacle]);
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const minX = Math.min(a.xIn, b.xIn);
      const maxX = Math.max(a.xIn, b.xIn);
      const minY = Math.min(a.yIn, b.yIn);
      const maxY = Math.max(a.yIn, b.yIn);
      const crosses =
        maxX > obstacle.xIn + 0.05 &&
        minX < obstacle.xIn + obstacle.widthIn - 0.05 &&
        maxY > obstacle.yIn + 0.05 &&
        minY < obstacle.yIn + obstacle.depthIn - 0.05;
      expect(crosses).toBe(false);
    }
  });

  it('routeCableWithLeader routes a staple above two adjacent top-port pedals', () => {
    // Two pedals side by side, ports on top. The "from" pedal owns the
    // port at its top-right; the "to" pedal owns a port at its top-left.
    // Both pedals must be passed as obstacles so the inner path can't
    // route through either body.
    const fromPedalRect = { xIn: 0, yIn: 2, widthIn: 3, depthIn: 4 };
    const toPedalRect = { xIn: 4, yIn: 2, widthIn: 3, depthIn: 4 };
    const path = routeCableWithLeader(
      { xIn: 2, yIn: 2, side: 'top' },
      { xIn: 5, yIn: 2, side: 'top' },
      [fromPedalRect, toPedalRect],
    );
    // No INNER segment (anything between first and last) should cross
    // either pedal's interior.
    for (let i = 1; i < path.length - 2; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      for (const rect of [fromPedalRect, toPedalRect]) {
        const minX = Math.min(a.xIn, b.xIn);
        const maxX = Math.max(a.xIn, b.xIn);
        const minY = Math.min(a.yIn, b.yIn);
        const maxY = Math.max(a.yIn, b.yIn);
        const crosses =
          maxX > rect.xIn + 0.05 &&
          minX < rect.xIn + rect.widthIn - 0.05 &&
          maxY > rect.yIn + 0.05 &&
          minY < rect.yIn + rect.depthIn - 0.05;
        expect(crosses).toBe(false);
      }
    }
  });

  it('routeCableWithLeader routes around the source pedal when destination column overlaps it', () => {
    // Source pedal (Tortie-like) at top, destination pedal (Tabby-like)
    // below it. Destination port column is INSIDE source pedal's x
    // range, so the naive Z-shape through-the-middle hits the source.
    // The 5-segment fallback must route around.
    const fromRect = { xIn: 12.89, yIn: 0.83, widthIn: 2.6, depthIn: 4.7 };
    const toRect = { xIn: 13.43, yIn: 6.65, widthIn: 2.6, depthIn: 4.7 };
    const path = routeCableWithLeader(
      { xIn: 13.76, yIn: 0.83, side: 'top' },
      { xIn: 15.16, yIn: 6.65, side: 'top' },
      [fromRect, toRect],
    );
    for (let i = 1; i < path.length - 2; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      for (const rect of [fromRect, toRect]) {
        const minX = Math.min(a.xIn, b.xIn);
        const maxX = Math.max(a.xIn, b.xIn);
        const minY = Math.min(a.yIn, b.yIn);
        const maxY = Math.max(a.yIn, b.yIn);
        const crosses =
          maxX > rect.xIn + 0.05 &&
          minX < rect.xIn + rect.widthIn - 0.05 &&
          maxY > rect.yIn + 0.05 &&
          minY < rect.yIn + rect.depthIn - 0.05;
        expect(crosses).toBe(false);
      }
    }
  });

  it('overlappingPlacedIds flags both pedals when their keep-out rects touch', () => {
    const map = new Map<string, Pedal>([['p', pedal]]);
    const placed: PlacedPedal[] = [
      { id: 'a', rigId: 'r', pedalId: 'p', xIn: 0, yIn: 0, rotation: 0 },
      // Top-side keep-out from `a` reaches y = -1; place b just below `a`'s
      // bottom edge with no jack-side overlap → safe.
      { id: 'b', rigId: 'r', pedalId: 'p', xIn: 0, yIn: 6, rotation: 0 },
    ];
    expect(overlappingPlacedIds(placed, map)).toEqual(new Set());
    // Now move b on top of a → both flagged.
    placed[1] = { ...placed[1]!, yIn: 2 };
    expect(overlappingPlacedIds(placed, map)).toEqual(new Set(['a', 'b']));
  });
});
