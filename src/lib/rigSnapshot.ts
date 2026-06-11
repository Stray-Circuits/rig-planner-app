/**
 * Offscreen compositor that draws a rig (board + placed pedals + cables +
 * endpoint chips) plus a Stray Circuits watermark to a PNG Blob. Used by
 * the Share FAB on the rig screen.
 *
 * The live canvas is a layered React tree (board <img>, pedal <div>s, an
 * SVG cable overlay, endpoint <button> chips); none of that is grabbable
 * as one element. So we recompute the layout from the same geometry
 * primitives the live view uses (portPositionOnBoard, keepOutRect,
 * channelRouter) and rasterize each layer into one canvas.
 *
 * This deliberately approximates the live view rather than reproducing it
 * pixel-perfect — no stereo-strand splits, no dashed pattern for external
 * cables, no L/R channel coloring. Cables draw as solid lines colored by
 * the from-port's signal type. Issue #109 calls that out as acceptable.
 */
import type {
  Connection,
  ExternalEndpoint,
  ExternalEndpointKind,
  Pedal,
  PlacedPedal,
  Rig,
  Side,
} from '../data/schema';
import { resolveBoardImageSrc } from '../data/boardPresets';
import { BOARD_DRAWERS, backgroundForStyle } from '../canvas/boardStyles';
import { keepOutRect, placedFootprint, type ObstacleRect } from './geometry';
import {
  decomposeBoard,
  routeAllCables,
  type RouteRequest,
} from './channelRouter';
import { colorForPort, colorForSignal } from './signalColors';
import { sortConnectionsForRender } from './signalChainWarnings';
import {
  buildPortIndex,
  computeLeaderLengths,
  LEADER_BASE_IN,
  type ResolvedPort,
} from '../canvas/cableRender';
import { colorFromImagePath } from './pedalImage';
import type { CustomFloor, FloorStyle } from './floorStyle';
import strayCircuitsLogoRaw from '../assets/brand/stray-circuits-horizontal-light.svg?raw';

/** Render scale for the snapshot. Higher = larger output, more memory. */
export const SNAPSHOT_PX_PER_INCH = 100;

/** Outer padding around the board image in the snapshot, in CSS pixels. */
const PAD_PX = 32;
/** Vertical strip above the board reserved for endpoint chip labels. */
const CHIP_STRIP_PX = 48;
const CHIP_FONT = '500 14px ui-sans-serif, system-ui, sans-serif';
const CHIP_BG = '#f4f4f5';
const CHIP_FG = '#1f2937';
const CHIP_BORDER = '#d4d4d8';
/** Watermark band beneath the board. "Rig Planner" in Audiowide on the
 *  left, then the horizontal Stray Circuits lockup, both anchored to the
 *  bottom-left of the band with a small inset. */
const WATERMARK_HEIGHT_PX = 72;
const WATERMARK_TITLE_FONT_SIZE = 40;
const WATERMARK_TITLE_FONT = `400 ${WATERMARK_TITLE_FONT_SIZE}px Audiowide, ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
const WATERMARK_LOGO_HEIGHT_PX = WATERMARK_TITLE_FONT_SIZE;
const WATERMARK_GAP_PX = 16;
const WATERMARK_INSET_X_PX = 8;
const WATERMARK_BASELINE_INSET_PX = 12;
const BOARD_FALLBACK_FILL = '#3d3d40';
const PEDAL_LABEL_COLOR = 'rgba(255, 255, 255, 0.95)';
const PEDAL_LABEL_OUTLINE = 'rgba(0, 0, 0, 0.7)';

/** Tile sizes (CSS px) for each floor texture — mirrors the CSS in RigScreen.module.css. */
const FLOOR_TEXTURE_TILE: Record<Exclude<FloorStyle, 'custom'>, number> = {
  concrete_grey: 256,
  stage_black: 320,
  carpet_beige: 280,
  wood: 360,
  sidewalk: 300,
};
/** Solid fallback per floor if the texture asset fails to load. */
const FLOOR_FALLBACK_FILL: Record<Exclude<FloorStyle, 'custom'>, string> = {
  concrete_grey: '#8a8a8a',
  stage_black: '#141416',
  carpet_beige: '#c9b58a',
  wood: '#6e4422',
  sidewalk: '#bcbcb6',
};

export interface RigSnapshotInput {
  rig: Rig;
  placed: PlacedPedal[];
  pedalsById: Map<string, Pedal>;
  connections: Connection[];
  endpoints: ExternalEndpoint[];
  floorStyle: FloorStyle;
  customFloor: CustomFloor;
  /**
   * When true (the user is viewing the signal-chain overlay), the
   * snapshot includes the endpoint chip strip and routed cables. When
   * false, only the board + pedals are drawn — matching what the user
   * was looking at when they tapped Share.
   */
  chainMode: boolean;
}

export interface RigSnapshotResult {
  blob: Blob;
  widthPx: number;
  heightPx: number;
}

/**
 * Compose a rig snapshot PNG. Resolves with the encoded Blob + the
 * canvas dimensions (handy for tests).
 */
export async function composeRigSnapshot(
  input: RigSnapshotInput,
): Promise<RigSnapshotResult> {
  const layout = computeSnapshotLayout(
    input.rig,
    input.endpoints,
    input.chainMode,
  );
  const canvas = document.createElement('canvas');
  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not acquire 2D rendering context');
  }
  await drawFloorBackground(ctx, input.floorStyle, input.customFloor, layout);

  await drawBoard(ctx, input.rig, layout);
  const chipPositions = input.chainMode
    ? drawEndpointChips(ctx, input.endpoints, layout)
    : new Map<string, { xIn: number; yIn: number }>();
  await drawPedals(ctx, input, layout);
  if (input.chainMode) drawCables(ctx, input, layout, chipPositions);
  await drawWatermark(ctx, layout);

  const blob = await canvasToBlob(canvas);
  return { blob, widthPx: layout.canvasWidth, heightPx: layout.canvasHeight };
}

interface SnapshotLayout {
  canvasWidth: number;
  canvasHeight: number;
  pxPerInch: number;
  boardOffsetX: number;
  boardOffsetY: number;
  boardWidthPx: number;
  boardHeightPx: number;
  watermarkOffsetY: number;
  chipStripOffsetY: number;
  hasEndpoints: boolean;
}

export function computeSnapshotLayout(
  rig: Rig,
  endpoints: ExternalEndpoint[],
  chainMode = true,
): SnapshotLayout {
  const pxPerInch = SNAPSHOT_PX_PER_INCH;
  const boardWidthPx = rig.widthIn * pxPerInch;
  const boardHeightPx = rig.depthIn * pxPerInch;
  // Chip strip only renders when chain mode is on AND the rig has any
  // endpoints. Otherwise reclaim the vertical space.
  const hasEndpoints = chainMode && endpoints.length > 0;
  const chipStripOffsetY = PAD_PX;
  const boardOffsetY = PAD_PX + (hasEndpoints ? CHIP_STRIP_PX : 0);
  const watermarkOffsetY = boardOffsetY + boardHeightPx + PAD_PX;
  return {
    canvasWidth: boardWidthPx + 2 * PAD_PX,
    canvasHeight: watermarkOffsetY + WATERMARK_HEIGHT_PX + PAD_PX,
    pxPerInch,
    boardOffsetX: PAD_PX,
    boardOffsetY,
    boardWidthPx,
    boardHeightPx,
    watermarkOffsetY,
    chipStripOffsetY,
    hasEndpoints,
  };
}

async function drawFloorBackground(
  ctx: CanvasRenderingContext2D,
  style: FloorStyle,
  custom: CustomFloor,
  layout: SnapshotLayout,
): Promise<void> {
  if (style === 'custom') {
    // Match customFloorBackgroundStyle: solid color underneath, concrete
    // texture multiplied on top at intensity `grain`.
    ctx.fillStyle = custom.color;
    ctx.fillRect(0, 0, layout.canvasWidth, layout.canvasHeight);
    if (custom.grain > 0) {
      const tex = await loadImage('/textures/floors/concrete_grey.jpg').catch(
        () => null,
      );
      if (tex) {
        const pattern = ctx.createPattern(tex, 'repeat');
        if (pattern) {
          ctx.save();
          ctx.globalAlpha = custom.grain;
          ctx.globalCompositeOperation = 'multiply';
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, layout.canvasWidth, layout.canvasHeight);
          ctx.restore();
        }
      }
    }
    return;
  }
  ctx.fillStyle = FLOOR_FALLBACK_FILL[style];
  ctx.fillRect(0, 0, layout.canvasWidth, layout.canvasHeight);
  const tex = await loadImage(`/textures/floors/${style}.jpg`).catch(
    () => null,
  );
  if (!tex) return;
  // Tile size from CSS — scale the texture so the rendered tile matches
  // what the user sees on the live canvas at 1x. The texture's natural
  // pixel size is irrelevant; we resize via an offscreen canvas pattern.
  const tile = FLOOR_TEXTURE_TILE[style];
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = tile;
  tileCanvas.height = tile;
  const tileCtx = tileCanvas.getContext('2d');
  if (!tileCtx) return;
  tileCtx.drawImage(tex, 0, 0, tile, tile);
  const pattern = ctx.createPattern(tileCanvas, 'repeat');
  if (!pattern) return;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, layout.canvasWidth, layout.canvasHeight);
}

async function drawBoard(
  ctx: CanvasRenderingContext2D,
  rig: Rig,
  layout: SnapshotLayout,
): Promise<void> {
  const src = resolveBoardImageSrc({
    style: rig.style,
    presetId: rig.presetId,
    widthIn: rig.widthIn,
    depthIn: rig.depthIn,
  });
  if (src !== null) {
    // Bundled board PNG path. The board PNG itself usually has a fallback
    // shape on transparent; paint a neutral backdrop first so any
    // transparent regions don't show the floor texture through them
    // (the live canvas uses a CSS background for the same purpose).
    ctx.fillStyle = BOARD_FALLBACK_FILL;
    ctx.fillRect(
      layout.boardOffsetX,
      layout.boardOffsetY,
      layout.boardWidthPx,
      layout.boardHeightPx,
    );
    const img = await loadImage(src).catch(() => null);
    if (img) {
      ctx.drawImage(
        img,
        layout.boardOffsetX,
        layout.boardOffsetY,
        layout.boardWidthPx,
        layout.boardHeightPx,
      );
    }
    return;
  }
  // Procedural board style (rail / plain / holes / wood). Render onto an
  // offscreen canvas so the drawer's internal clearRect doesn't punch a
  // hole in the floor background underneath, then composite.
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.round(layout.boardWidthPx));
  off.height = Math.max(1, Math.round(layout.boardHeightPx));
  const offCtx = off.getContext('2d');
  if (!offCtx) return;
  // Match the CSS-side backdrop for procedural styles (rail needs #888 so
  // the rail frame reads; transparent for the rest).
  const backdrop = backgroundForStyle(rig.style);
  if (backdrop !== 'transparent') {
    offCtx.fillStyle = backdrop;
    offCtx.fillRect(0, 0, off.width, off.height);
  }
  BOARD_DRAWERS[rig.style]({
    ctx: offCtx,
    width: off.width,
    height: off.height,
    scale: 1,
    widthIn: rig.widthIn,
  });
  ctx.drawImage(off, layout.boardOffsetX, layout.boardOffsetY);
}

async function drawPedals(
  ctx: CanvasRenderingContext2D,
  input: RigSnapshotInput,
  layout: SnapshotLayout,
): Promise<void> {
  // Pre-resolve every pedal image in parallel so the draws can be
  // synchronous once everything's decoded.
  const imageEntries = await Promise.all(
    input.placed.map(async (p) => {
      const pedal = input.pedalsById.get(p.pedalId);
      if (!pedal) return [p.id, null] as const;
      const path = pedal.imagePath;
      if (!path || colorFromImagePath(path) !== null) {
        return [p.id, null] as const;
      }
      const img = await loadImage(path).catch(() => null);
      return [p.id, img] as const;
    }),
  );
  const imagesByPlacedId = new Map(imageEntries);

  for (const placed of input.placed) {
    const pedal = input.pedalsById.get(placed.pedalId);
    if (!pedal) continue;
    const widthPx = pedal.widthIn * layout.pxPerInch;
    const heightPx = pedal.depthIn * layout.pxPerInch;
    const footprint = placedFootprint(pedal, placed.rotation);
    const footprintWidthPx = footprint.widthIn * layout.pxPerInch;
    const footprintHeightPx = footprint.depthIn * layout.pxPerInch;
    const x = layout.boardOffsetX + placed.xIn * layout.pxPerInch;
    const y = layout.boardOffsetY + placed.yIn * layout.pxPerInch;

    ctx.save();
    // Translate to the center of the footprint, then rotate, then draw
    // the un-rotated body centered. Matches PedalSprite's CSS where the
    // body rotates inside a footprint-sized outer.
    ctx.translate(x + footprintWidthPx / 2, y + footprintHeightPx / 2);
    ctx.rotate((placed.rotation * Math.PI) / 180);
    const bodyX = -widthPx / 2;
    const bodyY = -heightPx / 2;
    const img = imagesByPlacedId.get(placed.id) ?? null;
    if (img) {
      ctx.drawImage(img, bodyX, bodyY, widthPx, heightPx);
    } else {
      const color = colorFromImagePath(pedal.imagePath) ?? '#444';
      ctx.fillStyle = color;
      ctx.fillRect(bodyX, bodyY, widthPx, heightPx);
      drawPedalLabel(ctx, pedal.name, widthPx, heightPx);
    }
    ctx.restore();
  }
}

function drawPedalLabel(
  ctx: CanvasRenderingContext2D,
  name: string,
  widthPx: number,
  heightPx: number,
): void {
  // 10px is the smallest legible bound; clamp by the body short side so
  // tiny pedals don't get a label that doesn't fit.
  const fontSize = Math.max(10, Math.min(14, Math.min(widthPx, heightPx) / 6));
  ctx.font = `500 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 2;
  ctx.strokeStyle = PEDAL_LABEL_OUTLINE;
  ctx.strokeText(name, 0, 0, widthPx - 4);
  ctx.fillStyle = PEDAL_LABEL_COLOR;
  ctx.fillText(name, 0, 0, widthPx - 4);
}

function drawCables(
  ctx: CanvasRenderingContext2D,
  input: RigSnapshotInput,
  layout: SnapshotLayout,
  chipPositions: Map<string, { xIn: number; yIn: number }>,
): void {
  const { rig, placed, pedalsById, connections, endpoints } = input;
  if (connections.length === 0) return;

  const portIndex = buildPortIndex(placed, pedalsById);
  const endpointById = new Map(endpoints.map((e) => [e.id, e]));
  const keepOutByPlaced = new Map<string, ObstacleRect>();
  for (const p of placed) {
    const def = pedalsById.get(p.pedalId);
    if (!def) continue;
    keepOutByPlaced.set(p.id, keepOutRect(p, def, rig.jackSize));
  }

  const ordered = sortConnectionsForRender(connections, placed, pedalsById);
  const leaderLengths = computeLeaderLengths(
    ordered,
    portIndex,
    keepOutByPlaced,
    undefined,
    undefined,
    0.05,
  );

  interface ResolvedEnd {
    xIn: number;
    yIn: number;
    side: Side;
    color: string;
    isPedal: boolean;
  }
  const metas: {
    id: string;
    from: ResolvedEnd;
    to: ResolvedEnd;
    fromLeaderIn: number;
    toLeaderIn: number;
  }[] = [];
  for (const c of ordered) {
    const from = resolveEnd(
      c.fromNodeKind,
      c.fromNodeId,
      c.fromPortId,
      portIndex,
      endpointById,
      chipPositions,
      rig,
      layout.pxPerInch,
    );
    const to = resolveEnd(
      c.toNodeKind,
      c.toNodeId,
      c.toPortId,
      portIndex,
      endpointById,
      chipPositions,
      rig,
      layout.pxPerInch,
    );
    if (!from || !to) continue;
    metas.push({
      id: c.id,
      from,
      to,
      fromLeaderIn: leaderLengths.get(`${c.id}:from`) ?? LEADER_BASE_IN,
      toLeaderIn: leaderLengths.get(`${c.id}:to`) ?? LEADER_BASE_IN,
    });
  }

  const routingMarginIn = 0.05;
  const inflated = [...keepOutByPlaced.values()].map((r) => ({
    xIn: r.xIn - routingMarginIn,
    yIn: r.yIn - routingMarginIn,
    widthIn: r.widthIn + 2 * routingMarginIn,
    depthIn: r.depthIn + 2 * routingMarginIn,
  }));
  const extraXs = metas.flatMap((m) => [m.from.xIn, m.to.xIn]);
  const extraYs = metas.flatMap((m) => [m.from.yIn, m.to.yIn]);
  const grid = decomposeBoard(
    rig.widthIn,
    rig.depthIn,
    inflated,
    extraXs,
    extraYs,
  );
  const requests: RouteRequest[] = metas.map((m) => ({
    id: m.id,
    from: { xIn: m.from.xIn, yIn: m.from.yIn, side: m.from.side },
    to: { xIn: m.to.xIn, yIn: m.to.yIn, side: m.to.side },
    fromLeaderIn: m.fromLeaderIn,
    toLeaderIn: m.toLeaderIn,
  }));
  const routed = routeAllCables(
    grid,
    requests,
    { boardWidthIn: rig.widthIn, boardDepthIn: rig.depthIn },
    inflated,
  );
  const pathById = new Map(routed.map((r) => [r.id, r.polyline]));

  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const m of metas) {
    const path = pathById.get(m.id);
    if (!path || path.length < 2) continue;
    ctx.strokeStyle = m.from.color;
    ctx.beginPath();
    for (let i = 0; i < path.length; i += 1) {
      const pt = path[i]!;
      const px = layout.boardOffsetX + pt.xIn * layout.pxPerInch;
      const py = layout.boardOffsetY + pt.yIn * layout.pxPerInch;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // End-cap dots on pedal-port ends to read as "plugged in".
    if (m.from.isPedal) drawCableCap(ctx, m.from, layout);
    if (m.to.isPedal) drawCableCap(ctx, m.to, layout);
  }
}

function drawCableCap(
  ctx: CanvasRenderingContext2D,
  end: { xIn: number; yIn: number; color: string },
  layout: SnapshotLayout,
): void {
  ctx.fillStyle = end.color;
  ctx.beginPath();
  ctx.arc(
    layout.boardOffsetX + end.xIn * layout.pxPerInch,
    layout.boardOffsetY + end.yIn * layout.pxPerInch,
    4,
    0,
    2 * Math.PI,
  );
  ctx.fill();
}

function isLeftClusterKind(kind: ExternalEndpointKind): boolean {
  return kind === 'amp_in' || kind === 'amp_fx_return';
}

function resolveEnd(
  kind: 'pedal' | 'external',
  nodeId: string,
  portId: string | null,
  portIndex: Map<string, Map<string, ResolvedPort>>,
  endpointById: Map<string, ExternalEndpoint>,
  chipPositions: Map<string, { xIn: number; yIn: number }>,
  rig: Rig,
  pxPerInch: number,
): {
  xIn: number;
  yIn: number;
  side: Side;
  color: string;
  isPedal: boolean;
} | null {
  if (kind === 'pedal') {
    if (!portId) return null;
    const resolved = portIndex.get(nodeId)?.get(portId);
    if (!resolved) return null;
    return {
      xIn: resolved.xIn,
      yIn: resolved.yIn,
      side: resolved.visualSide,
      color: colorForPort(resolved.port),
      isPedal: true,
    };
  }
  const ep = endpointById.get(nodeId);
  if (!ep) return null;
  // Each chip has a pre-measured bottom-center position in board inch
  // coords (from drawEndpointChips). Use those so cables to multiple
  // sinks/sources land on the correct chips rather than collapsing to
  // a single cluster anchor.
  const measured = chipPositions.get(nodeId);
  if (measured) {
    return {
      xIn: measured.xIn,
      yIn: measured.yIn,
      side: 'bottom',
      color: colorForSignal('instrument'),
      isPedal: false,
    };
  }
  // Fallback if chip rendering was skipped — matches the live overlay's
  // pre-measurement default.
  const isLeft = isLeftClusterKind(ep.kind);
  return {
    xIn: isLeft ? 0.75 : rig.widthIn - 0.75,
    yIn: -8 / pxPerInch,
    side: 'bottom',
    color: colorForSignal('instrument'),
    isPedal: false,
  };
}

function drawEndpointChips(
  ctx: CanvasRenderingContext2D,
  endpoints: ExternalEndpoint[],
  layout: SnapshotLayout,
): Map<string, { xIn: number; yIn: number }> {
  const positions = new Map<string, { xIn: number; yIn: number }>();
  if (!layout.hasEndpoints) return positions;
  ctx.save();
  ctx.font = CHIP_FONT;
  ctx.textBaseline = 'middle';
  const lefts = endpoints.filter((e) => isLeftClusterKind(e.kind));
  const rights = endpoints.filter((e) => !isLeftClusterKind(e.kind));
  const stripY = layout.chipStripOffsetY + CHIP_STRIP_PX / 2;
  drawChipCluster(ctx, lefts, 'left', layout, stripY, positions);
  drawChipCluster(ctx, rights, 'right', layout, stripY, positions);
  ctx.restore();
  return positions;
}

function drawChipCluster(
  ctx: CanvasRenderingContext2D,
  cluster: ExternalEndpoint[],
  side: 'left' | 'right',
  layout: SnapshotLayout,
  centerY: number,
  positions: Map<string, { xIn: number; yIn: number }>,
): void {
  if (cluster.length === 0) return;
  const isLeft = side === 'left';
  const chipHeight = 28;
  const chipPadX = 12;
  const gap = 8;
  ctx.textAlign = 'left';
  // Measure widths so we can lay out left-aligned at board left or
  // right-aligned at board right.
  const labels = cluster.map((e) =>
    isLeft ? `To ${e.label}` : `From ${e.label}`,
  );
  const widths = labels.map((label) => ctx.measureText(label).width);
  let cursorX = isLeft
    ? layout.boardOffsetX
    : layout.boardOffsetX + layout.boardWidthPx;
  for (let i = 0; i < cluster.length; i += 1) {
    const label = labels[i]!;
    const textWidth = widths[i]!;
    const chipWidth = textWidth + chipPadX * 2;
    const chipX = isLeft ? cursorX : cursorX - chipWidth;
    const chipY = centerY - chipHeight / 2;
    fillRoundedRect(
      ctx,
      chipX,
      chipY,
      chipWidth,
      chipHeight,
      8,
      CHIP_BG,
      CHIP_BORDER,
    );
    ctx.fillStyle = CHIP_FG;
    ctx.fillText(label, chipX + chipPadX, centerY);
    // Record the chip's bottom-center in board inch coords so cable
    // routing terminates at the right per-chip x rather than collapsing
    // to one cluster anchor.
    const chipCenterCanvasX = chipX + chipWidth / 2;
    const chipBottomCanvasY = chipY + chipHeight;
    positions.set(cluster[i]!.id, {
      xIn: (chipCenterCanvasX - layout.boardOffsetX) / layout.pxPerInch,
      yIn: (chipBottomCanvasY - layout.boardOffsetY) / layout.pxPerInch,
    });
    cursorX = isLeft ? chipX + chipWidth + gap : chipX - gap;
  }
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  stroke: string,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
}

async function drawWatermark(
  ctx: CanvasRenderingContext2D,
  layout: SnapshotLayout,
): Promise<void> {
  // The Audiowide font is loaded by index.html via Google Fonts. Wait
  // for it explicitly so the first share after page load uses the right
  // typeface — without this, canvas falls back to the system stack and
  // "Rig Planner" reads as a generic sans-serif.
  await ensureFontLoaded(`400 ${WATERMARK_TITLE_FONT_SIZE}px Audiowide`).catch(
    () => {
      // Font load failures degrade gracefully — canvas uses the next
      // family in the stack ("SF Pro Rounded" / system-ui).
    },
  );

  // Anchor at the bottom-left of the canvas with a small inset, then lay
  // "Rig Planner" + the SC horizontal lockup left-to-right on a shared
  // baseline.
  const baselineY =
    layout.canvasHeight - WATERMARK_BASELINE_INSET_PX - PAD_PX / 2;
  const xCursor = layout.boardOffsetX + WATERMARK_INSET_X_PX;
  ctx.save();
  ctx.font = WATERMARK_TITLE_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#1f2937';
  ctx.fillText('Rig Planner', xCursor, baselineY);
  const titleWidth = ctx.measureText('Rig Planner').width;
  ctx.restore();

  const logo = await loadImage(processedLogoUrl()).catch(() => null);
  if (!logo) return;
  const logoH = WATERMARK_LOGO_HEIGHT_PX;
  // The processed SVG carries explicit viewBox-derived dimensions, so
  // the aspect ratio is known up front.
  const logoW = logoH * (3400 / 720);
  const logoX = xCursor + titleWidth + WATERMARK_GAP_PX;
  // Align the logo's vertical center with the title's optical center
  // (roughly 30% above the alphabetic baseline for the chosen font).
  const logoY = baselineY - WATERMARK_TITLE_FONT_SIZE * 0.7;
  ctx.drawImage(logo, logoX, logoY, logoW, logoH);
}

let cachedProcessedLogoUrl: string | null = null;
/**
 * The bundled horizontal-light SVG has `width="100%" height="100%"` (no
 * intrinsic pixel size, so `drawImage` falls back to 0×0 on Chrome and
 * skips the draw entirely) and a near-white fill `rgb(226,236,239)` that
 * would be invisible on the snapshot's light background.
 *
 * Patch both at module-init time: rewrite the dimensions from the viewBox
 * and swap the white fill for a dark slate, then encode the result as a
 * data URL we can hand to `Image.src`. The asset file on disk stays
 * untouched — AboutScreen and RigList still use the original light SVG.
 */
function processedLogoUrl(): string {
  if (cachedProcessedLogoUrl !== null) return cachedProcessedLogoUrl;
  const patched = strayCircuitsLogoRaw
    .replace('width="100%" height="100%"', 'width="3400" height="720"')
    .replace(/rgb\(226,236,239\)/g, 'rgb(31,41,55)');
  cachedProcessedLogoUrl = `data:image/svg+xml;utf8,${encodeURIComponent(patched)}`;
  return cachedProcessedLogoUrl;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

/**
 * Cap the wait on `document.fonts.load` so we don't hang the share flow
 * if Google Fonts is slow or blocked. Anecdotally on the Android APK a
 * cold-start share could sit for 10–30 s waiting on the Audiowide font
 * fetch with no timeout. After the deadline the canvas falls back to the
 * next family in the stack ("SF Pro Rounded" / system-ui).
 */
const FONT_LOAD_TIMEOUT_MS = 1200;
async function ensureFontLoaded(font: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.race([
    document.fonts.load(font),
    new Promise<void>((resolve) => {
      setTimeout(resolve, FONT_LOAD_TIMEOUT_MS);
    }),
  ]);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob returned null'));
    }, 'image/png');
  });
}
