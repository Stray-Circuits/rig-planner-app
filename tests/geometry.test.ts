import { describe, expect, it } from 'vitest';
import {
  centeredOnRig,
  clampToBoard,
  placedFootprint,
} from '../src/lib/geometry';
import type { Pedal, Rig } from '../src/data/schema';

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
});
