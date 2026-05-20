import { describe, expect, it } from 'vitest';
import {
  centeredOnRig,
  clampToBoard,
  keepOutRect,
  overlappingPlacedIds,
  placedFootprint,
  rectsOverlap,
} from '../src/lib/geometry';
import type { Pedal, PlacedPedal, Rig } from '../src/data/schema';

const pedal: Pedal = {
  id: 'p',
  brand: 'Boss',
  name: 'DS-1',
  widthIn: 3,
  depthIn: 5,
  imagePath: null,
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
    // The fixture has only top jacks → only the top side should be padded.
    expect(keepOutRect(placed, pedal)).toEqual({
      xIn: 4,
      yIn: 3,
      widthIn: 3,
      depthIn: 6,
    });
    // Rotated 90°: the logical "top" becomes visual "right", so the right
    // side is padded and the footprint flips to 5×3.
    const r90 = keepOutRect({ ...placed, rotation: 90 }, pedal);
    expect(r90).toEqual({
      xIn: 4,
      yIn: 4,
      widthIn: 6,
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
