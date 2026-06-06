import { describe, expect, it } from 'vitest';
import {
  applySameSideMove,
  type DraftPort,
} from '../src/screens/add-pedal/portReorder';

function port(
  id: string,
  side: DraftPort['side'],
  sideOrder: number,
): DraftPort {
  return {
    _draftId: id,
    label: id.toUpperCase(),
    role: 'input',
    signalType: 'instrument',
    connector: 'ts',
    side,
    sideOrder,
    optional: false,
  };
}

describe('applySameSideMove', () => {
  it('reorders same-side ports and renormalizes sideOrder to the original distribution', () => {
    // Two top-side ports: In (sideOrder 1) before Out (sideOrder 0).
    // Drag In past Out → array becomes [Out, In]; sideOrder values 0,1
    // redistribute to that new array order: Out=0, In=1.
    const before = [port('in', 'top', 1), port('out', 'top', 0)];
    const after = applySameSideMove(before, 'in', 'out');
    expect(after.map((p) => p._draftId)).toEqual(['out', 'in']);
    expect(after[0]?.sideOrder).toBe(0);
    expect(after[1]?.sideOrder).toBe(1);
  });

  it('preserves gaps in the existing sideOrder distribution', () => {
    // Three same-side ports with a gap in sideOrder values (0, 2, 5).
    // Move the middle port to the end. Sorted distribution {0, 2, 5}
    // gets redistributed to the new array order [a, c, b]: a=0, c=2, b=5.
    const before = [
      port('a', 'top', 0),
      port('b', 'top', 2),
      port('c', 'top', 5),
    ];
    const after = applySameSideMove(before, 'b', 'c');
    expect(after.map((p) => p._draftId)).toEqual(['a', 'c', 'b']);
    expect(after.map((p) => p.sideOrder)).toEqual([0, 2, 5]);
  });

  it('rejects cross-side drops and returns the original array', () => {
    const before = [port('top1', 'top', 0), port('left1', 'left', 0)];
    const after = applySameSideMove(before, 'top1', 'left1');
    expect(after).toBe(before);
  });

  it('is a no-op when either id is missing', () => {
    const before = [port('top1', 'top', 0)];
    expect(applySameSideMove(before, 'nope', 'top1')).toBe(before);
    expect(applySameSideMove(before, 'top1', 'nope')).toBe(before);
  });

  it('leaves ports on other sides untouched', () => {
    const before = [
      port('topA', 'top', 0),
      port('topB', 'top', 1),
      port('leftA', 'left', 0),
    ];
    const after = applySameSideMove(before, 'topA', 'topB');
    const leftA = after.find((p) => p._draftId === 'leftA');
    expect(leftA?.side).toBe('left');
    expect(leftA?.sideOrder).toBe(0);
  });
});
