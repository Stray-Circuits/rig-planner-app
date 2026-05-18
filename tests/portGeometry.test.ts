import { describe, expect, it } from 'vitest';
import {
  portPositionOnBoard,
  rotatedSide,
  routeCablePath,
} from '../src/lib/geometry';
import type { Pedal, PlacedPedal, Port } from '../src/data/schema';

const blankJacks = {
  top: true,
  bottom: false,
  left: false,
  right: false,
  midi_top: false,
  midi_bottom: false,
  midi_left: false,
  midi_right: false,
};

function mkPort(overrides: Partial<Port> = {}): Port {
  return {
    id: 'port',
    pedalId: 'pedal',
    label: 'In',
    role: 'input',
    signalType: 'instrument',
    connector: 'ts',
    side: 'top',
    sideOrder: 0,
    optional: false,
    ...overrides,
  };
}

function mkPedal(ports: Port[]): Pedal {
  return {
    id: 'pedal',
    brand: 'Boss',
    name: 'DS-1',
    widthIn: 3,
    depthIn: 5,
    imagePath: null,
    jackSides: blankJacks,
    powerSide: 'top',
    ports,
    createdAt: '',
    updatedAt: '',
  };
}

function placed(rotation: PlacedPedal['rotation'] = 0): PlacedPedal {
  return {
    id: 'placed',
    rigId: 'rig',
    pedalId: 'pedal',
    xIn: 10,
    yIn: 4,
    rotation,
  };
}

describe('rotatedSide', () => {
  it('walks 90° steps clockwise', () => {
    expect(rotatedSide('top', 0)).toBe('top');
    expect(rotatedSide('top', 90)).toBe('right');
    expect(rotatedSide('top', 180)).toBe('bottom');
    expect(rotatedSide('top', 270)).toBe('left');
    expect(rotatedSide('left', 90)).toBe('top');
  });
});

describe('portPositionOnBoard', () => {
  const out = mkPort({ id: 'out', label: 'Out', side: 'top', sideOrder: 0 });
  const inp = mkPort({ id: 'in', label: 'In', side: 'top', sideOrder: 1 });
  const pedal = mkPedal([out, inp]);

  it('distributes ports evenly along their visual side', () => {
    const p = placed(0);
    const outPos = portPositionOnBoard(p, pedal, out);
    const inPos = portPositionOnBoard(p, pedal, inp);
    // 3-inch wide pedal at x=10, two top ports: positions at 1/3 and 2/3
    expect(outPos.xIn).toBeCloseTo(10 + 1, 4);
    expect(outPos.yIn).toBe(4);
    expect(inPos.xIn).toBeCloseTo(10 + 2, 4);
    expect(inPos.yIn).toBe(4);
  });

  it('rotates the visual side with the pedal', () => {
    const p = placed(90);
    // 90°: top -> right. Pedal footprint becomes 5x3 (rotated), so width=5, depth=3.
    const outPos = portPositionOnBoard(p, pedal, out);
    // visual side is "right" → x is at the right edge of the footprint
    expect(outPos.xIn).toBeCloseTo(10 + 5, 4);
  });
});

describe('routeCablePath', () => {
  it('returns a single segment when colinear', () => {
    const path = routeCablePath(
      { xIn: 0, yIn: 1, side: 'right' },
      { xIn: 5, yIn: 1, side: 'left' },
    );
    expect(path).toHaveLength(2);
  });

  it('uses an X-midpoint elbow when both anchors face horizontally', () => {
    const path = routeCablePath(
      { xIn: 0, yIn: 0, side: 'right' },
      { xIn: 10, yIn: 5, side: 'left' },
    );
    expect(path).toHaveLength(4);
    expect(path[1]?.xIn).toBeCloseTo(5);
    expect(path[1]?.yIn).toBe(0);
    expect(path[2]?.xIn).toBeCloseTo(5);
    expect(path[2]?.yIn).toBe(5);
  });

  it('uses a Y-midpoint elbow when both anchors face vertically', () => {
    const path = routeCablePath(
      { xIn: 0, yIn: 0, side: 'bottom' },
      { xIn: 6, yIn: 8, side: 'top' },
    );
    expect(path).toHaveLength(4);
    expect(path[1]?.yIn).toBeCloseTo(4);
  });

  it('handles mixed orientations with a single elbow', () => {
    const path = routeCablePath(
      { xIn: 0, yIn: 0, side: 'right' },
      { xIn: 8, yIn: 4, side: 'top' },
    );
    expect(path).toHaveLength(3);
  });
});
