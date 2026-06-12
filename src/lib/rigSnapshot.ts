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
  Pedal,
  PlacedPedal,
  Rig,
  Side,
} from '../data/schema';
import { resolveBoardImageSrc } from '../data/boardPresets';
import { BOARD_DRAWERS, backgroundForStyle } from '../canvas/boardStyles';
import { loadBoardImage } from '../canvas/boardImageCache';
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
import { isEndpointSink } from './externalIo';
import type { CustomFloor, FloorStyle } from './floorStyle';
import strayCircuitsLogoRaw from '../assets/brand/stray-circuits-horizontal-light.svg?raw';

/**
 * Render scale for the snapshot. With WebP encoding (~210 ms for a
 * 590×1035 canvas on the Android APK), 50 ppi is the sharp-detail tier
 * we can afford without losing snappiness — encode budget extrapolates
 * to ~600 ms at this resolution. The watermark is sized in absolute
 * pixels so it stays legible at this output size.
 */
export const SNAPSHOT_PX_PER_INCH = 50;

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
const WATERMARK_TITLE_FONT_SIZE = 44;
const WATERMARK_TITLE_FONT = `400 ${WATERMARK_TITLE_FONT_SIZE}px Audiowide, ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
/** SC horizontal lockup — 2× title height, pinned to the canvas bottom-right. */
const WATERMARK_LOGO_HEIGHT_PX = WATERMARK_TITLE_FONT_SIZE * 2;
const WATERMARK_INSET_X_PX = 8;
const WATERMARK_BASELINE_INSET_PX = 12;
/** Bump the title baseline up enough that its optical center aligns with
 *  the logo's vertical center. Audiowide's cap height sits ~72% of font
 *  size above the alphabetic baseline, and the logo center sits at
 *  logoH/2 above its bottom — this nudge brings the title up to roughly
 *  that midpoint instead of sitting flush with the logo's baseline. */
const WATERMARK_TITLE_BOTTOM_BUMP_PX = 24;
/** Vertical gap between the bottom of the board and the watermark band. */
const WATERMARK_TOP_GAP_PX = 12;
/** Band height tracks the tallest watermark element (the logo) plus the inset. */
const WATERMARK_HEIGHT_PX =
  WATERMARK_LOGO_HEIGHT_PX + WATERMARK_BASELINE_INSET_PX + 12;
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
  /** Mime type the blob was encoded as (e.g. 'image/webp'). */
  mimeType: string;
  /** Sensible filename extension matching the mime type (e.g. 'webp'). */
  fileExtension: string;
}

/** WebP encoder quality. WebP is generally faster to encode than JPEG on
 *  Chromium-based WebViews and produces smaller files at similar visual
 *  quality. Solid floor background means we never need alpha. */
const SNAPSHOT_ENCODE_QUALITY = 0.85;
const SNAPSHOT_MIME_TYPE = 'image/webp';
const SNAPSHOT_FILE_EXTENSION = 'webp';

/**
 * Compose a rig snapshot image. Resolves with the encoded Blob plus the
 * canvas dimensions, mime type, and an appropriate file extension.
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
  // `willReadFrequently: true` keeps the canvas backing store in CPU
  // memory instead of on the GPU. The default GPU-accelerated 2D context
  // pays a GPU→CPU readback cost on every `toBlob`/`getImageData` call;
  // measured on the Android APK that readback was ~13s regardless of
  // canvas size (50 ppi vs 30 ppi made no difference to encode time).
  // CPU-backed canvas makes draw ops a touch slower but `toBlob` cheap,
  // which is the right tradeoff for a one-shot snapshot.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
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
  await drawWatermark(ctx, layout, input.floorStyle, input.customFloor);

  const blob = await canvasToBlob(canvas);
  return {
    blob,
    widthPx: layout.canvasWidth,
    heightPx: layout.canvasHeight,
    mimeType: SNAPSHOT_MIME_TYPE,
    fileExtension: SNAPSHOT_FILE_EXTENSION,
  };
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
  const watermarkOffsetY = boardOffsetY + boardHeightPx + WATERMARK_TOP_GAP_PX;
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
    // Route board images through the shared cache so the snapshot reuses
    // the already-decoded image the live BoardCanvas pinned in memory
    // — saves a redecode per share.
    const img = await loadBoardImage(src).catch(() => null);
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
  BOARD_DRAWERS[rig.style]({
    ctx: offCtx,
    width: off.width,
    height: off.height,
    scale: 1,
    widthIn: rig.widthIn,
  });
  // Backdrop is painted AFTER the drawer so it fills the gaps the drawer
  // left transparent (rail bars sit on a #888 frame; holes punch through
  // to floor). Using destination-over slips the fill underneath the
  // drawer's pixels without overwriting them — painting the backdrop
  // first would just be wiped by the drawer's leading clearRect.
  const backdrop = backgroundForStyle(rig.style);
  if (backdrop !== 'transparent') {
    offCtx.save();
    offCtx.globalCompositeOperation = 'destination-over';
    offCtx.fillStyle = backdrop;
    offCtx.fillRect(0, 0, off.width, off.height);
    offCtx.restore();
  }
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
      // Explicit `color:#hex` placeholders honour their stored color.
      // Pedals with a real image that failed to load (offline, stale
      // cache) fall back to a name-derived color instead of a uniform
      // grey, so the shared snapshot stays visually distinguishable
      // instead of collapsing every failed-photo pedal into the same
      // rectangle.
      const color =
        colorFromImagePath(pedal.imagePath) ?? fallbackPedalColor(pedal.name);
      ctx.fillStyle = color;
      ctx.fillRect(bodyX, bodyY, widthPx, heightPx);
      drawPedalLabel(ctx, pedal.name, widthPx, heightPx);
    }
    ctx.restore();
  }
}

/** Deterministic dark color derived from a pedal name, used when a
 *  photo-pedal's image fails to load (offline, stale cache). Keeps each
 *  fallback pedal visually distinct instead of every one rendering as
 *  the same grey rectangle. Hues stay in the upper third of the wheel
 *  away from the bright signal-color palette so they read as muted. */
function fallbackPedalColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 22%, 32%)`;
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
    // Prefer the pedal-side color so endpoint-originated cables (e.g.
    // amp_fx_send → first pedal) inherit the signal type from the pedal
    // port instead of always rendering as the endpoint's instrument
    // default. Matches the live overlay's per-port coloring more
    // closely.
    ctx.strokeStyle = m.from.isPedal
      ? m.from.color
      : m.to.isPedal
        ? m.to.color
        : m.from.color;
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
  const isLeft = isEndpointSink(ep.kind);
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
  const lefts = endpoints.filter((e) => isEndpointSink(e.kind));
  const rights = endpoints.filter((e) => !isEndpointSink(e.kind));
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

/** Pick a high-contrast watermark color (black or white) based on the
 *  floor brightness. For 'custom' we run a YIQ luminance check on the
 *  user's color; for the named presets we hardcode against the average
 *  texture color (those are fixed assets, no point sampling at runtime). */
function watermarkColorForFloor(
  style: FloorStyle,
  custom: CustomFloor,
): { fill: string; logoFill: string } {
  if (style === 'custom') {
    const hex = custom.color.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 140
      ? { fill: '#000', logoFill: '#000' }
      : { fill: '#fff', logoFill: '#fff' };
  }
  switch (style) {
    case 'stage_black':
    case 'wood':
      return { fill: '#fff', logoFill: '#fff' };
    case 'concrete_grey':
    case 'carpet_beige':
    case 'sidewalk':
      return { fill: '#000', logoFill: '#000' };
  }
}

async function drawWatermark(
  ctx: CanvasRenderingContext2D,
  layout: SnapshotLayout,
  floorStyle: FloorStyle,
  customFloor: CustomFloor,
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

  // Title pinned bottom-left, SC lockup pinned bottom-right with matching
  // insets. Logo bottom sits on `baselineY`; the title's baseline gets
  // bumped up so its optical center is closer to the logo's center.
  const { fill, logoFill } = watermarkColorForFloor(floorStyle, customFloor);
  const baselineY =
    layout.canvasHeight - WATERMARK_BASELINE_INSET_PX - PAD_PX / 2;
  const leftInset = layout.boardOffsetX + WATERMARK_INSET_X_PX;
  const rightInset =
    layout.boardOffsetX + layout.boardWidthPx - WATERMARK_INSET_X_PX;

  ctx.save();
  ctx.font = WATERMARK_TITLE_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const titleWidth = ctx.measureText('Rig Planner').width;
  ctx.fillStyle = fill;
  ctx.fillText(
    'Rig Planner',
    leftInset,
    baselineY - WATERMARK_TITLE_BOTTOM_BUMP_PX,
  );
  ctx.restore();

  const logo = await loadImage(processedLogoUrl(logoFill)).catch(() => null);
  if (!logo) return;
  // Default logo size; shrink it if the canvas is too narrow to fit the
  // title + a gap + the lockup side-by-side. Without this guard, the
  // title (left-anchored) and the logo (right-anchored) collide on
  // narrow boards at low ppi — that was the overlap in the shared file.
  const LOGO_MIN_GAP_PX = 20;
  const wantedLogoW = WATERMARK_LOGO_HEIGHT_PX * (3400 / 720);
  const availableLogoW =
    rightInset - (leftInset + titleWidth + LOGO_MIN_GAP_PX);
  const logoW = Math.max(0, Math.min(wantedLogoW, availableLogoW));
  if (logoW <= 0) return;
  const logoH = logoW * (720 / 3400);
  const logoX = rightInset - logoW;
  // Logo bottom aligned with baselineY so it sits flush against the band.
  const logoY = baselineY - logoH;
  ctx.drawImage(logo, logoX, logoY, logoW, logoH);
}

const cachedProcessedLogoUrl = new Map<string, string>();
/**
 * The bundled horizontal-light SVG renders white-on-transparent — fine
 * for AboutScreen (dark background) but invisible on the snapshot's
 * light watermark area. Swap the fill to the snapshot's chosen contrast
 * color and encode as a data URL we can hand to `Image.src`. The asset
 * itself stays the original light-fill SVG so AboutScreen / RigList are
 * unaffected.
 *
 * Memoized per target fill so we don't re-encode on every share.
 */
const SVG_SOURCE_FILL = /rgb\(226,236,239\)/g;
function processedLogoUrl(fill: string): string {
  const cached = cachedProcessedLogoUrl.get(fill);
  if (cached !== undefined) return cached;
  if (!SVG_SOURCE_FILL.test(strayCircuitsLogoRaw)) {
    // Asset's source fill literal changed and our patch no longer matches
    // — log so a regression surfaces in dev, then fall through to the
    // unpatched SVG (better than a silent no-show).
    console.warn(
      '[rigSnapshot] SC logo fill literal changed; watermark will use asset default color',
    );
  }
  // RegExp objects with /g track lastIndex; reset before reuse.
  SVG_SOURCE_FILL.lastIndex = 0;
  const patched = strayCircuitsLogoRaw.replace(SVG_SOURCE_FILL, fill);
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(patched)}`;
  cachedProcessedLogoUrl.set(fill, url);
  return url;
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
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('canvas.toBlob returned null'));
      },
      SNAPSHOT_MIME_TYPE,
      SNAPSHOT_ENCODE_QUALITY,
    );
  });
}
