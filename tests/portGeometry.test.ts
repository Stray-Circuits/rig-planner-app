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
    imageSourceUrl: null,
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
  const out = mkPort({
    id: 'out',
    label: 'Out',
    role: 'output',
    side: 'top',
    sideOrder: 0,
  });
  const inp = mkPort({
    id: 'in',
    label: 'In',
    role: 'input',
    side: 'top',
    sideOrder: 1,
  });
  const pedal = mkPedal([out, inp]);

  it('places inputs on the right and outputs on the left on a horizontal side', () => {
    const p = placed(0);
    const outPos = portPositionOnBoard(p, pedal, out);
    const inPos = portPositionOnBoard(p, pedal, inp);
    // 3-inch wide pedal at x=10. Input (group 0) anchors at the right
    // (x=12), output (group 1) at the left (x=11) — even if the user
    // entered the output first via sideOrder.
    expect(inPos.xIn).toBeCloseTo(10 + 2, 4);
    expect(inPos.yIn).toBe(4);
    expect(outPos.xIn).toBeCloseTo(10 + 1, 4);
    expect(outPos.yIn).toBe(4);
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

  it('routes between two horizontally-anchored ports with a clean orthogonal path', () => {
    const path = routeCablePath(
      { xIn: 0, yIn: 0, side: 'right' },
      { xIn: 10, yIn: 5, side: 'left' },
    );
    // No obstacles → router picks the cheapest orthogonal route. The
    // exact topology (L vs Z) is implementation-defined: both have the
    // same Manhattan length, so the lower-corner-count L wins under
    // the current turn penalty. Assert validity, not shape.
    expect(path[0]).toEqual({ xIn: 0, yIn: 0 });
    expect(path[path.length - 1]).toEqual({ xIn: 10, yIn: 5 });
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const dx = Math.abs(b.xIn - a.xIn);
      const dy = Math.abs(b.yIn - a.yIn);
      expect(dx < 0.001 || dy < 0.001).toBe(true);
    }
  });

  it('routes between two vertically-anchored ports with a clean orthogonal path', () => {
    const path = routeCablePath(
      { xIn: 0, yIn: 0, side: 'bottom' },
      { xIn: 6, yIn: 8, side: 'top' },
    );
    expect(path[0]).toEqual({ xIn: 0, yIn: 0 });
    expect(path[path.length - 1]).toEqual({ xIn: 6, yIn: 8 });
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const dx = Math.abs(b.xIn - a.xIn);
      const dy = Math.abs(b.yIn - a.yIn);
      expect(dx < 0.001 || dy < 0.001).toBe(true);
    }
  });

  it('handles mixed orientations with a clean orthogonal route', () => {
    // No obstacles + mixed orientation → router picks any clean
    // orthogonal path. Exact topology depends on cell decomposition,
    // so assert validity (orthogonal segments, correct endpoints)
    // rather than vertex count.
    const path = routeCablePath(
      { xIn: 0, yIn: 0, side: 'right' },
      { xIn: 8, yIn: 4, side: 'top' },
    );
    expect(path[0]).toEqual({ xIn: 0, yIn: 0 });
    expect(path[path.length - 1]).toEqual({ xIn: 8, yIn: 4 });
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const dx = Math.abs(b.xIn - a.xIn);
      const dy = Math.abs(b.yIn - a.yIn);
      expect(dx < 0.001 || dy < 0.001).toBe(true);
    }
  });
});
