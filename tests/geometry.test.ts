import { describe, expect, it } from 'vitest';
import {
  centeredOnRig,
  clampToBoard,
  JACK_SIZE_INCHES,
  KEEP_OUT_MIDI_INCHES,
  KEEP_OUT_POWER_INCHES,
  keepOutRect,
  overlappingPlacedIds,
  placedFootprint,
  rectsOverlap,
  routeCablePath,
  routeCableWithLeader,
} from '../src/lib/geometry';
import type { Pedal, PlacedPedal, Rig } from '../src/data/schema';

const KEEP_OUT_AUDIO_INCHES = JACK_SIZE_INCHES.large;

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
  presetId: null,
  jackSize: 'large',
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
    // padded by KEEP_OUT_AUDIO_INCHES (0.625").
    expect(keepOutRect(placed, pedal, 'large')).toEqual({
      xIn: 4,
      yIn: 4 - KEEP_OUT_AUDIO_INCHES,
      widthIn: 3,
      depthIn: 5 + KEEP_OUT_AUDIO_INCHES,
    });
    // Rotated 90°: the logical "top" becomes visual "right", so the right
    // side is padded and the footprint flips to 5×3.
    const r90 = keepOutRect({ ...placed, rotation: 90 }, pedal, 'large');
    expect(r90).toEqual({
      xIn: 4,
      yIn: 4,
      widthIn: 5 + KEEP_OUT_AUDIO_INCHES,
      depthIn: 3,
    });
  });

  it('keepOutRect sizes each side by the longest jack barrel present', () => {
    const placed: PlacedPedal = {
      id: 'pl',
      rigId: 'r',
      pedalId: 'p',
      xIn: 0,
      yIn: 0,
      rotation: 0,
    };
    // Power-only side gets the shortest pad (12mm); MIDI-only side gets
    // the middle pad (15mm); audio-only side gets the longest (15.88mm).
    // When audio + MIDI share a side, the audio pad wins — they don't sum.
    const mixed: Pedal = {
      ...pedal,
      jackSides: {
        top: true, // audio
        bottom: false,
        left: false,
        right: false,
        midi_top: true, // also MIDI on top → audio dominates
        midi_bottom: true, // MIDI only
        midi_left: false,
        midi_right: false,
      },
      powerSide: 'left',
    };
    const r = keepOutRect(placed, mixed, 'large');
    expect(r.yIn).toBe(-KEEP_OUT_AUDIO_INCHES);
    expect(r.depthIn).toBeCloseTo(
      5 + KEEP_OUT_AUDIO_INCHES + KEEP_OUT_MIDI_INCHES,
      6,
    );
    expect(r.xIn).toBeCloseTo(-KEEP_OUT_POWER_INCHES, 6);
    expect(r.widthIn).toBeCloseTo(3 + KEEP_OUT_POWER_INCHES, 6);
  });

  it('keepOutRect sizes audio pads by the jack-size argument', () => {
    const placed: PlacedPedal = {
      id: 'pl',
      rigId: 'r',
      pedalId: 'p',
      xIn: 0,
      yIn: 0,
      rotation: 0,
    };
    // Top-only audio jack — pad equals JACK_SIZE_INCHES[size]. MIDI/power
    // aren't on this fixture, so audio is the only contributor.
    const small = keepOutRect(placed, pedal, 'small');
    const medium = keepOutRect(placed, pedal, 'medium');
    const large = keepOutRect(placed, pedal, 'large');
    expect(small.yIn).toBeCloseTo(-JACK_SIZE_INCHES.small, 6);
    expect(medium.yIn).toBeCloseTo(-JACK_SIZE_INCHES.medium, 6);
    expect(large.yIn).toBeCloseTo(-JACK_SIZE_INCHES.large, 6);
    expect(small.depthIn).toBeLessThan(medium.depthIn);
    expect(medium.depthIn).toBeLessThan(large.depthIn);
  });

  it('keepOutRect uses jackSize for TRS-MIDI ports and 15mm for DIN-MIDI ports', () => {
    // A pedal with both kinds of MIDI port: a TRS-MIDI on top (1/4"
    // plug, should follow the user jack size) and a 5-pin DIN MIDI on
    // bottom (fixed 15mm body).
    const placed: PlacedPedal = {
      id: 'pl',
      rigId: 'r',
      pedalId: 'p',
      xIn: 0,
      yIn: 0,
      rotation: 0,
    };
    const midiMixed: Pedal = {
      ...pedal,
      // jackSides reflect what the wizard would derive from the ports,
      // but the connector-aware logic doesn't actually need them now.
      jackSides: {
        top: false,
        bottom: false,
        left: false,
        right: false,
        midi_top: true,
        midi_bottom: true,
        midi_left: false,
        midi_right: false,
      },
      ports: [
        {
          id: 'midi-trs',
          pedalId: 'p',
          label: 'MIDI TRS',
          role: 'midi_in',
          signalType: 'midi',
          connector: 'midi_trs',
          side: 'top',
          sideOrder: 0,
          optional: false,
        },
        {
          id: 'midi-din',
          pedalId: 'p',
          label: 'MIDI DIN',
          role: 'midi_in',
          signalType: 'midi',
          connector: 'midi_din',
          side: 'bottom',
          sideOrder: 0,
          optional: false,
        },
      ],
    };
    const small = keepOutRect(placed, midiMixed, 'small');
    const large = keepOutRect(placed, midiMixed, 'large');
    // Top side has only a TRS-MIDI port — pad should track jackSize
    // exactly (small = 0.25", large = 0.625"), NOT the 15mm DIN
    // constant the legacy boolean fallback would have used.
    expect(-small.yIn).toBeCloseTo(JACK_SIZE_INCHES.small, 6);
    expect(-large.yIn).toBeCloseTo(JACK_SIZE_INCHES.large, 6);
    // Bottom side has only a DIN MIDI port — pad stays at 15mm
    // regardless of the user's jack-size selection.
    // depthIn = pedal.depth (5) + topPad + bottomPad.
    const smallBottomPad = small.depthIn - 5 - JACK_SIZE_INCHES.small;
    const largeBottomPad = large.depthIn - 5 - JACK_SIZE_INCHES.large;
    expect(smallBottomPad).toBeCloseTo(KEEP_OUT_MIDI_INCHES, 6);
    expect(largeBottomPad).toBeCloseTo(KEEP_OUT_MIDI_INCHES, 6);
  });

  it('keepOutRect respects the powerSide alone', () => {
    const placed: PlacedPedal = {
      id: 'pl',
      rigId: 'r',
      pedalId: 'p',
      xIn: 0,
      yIn: 0,
      rotation: 0,
    };
    const powerOnly: Pedal = {
      ...pedal,
      jackSides: {
        top: false,
        bottom: false,
        left: false,
        right: false,
        midi_top: false,
        midi_bottom: false,
        midi_left: false,
        midi_right: false,
      },
      powerSide: 'right',
    };
    const r = keepOutRect(placed, powerOnly, 'large');
    expect(r.yIn).toBe(0);
    expect(r.depthIn).toBe(5);
    expect(r.xIn).toBe(0);
    expect(r.widthIn).toBeCloseTo(3 + KEEP_OUT_POWER_INCHES, 6);
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

    // Without obstacles any clean orthogonal path works. The router
    // picks the lowest-cost one (Manhattan length + turn penalty), so
    // an L-shape (one corner) wins over a Z (two corners) at equal
    // length. Just assert the path starts and ends at the right
    // points and stays orthogonal.
    const noObstacles = routeCablePath(from, to);
    expect(noObstacles[0]).toEqual({ xIn: 0, yIn: 5 });
    expect(noObstacles[noObstacles.length - 1]).toEqual({ xIn: 20, yIn: 3 });
    for (let i = 0; i < noObstacles.length - 1; i++) {
      const a = noObstacles[i]!;
      const b = noObstacles[i + 1]!;
      const dx = Math.abs(b.xIn - a.xIn);
      const dy = Math.abs(b.yIn - a.yIn);
      expect(dx < 0.001 || dy < 0.001).toBe(true);
    }

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

  it('routeCableWithLeader avoids U-turns when leader lengths are staggered', () => {
    // Both ports on top sides, leaders deliberately different lengths
    // (lane staggering). The router must NOT bend within a single
    // column — i.e. two consecutive vertical segments must travel in
    // the same direction. Otherwise the cable doubles back on its own
    // leader, hugging the pedal edge.
    const fromRect = { xIn: 9.9, yIn: 6.56, widthIn: 2.52, depthIn: 4.7 };
    const toRect = { xIn: 4.17, yIn: 7.41, widthIn: 4.7, depthIn: 3.7 };
    const path = routeCableWithLeader(
      { xIn: 10.74, yIn: 6.56, side: 'top' },
      { xIn: 7.3, yIn: 7.41, side: 'top' },
      [fromRect, toRect],
      { fromLeaderIn: 0.4, toLeaderIn: 0.52 },
    );
    for (let i = 1; i < path.length - 1; i++) {
      const prev = path[i - 1]!;
      const cur = path[i]!;
      const next = path[i + 1]!;
      const xConstIn = Math.abs(cur.xIn - prev.xIn) < 0.001;
      const xConstOut = Math.abs(next.xIn - cur.xIn) < 0.001;
      if (xConstIn && xConstOut) {
        const dyIn = cur.yIn - prev.yIn;
        const dyOut = next.yIn - cur.yIn;
        // Same-axis adjacent segments must not reverse direction.
        expect(dyIn * dyOut).toBeGreaterThanOrEqual(-0.0001);
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
    expect(overlappingPlacedIds(placed, map, 'large')).toEqual(new Set());
    // Now move b on top of a → both flagged.
    placed[1] = { ...placed[1]!, yIn: 2 };
    expect(overlappingPlacedIds(placed, map, 'large')).toEqual(
      new Set(['a', 'b']),
    );
  });
});
