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
import strayCircuitsLogoUrl from '../assets/brand/stray-circuits-horizontal-light.svg';

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
/** Watermark area beneath the board: "Rig Planner" + SC horizontal logo. */
const WATERMARK_HEIGHT_PX = 96;
const WATERMARK_TITLE_FONT =
  '400 36px Audiowide, ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
const WATERMARK_SUBTITLE_LOGO_HEIGHT_PX = 22;
const WATERMARK_GAP_PX = 8;
const BACKGROUND_FILL = '#f8f9fb';
const BOARD_FALLBACK_FILL = '#3d3d40';
const PEDAL_LABEL_COLOR = 'rgba(255, 255, 255, 0.95)';
const PEDAL_LABEL_OUTLINE = 'rgba(0, 0, 0, 0.7)';

export interface RigSnapshotInput {
  rig: Rig;
  placed: PlacedPedal[];
  pedalsById: Map<string, Pedal>;
  connections: Connection[];
  endpoints: ExternalEndpoint[];
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
  const layout = computeSnapshotLayout(input.rig, input.endpoints);
  const canvas = document.createElement('canvas');
  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not acquire 2D rendering context');
  }
  ctx.fillStyle = BACKGROUND_FILL;
  ctx.fillRect(0, 0, layout.canvasWidth, layout.canvasHeight);

  await drawBoard(ctx, input.rig, layout);
  drawEndpointChips(ctx, input.endpoints, layout);
  await drawPedals(ctx, input, layout);
  drawCables(ctx, input, layout);
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
): SnapshotLayout {
  const pxPerInch = SNAPSHOT_PX_PER_INCH;
  const boardWidthPx = rig.widthIn * pxPerInch;
  const boardHeightPx = rig.depthIn * pxPerInch;
  const hasEndpoints = endpoints.length > 0;
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

async function drawBoard(
  ctx: CanvasRenderingContext2D,
  rig: Rig,
  layout: SnapshotLayout,
): Promise<void> {
  // Fallback fill first so transparent PNG areas still read as a board.
  ctx.fillStyle = BOARD_FALLBACK_FILL;
  ctx.fillRect(
    layout.boardOffsetX,
    layout.boardOffsetY,
    layout.boardWidthPx,
    layout.boardHeightPx,
  );
  const src = resolveBoardImageSrc({
    style: rig.style,
    presetId: rig.presetId,
    widthIn: rig.widthIn,
    depthIn: rig.depthIn,
  });
  if (src === null) return;
  const img = await loadImage(src).catch(() => null);
  if (!img) return;
  ctx.drawImage(
    img,
    layout.boardOffsetX,
    layout.boardOffsetY,
    layout.boardWidthPx,
    layout.boardHeightPx,
  );
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
      rig,
      layout.pxPerInch,
    );
    const to = resolveEnd(
      c.toNodeKind,
      c.toNodeId,
      c.toPortId,
      portIndex,
      endpointById,
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
  // Chip strip lives above the board top in the live view at ~8px above.
  // Use the same fallback geometry so cables route naturally toward the
  // labeled chip strip we draw in drawEndpointChips.
  const yIn = -8 / pxPerInch;
  const isLeft = isLeftClusterKind(ep.kind);
  const xIn = isLeft ? 0.75 : rig.widthIn - 0.75;
  return {
    xIn,
    yIn,
    side: 'bottom',
    color: colorForSignal('instrument'),
    isPedal: false,
  };
}

function drawEndpointChips(
  ctx: CanvasRenderingContext2D,
  endpoints: ExternalEndpoint[],
  layout: SnapshotLayout,
): void {
  if (!layout.hasEndpoints) return;
  ctx.font = CHIP_FONT;
  ctx.textBaseline = 'middle';
  const lefts = endpoints.filter((e) => isLeftClusterKind(e.kind));
  const rights = endpoints.filter((e) => !isLeftClusterKind(e.kind));
  const stripY = layout.chipStripOffsetY + CHIP_STRIP_PX / 2;
  drawChipCluster(ctx, lefts, 'left', layout, stripY);
  drawChipCluster(ctx, rights, 'right', layout, stripY);
}

function drawChipCluster(
  ctx: CanvasRenderingContext2D,
  cluster: ExternalEndpoint[],
  side: 'left' | 'right',
  layout: SnapshotLayout,
  centerY: number,
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
  await ensureFontLoaded('400 36px Audiowide').catch(() => {
    // Font load failures degrade gracefully — canvas uses the next
    // family in the stack ("SF Pro Rounded" / system-ui).
  });

  const centerX = layout.canvasWidth / 2;
  const titleY = layout.watermarkOffsetY + 36;
  ctx.font = WATERMARK_TITLE_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#1f2937';
  ctx.fillText('Rig Planner', centerX, titleY);

  const logo = await loadImage(strayCircuitsLogoUrl).catch(() => null);
  if (!logo) return;
  const aspect =
    logo.naturalWidth > 0 && logo.naturalHeight > 0
      ? logo.naturalWidth / logo.naturalHeight
      : 5;
  const logoH = WATERMARK_SUBTITLE_LOGO_HEIGHT_PX;
  const logoW = logoH * aspect;
  const logoX = centerX - logoW / 2;
  const logoY = titleY + WATERMARK_GAP_PX;
  ctx.drawImage(logo, logoX, logoY, logoW, logoH);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

async function ensureFontLoaded(font: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await document.fonts.load(font);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob returned null'));
    }, 'image/png');
  });
}
