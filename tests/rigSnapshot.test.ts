import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Connection,
  ExternalEndpoint,
  Pedal,
  PlacedPedal,
  Rig,
} from '../src/data/schema';
import { DEFAULT_CUSTOM_FLOOR } from '../src/lib/floorStyle';
import {
  composeRigSnapshot,
  computeSnapshotLayout,
  SNAPSHOT_PX_PER_INCH,
} from '../src/lib/rigSnapshot';

/**
 * Tests focus on:
 *   - layout math (pure function — covers the chip-strip + watermark spacing)
 *   - composeRigSnapshot end-to-end against a fake Canvas2D context, asserting
 *     we don't throw and we do call toBlob with a PNG mime
 * jsdom returns null from getContext by default (see tests/setup.ts), so we
 * monkey-patch the call sites needed for the snapshot path.
 */

function rig(overrides: Partial<Rig> = {}): Rig {
  return {
    id: 'rig-1',
    name: 'Test Rig',
    widthIn: 24,
    depthIn: 13,
    style: 'rail',
    presetId: 'classic-pro',
    jackSize: 'large',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function endpoint(overrides: Partial<ExternalEndpoint> = {}): ExternalEndpoint {
  return {
    id: 'ep-1',
    rigId: 'rig-1',
    kind: 'guitar',
    label: 'Guitar',
    ...overrides,
  };
}

describe('computeSnapshotLayout', () => {
  it('sizes the canvas to board + padding + watermark area when there are no endpoints', () => {
    const r = rig();
    const layout = computeSnapshotLayout(r, []);
    const expectedBoardWidth = r.widthIn * SNAPSHOT_PX_PER_INCH;
    const expectedBoardHeight = r.depthIn * SNAPSHOT_PX_PER_INCH;
    expect(layout.boardWidthPx).toBe(expectedBoardWidth);
    expect(layout.boardHeightPx).toBe(expectedBoardHeight);
    expect(layout.canvasWidth).toBeGreaterThan(expectedBoardWidth);
    expect(layout.canvasHeight).toBeGreaterThan(
      expectedBoardHeight + 80, // watermark area
    );
    expect(layout.hasEndpoints).toBe(false);
    // No endpoints → board sits at the padding offset, no chip strip.
    expect(layout.boardOffsetY).toBeLessThan(layout.boardOffsetX + 16);
  });

  it('reserves a chip-strip band above the board when endpoints exist', () => {
    const layoutEmpty = computeSnapshotLayout(rig(), []);
    const layoutEps = computeSnapshotLayout(rig(), [endpoint()]);
    expect(layoutEps.boardOffsetY).toBeGreaterThan(layoutEmpty.boardOffsetY);
    expect(layoutEps.hasEndpoints).toBe(true);
  });

  it('omits the chip strip when chainMode is off, even with endpoints', () => {
    const layout = computeSnapshotLayout(rig(), [endpoint()], false);
    expect(layout.hasEndpoints).toBe(false);
    expect(layout.boardOffsetY).toBe(
      computeSnapshotLayout(rig(), [], true).boardOffsetY,
    );
  });

  it('places the watermark below the board with a gap', () => {
    const layout = computeSnapshotLayout(rig(), []);
    expect(layout.watermarkOffsetY).toBeGreaterThan(
      layout.boardOffsetY + layout.boardHeightPx,
    );
  });
});

describe('composeRigSnapshot', () => {
  // jsdom's Image never fires onload/onerror because it doesn't fetch.
  // Shim it so loadImage() resolves immediately with non-zero natural dims.
  let OriginalImage: typeof Image;
  beforeEach(() => {
    OriginalImage = globalThis.Image;
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 100;
      naturalHeight = 30;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
      get src(): string {
        return '';
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image;
  });
  afterEach(() => {
    globalThis.Image = OriginalImage;
  });

  it('produces a JPEG blob via canvas.toBlob and walks the draw path without throwing', async () => {
    const ctx = makeFakeCtx();
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(ctx);
    const toBlobSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(function (
        this: HTMLCanvasElement,
        cb: BlobCallback,
        type?: string,
      ) {
        cb(new Blob(['fake-png'], { type: type ?? 'image/png' }));
      });

    try {
      const result = await composeRigSnapshot({
        rig: rig(),
        placed: [],
        pedalsById: new Map<string, Pedal>(),
        connections: [],
        endpoints: [endpoint()],
        floorStyle: 'concrete_grey',
        customFloor: DEFAULT_CUSTOM_FLOOR,
        chainMode: true,
      });
      expect(result.blob.type).toBe('image/jpeg');
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.fileExtension).toBe('jpg');
      expect(result.widthPx).toBeGreaterThan(0);
      expect(result.heightPx).toBeGreaterThan(0);
      expect(toBlobSpy).toHaveBeenCalled();
    } finally {
      getContextSpy.mockRestore();
      toBlobSpy.mockRestore();
    }
  });

  it('routes cables for a connected pedal pair without throwing', async () => {
    const ctx = makeFakeCtx();
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(ctx);
    const toBlobSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
        cb(new Blob(['x'], { type: 'image/png' }));
      });
    try {
      const { pedals, placed, connections } = twoPedalChain();
      const result = await composeRigSnapshot({
        rig: rig(),
        placed,
        pedalsById: new Map(pedals.map((p) => [p.id, p])),
        connections,
        endpoints: [],
        floorStyle: 'concrete_grey',
        customFloor: DEFAULT_CUSTOM_FLOOR,
        chainMode: true,
      });
      expect(result.blob).toBeInstanceOf(Blob);
    } finally {
      getContextSpy.mockRestore();
      toBlobSpy.mockRestore();
    }
  });
});

function twoPedalChain(): {
  pedals: Pedal[];
  placed: PlacedPedal[];
  connections: Connection[];
} {
  const base: Pedal = {
    id: 'a',
    brand: 'Test',
    name: 'A',
    widthIn: 2.5,
    depthIn: 4.5,
    imagePath: 'color:#ff0000',
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
    ports: [
      {
        id: 'a-in',
        pedalId: 'a',
        label: 'In',
        role: 'input',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 0,
        optional: false,
      },
      {
        id: 'a-out',
        pedalId: 'a',
        label: 'Out',
        role: 'output',
        signalType: 'instrument',
        connector: 'ts',
        side: 'top',
        sideOrder: 1,
        optional: false,
      },
    ],
    createdAt: '',
    updatedAt: '',
  };
  const pedalA = base;
  const pedalB: Pedal = {
    ...base,
    id: 'b',
    name: 'B',
    imagePath: 'color:#0000ff',
    ports: base.ports.map((p) => ({
      ...p,
      id: p.id.replace('a-', 'b-'),
      pedalId: 'b',
    })),
  };
  const placed: PlacedPedal[] = [
    { id: 'pa', rigId: 'rig-1', pedalId: 'a', xIn: 2, yIn: 6, rotation: 0 },
    { id: 'pb', rigId: 'rig-1', pedalId: 'b', xIn: 8, yIn: 6, rotation: 0 },
  ];
  const connections: Connection[] = [
    {
      id: 'c1',
      rigId: 'rig-1',
      fromNodeKind: 'pedal',
      fromNodeId: 'pa',
      fromPortId: 'a-out',
      toNodeKind: 'pedal',
      toNodeId: 'pb',
      toPortId: 'b-in',
    },
  ];
  return { pedals: [pedalA, pedalB], placed, connections };
}

function makeFakeCtx(): CanvasRenderingContext2D {
  const noop = () => undefined;
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    quadraticCurveTo: noop,
    closePath: noop,
    fill: noop,
    stroke: noop,
    drawImage: noop,
    fillText: noop,
    strokeText: noop,
    measureText: (text: string) => ({ width: text.length * 7 }),
    createPattern: () => ({}) as CanvasPattern,
  };
  return ctx as unknown as CanvasRenderingContext2D;
}
