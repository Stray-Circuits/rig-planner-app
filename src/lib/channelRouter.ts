/**
 * Channel-graph cable router.
 *
 * Replaces the previous 3-seg + 5-seg + A* + scoring pipeline with a
 * single mental model:
 *
 *   1. Decompose the board into rectilinear cells by slicing at every
 *      obstacle edge. Cells inside any obstacle are "blocked"; the
 *      rest are routing channels.
 *   2. Build a graph: nodes = open cells, edges = adjacencies. Each
 *      edge carries a length (Manhattan between cell centres) and an
 *      orientation (horizontal/vertical) used for turn cost.
 *   3. Route each cable via Dijkstra. Cost = edge length +
 *      TURN_PENALTY on orientation changes + capacity penalty so
 *      cables that share a cell pay more, naturally pushing them onto
 *      alternative routes.
 *   4. After all cables are routed once, run a bounded rip-up pass:
 *      for every pair of cables whose polylines visually cross, try
 *      rerouting the lower-priority cable with the other's cells
 *      "soft-blocked". Accept the reroute if it removes the crossing
 *      without making things worse.
 *
 * Why this works where the previous setup didn't: the cost function
 * is uniform across the WHOLE board (one Dijkstra, one cost), instead
 * of three independent generators with six interacting penalties. The
 * cells encode "this region is shared with N other cables" directly,
 * so lane stacking shows up in the score automatically rather than as
 * a post-hoc fan-out fix.
 *
 * What this DOES NOT do (intentionally):
 *   - It does not place cables to exact pixel-perfect lanes. The
 *     materialised polyline sits on the cell centre line; if you want
 *     parallel side-by-side cables, that's still a render-time
 *     concern.
 *   - It does not handle leader segments. Callers prepend / append
 *     leaders themselves (see `routeCableWithLeader`).
 */
import type { Side } from '../data/schema';
import type { ObstacleRect, RouteOptions } from './geometry';
import { sideOutwardUnit } from './geometry';

/** A rectilinear cell of the board after slicing at obstacle edges. */
export interface Cell {
  /** Row index in the cell grid (0-based, top to bottom). */
  row: number;
  /** Column index in the cell grid (0-based, left to right). */
  col: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** True if the cell lies inside any obstacle. Routing skips it. */
  blocked: boolean;
}

export interface CellGrid {
  /** All cells in row-major order. `cells[row * cols + col]`. */
  cells: Cell[];
  /** Sorted unique x-coordinates that define cell column boundaries. */
  xs: number[];
  /** Sorted unique y-coordinates that define cell row boundaries. */
  ys: number[];
  rows: number;
  cols: number;
}

/**
 * Endpoint describing where a cable enters or exits the cell graph.
 * The router treats the endpoint coordinate as a virtual node attached
 * to the cell that contains it.
 */
export interface CableEnd {
  xIn: number;
  yIn: number;
  side: Side;
}

export interface RouteRequest {
  id: string;
  from: CableEnd;
  to: CableEnd;
  /** Optional leader lengths; default LEADER_BASE_IN. */
  fromLeaderIn?: number;
  toLeaderIn?: number;
}

export interface RoutedPath {
  id: string;
  /**
   * Full polyline including leader segments at both ends. First point
   * is the source port, last is the destination port.
   */
  polyline: { xIn: number; yIn: number }[];
}

interface RouterConfig {
  boardWidthIn: number;
  boardDepthIn: number;
  /** TURN_PENALTY in route cost (inches-equivalent). */
  turnPenalty: number;
  /** Per-cable cost added per neighbour already using a cell. */
  capacityCost: number;
  /** Maximum cables a cell can host before its cost spikes hard. */
  cellMaxCables: number;
  /** Cost penalty per cable beyond cellMaxCables. */
  capacityOverflowCost: number;
  /**
   * Per-inch surcharge for edges that lie partly off-board. Without
   * this, Dijkstra happily wraps cables through the off-board cells
   * we add for chip-strip endpoints (since those cells have zero
   * capacity penalty). Sized so even a tiny off-board edge costs
   * more than a long on-board one.
   */
  offBoardCost: number;
  /** Max iterations for the rip-up pass. */
  ripUpIterations: number;
  /** Default leader length when a request omits one. */
  defaultLeader: number;
}

const DEFAULT_CONFIG: RouterConfig = {
  boardWidthIn: 20,
  boardDepthIn: 14,
  turnPenalty: 0.6,
  // Capacity cost is intentionally small — it nudges later cables to
  // prefer empty lanes when the cost difference is otherwise a tie,
  // but never large enough to dominate physical length. If it's too
  // large the router prefers a longer perimeter wrap over sharing a
  // corridor with one other cable.
  capacityCost: 0.05,
  cellMaxCables: 4,
  capacityOverflowCost: 2,
  // Off-board cost is per inch of travel through a cell that's even
  // partly outside the board. Large enough that perimeter wraps
  // (which dip below or above the board to find empty cells) never
  // win against straight-through-the-corridor routes.
  offBoardCost: 50,
  ripUpIterations: 2,
  defaultLeader: 0.4,
};

// ---------------------------------------------------------------------------
// Step 1: board decomposition
// ---------------------------------------------------------------------------

/**
 * Slice the board into a grid of axis-aligned cells from the union of
 * obstacle edges + board edges + provided slice points (port leader-
 * tip coordinates). Cells inside any obstacle's rect are flagged as
 * blocked.
 *
 * `extraXs` / `extraYs` let callers force a slice at specific
 * coordinates (e.g. port locations) so port endpoints land on a cell
 * boundary instead of the middle of one cell.
 */
export function decomposeBoard(
  boardWidthIn: number,
  boardDepthIn: number,
  obstacles: readonly ObstacleRect[],
  extraXs: readonly number[] = [],
  extraYs: readonly number[] = [],
): CellGrid {
  const xSet = new Set<number>();
  const ySet = new Set<number>();
  xSet.add(0);
  xSet.add(boardWidthIn);
  ySet.add(0);
  ySet.add(boardDepthIn);
  // Extend slightly past the board so port endpoints that land just
  // off the edge (chip strip endpoints at y=-0.5) still have a cell.
  xSet.add(-1);
  xSet.add(boardWidthIn + 1);
  ySet.add(-1);
  ySet.add(boardDepthIn + 1);
  for (const r of obstacles) {
    xSet.add(r.xIn);
    xSet.add(r.xIn + r.widthIn);
    ySet.add(r.yIn);
    ySet.add(r.yIn + r.depthIn);
  }
  for (const x of extraXs) xSet.add(x);
  for (const y of extraYs) ySet.add(y);
  // Force a periodic slice so wide-open regions don't collapse into
  // single giant cells. Without this, the router treats a 4"-wide
  // open cell as one cheap hop and prefers wrapping through the
  // perimeter (which is mostly such cells) over routing through the
  // densely-sliced middle.
  const PERIODIC = 0.5;
  for (let x = 0; x <= boardWidthIn; x += PERIODIC) xSet.add(x);
  for (let y = 0; y <= boardDepthIn; y += PERIODIC) ySet.add(y);
  const xs = [...xSet].sort((a, b) => a - b);
  const ys = [...ySet].sort((a, b) => a - b);
  const cols = xs.length - 1;
  const rows = ys.length - 1;
  const cells: Cell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const xMin = xs[col]!;
      const xMax = xs[col + 1]!;
      const yMin = ys[row]!;
      const yMax = ys[row + 1]!;
      const blocked = cellIntersectsAnyObstacle(
        xMin,
        xMax,
        yMin,
        yMax,
        obstacles,
      );
      cells.push({ row, col, xMin, xMax, yMin, yMax, blocked });
    }
  }
  return { cells, xs, ys, rows, cols };
}

function cellIntersectsAnyObstacle(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  obstacles: readonly ObstacleRect[],
): boolean {
  // Cell centre — if the centre lies inside an obstacle, the cell is
  // blocked. Edge-of-cell touching is allowed.
  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;
  for (const r of obstacles) {
    if (
      cx > r.xIn &&
      cx < r.xIn + r.widthIn &&
      cy > r.yIn &&
      cy < r.yIn + r.depthIn
    ) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Step 2: routing graph
// ---------------------------------------------------------------------------

/**
 * Find the cell containing point (x, y). Returns null if the point
 * is outside the slice range or in a blocked cell.
 */
export function cellAt(grid: CellGrid, x: number, y: number): Cell | null {
  let col = -1;
  for (let i = 0; i < grid.cols; i++) {
    if (x >= grid.xs[i]! && x <= grid.xs[i + 1]!) {
      col = i;
      break;
    }
  }
  let row = -1;
  for (let i = 0; i < grid.rows; i++) {
    if (y >= grid.ys[i]! && y <= grid.ys[i + 1]!) {
      row = i;
      break;
    }
  }
  if (col < 0 || row < 0) return null;
  return grid.cells[row * grid.cols + col] ?? null;
}

/**
 * Pick a non-blocked cell adjacent to (or containing) the given point.
 * Used for endpoint attachment — if the point itself falls in a
 * blocked cell, we want the nearest open cell in the outward
 * direction (so cable leaders exit "into" the channel, not back
 * through the pedal).
 */
function findRoutingCell(
  grid: CellGrid,
  point: { xIn: number; yIn: number; side: Side },
): Cell | null {
  const direct = cellAt(grid, point.xIn, point.yIn);
  if (direct && !direct.blocked) return direct;
  // Step outward in the side direction until we find an open cell.
  const unit = sideOutwardUnit(point.side);
  for (let step = 1; step <= 30; step++) {
    const x = point.xIn + unit.x * 0.05 * step;
    const y = point.yIn + unit.y * 0.05 * step;
    const c = cellAt(grid, x, y);
    if (c && !c.blocked) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Step 3: Dijkstra over the cell grid
// ---------------------------------------------------------------------------

const DIR_H = 0;
const DIR_V = 1;
const DIR_NONE = 2;

/**
 * Run Dijkstra from `start` to `end` over `grid`. Returns the cell
 * sequence (in routing order) or null if no path exists.
 *
 * `cellUsage[cellIdx]` is how many cables already pass through that
 * cell; the search adds a soft cost so paths prefer empty cells.
 * Cells past `cellMaxCables` get a hard overflow cost (still
 * traversable but very expensive — used as a soft barrier rather
 * than a hard block so the router never gets stuck).
 */
function dijkstra(
  grid: CellGrid,
  start: Cell,
  end: Cell,
  cellUsage: Int32Array,
  config: RouterConfig,
): Cell[] | null {
  if (start === end) return [start];
  const N = grid.rows * grid.cols;
  const STATES = N * 3; // 3 incoming-direction states per cell
  const dist = new Float64Array(STATES);
  dist.fill(Infinity);
  const parent = new Int32Array(STATES);
  parent.fill(-1);
  const startState = start.row * grid.cols * 3 + start.col * 3 + DIR_NONE;
  dist[startState] = 0;
  // Simple binary heap keyed by f-score.
  const heap: { f: number; state: number }[] = [
    { f: heuristic(grid, start, end), state: startState },
  ];
  const heapPush = (item: { f: number; state: number }): void => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]!.f <= heap[i]!.f) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const heapPop = (): { f: number; state: number } | undefined => {
    if (heap.length === 0) return undefined;
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      while (true) {
        const l = 2 * i + 1;
        const r = l + 1;
        let best = i;
        if (l < heap.length && heap[l]!.f < heap[best]!.f) best = l;
        if (r < heap.length && heap[r]!.f < heap[best]!.f) best = r;
        if (best === i) break;
        [heap[best], heap[i]] = [heap[i]!, heap[best]!];
        i = best;
      }
    }
    return top;
  };
  const endIdx = end.row * grid.cols + end.col;
  let foundState = -1;
  while (heap.length > 0) {
    const top = heapPop()!;
    const state = top.state;
    const dir = state % 3;
    const cellIdx = (state - dir) / 3;
    if (cellIdx === endIdx) {
      foundState = state;
      break;
    }
    if (top.f > dist[state]! + heuristic(grid, idxToCell(grid, cellIdx), end))
      continue;
    const cell = idxToCell(grid, cellIdx);
    for (const next of neighbours(grid, cell)) {
      if (next.blocked) continue;
      const moveDir =
        next.row === cell.row ? DIR_H : next.col === cell.col ? DIR_V : -1;
      if (moveDir < 0) continue;
      const edgeLen = Math.abs(
        (next.xMin + next.xMax) / 2 -
          (cell.xMin + cell.xMax) / 2 +
          ((next.yMin + next.yMax) / 2 - (cell.yMin + cell.yMax) / 2),
      );
      const turn = dir !== DIR_NONE && dir !== moveDir ? config.turnPenalty : 0;
      const nextIdx = next.row * grid.cols + next.col;
      const used = cellUsage[nextIdx]!;
      const overflow = Math.max(0, used - config.cellMaxCables);
      const capacityPenalty =
        config.capacityCost * used + config.capacityOverflowCost * overflow;
      const offBoard =
        next.xMax <= 0 ||
        next.xMin >= config.boardWidthIn ||
        next.yMax <= 0 ||
        next.yMin >= config.boardDepthIn;
      const offBoardPenalty = offBoard ? config.offBoardCost * edgeLen : 0;
      const newDist =
        dist[state]! + edgeLen + turn + capacityPenalty + offBoardPenalty;
      const nextState = nextIdx * 3 + moveDir;
      if (newDist < dist[nextState]!) {
        dist[nextState] = newDist;
        parent[nextState] = state;
        heapPush({ f: newDist + heuristic(grid, next, end), state: nextState });
      }
    }
  }
  if (foundState < 0) return null;
  // Reconstruct.
  const reversed: Cell[] = [];
  let s = foundState;
  while (s !== -1) {
    const dir = s % 3;
    const cellIdx = (s - dir) / 3;
    reversed.push(idxToCell(grid, cellIdx));
    s = parent[s]!;
  }
  return reversed.reverse();
}

function idxToCell(grid: CellGrid, idx: number): Cell {
  return grid.cells[idx]!;
}

function heuristic(_grid: CellGrid, a: Cell, b: Cell): number {
  const ax = (a.xMin + a.xMax) / 2;
  const ay = (a.yMin + a.yMax) / 2;
  const bx = (b.xMin + b.xMax) / 2;
  const by = (b.yMin + b.yMax) / 2;
  return Math.abs(bx - ax) + Math.abs(by - ay);
}

function neighbours(grid: CellGrid, cell: Cell): Cell[] {
  const out: Cell[] = [];
  if (cell.col > 0) {
    out.push(grid.cells[cell.row * grid.cols + (cell.col - 1)]!);
  }
  if (cell.col + 1 < grid.cols) {
    out.push(grid.cells[cell.row * grid.cols + (cell.col + 1)]!);
  }
  if (cell.row > 0) {
    out.push(grid.cells[(cell.row - 1) * grid.cols + cell.col]!);
  }
  if (cell.row + 1 < grid.rows) {
    out.push(grid.cells[(cell.row + 1) * grid.cols + cell.col]!);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 4: materialise cell sequence to polyline
// ---------------------------------------------------------------------------

/**
 * Convert a cell sequence into an orthogonal polyline. The path
 * enters each cell at the boundary shared with the previous cell
 * and exits at the boundary shared with the next. Within a single
 * cell, the route is straight along whichever axis we're crossing.
 *
 * The first and last cells use the cable's port-leader-tip
 * coordinate as their entry/exit.
 *
 * Strips zero-length and colinear-consecutive segments so the
 * returned polyline is as flat as possible.
 */
function cellPathToPolyline(
  cells: Cell[],
  fromLeaderTip: { xIn: number; yIn: number },
  toLeaderTip: { xIn: number; yIn: number },
): { xIn: number; yIn: number }[] {
  if (cells.length === 0) {
    return [fromLeaderTip, toLeaderTip];
  }
  const points: { xIn: number; yIn: number }[] = [fromLeaderTip];
  let prev: { xIn: number; yIn: number } = fromLeaderTip;
  for (let i = 0; i < cells.length - 1; i++) {
    const cur = cells[i]!;
    const next = cells[i + 1]!;
    // Find the shared edge midpoint.
    let crossX: number;
    let crossY: number;
    if (next.col === cur.col + 1) {
      // Moving right — cross the shared vertical edge at xMax = next.xMin.
      crossX = cur.xMax;
      crossY = prev.yIn;
    } else if (next.col === cur.col - 1) {
      crossX = cur.xMin;
      crossY = prev.yIn;
    } else if (next.row === cur.row + 1) {
      crossY = cur.yMax;
      crossX = prev.xIn;
    } else {
      crossY = cur.yMin;
      crossX = prev.xIn;
    }
    // Insert a corner if we need to change direction inside this cell.
    if (
      Math.abs(crossX - prev.xIn) > 1e-6 &&
      Math.abs(crossY - prev.yIn) > 1e-6
    ) {
      // Need an elbow: keep prev.x then move in y, or vice versa.
      // Pick whichever matches the cell's exit axis: if we're crossing
      // a vertical edge (col change), end y is prev.yIn so elbow is
      // horizontal-first.
      const elbow =
        next.col !== cur.col
          ? { xIn: crossX, yIn: prev.yIn }
          : { xIn: prev.xIn, yIn: crossY };
      points.push(elbow);
    }
    const cross = { xIn: crossX, yIn: crossY };
    points.push(cross);
    prev = cross;
  }
  // Drive from the final cell exit to the destination leader tip.
  if (
    Math.abs(toLeaderTip.xIn - prev.xIn) > 1e-6 &&
    Math.abs(toLeaderTip.yIn - prev.yIn) > 1e-6
  ) {
    // Add elbow.
    points.push({ xIn: toLeaderTip.xIn, yIn: prev.yIn });
  }
  points.push(toLeaderTip);
  return dedupe(points);
}

function dedupe(
  points: { xIn: number; yIn: number }[],
): { xIn: number; yIn: number }[] {
  if (points.length <= 2) return points;
  const out: { xIn: number; yIn: number }[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const last = out[out.length - 1]!;
    const cur = points[i]!;
    // Drop exact duplicates.
    if (
      Math.abs(cur.xIn - last.xIn) < 1e-6 &&
      Math.abs(cur.yIn - last.yIn) < 1e-6
    ) {
      continue;
    }
    // Drop the middle of a colinear triple.
    if (out.length >= 2) {
      const prev = out[out.length - 2]!;
      const colinearX =
        Math.abs(prev.xIn - last.xIn) < 1e-6 &&
        Math.abs(last.xIn - cur.xIn) < 1e-6;
      const colinearY =
        Math.abs(prev.yIn - last.yIn) < 1e-6 &&
        Math.abs(last.yIn - cur.yIn) < 1e-6;
      if (colinearX || colinearY) {
        out.pop();
      }
    }
    out.push(cur);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 5: route all cables (greedy + rip-up)
// ---------------------------------------------------------------------------

/**
 * Route every cable through the cell graph. Updates per-cell usage
 * as we go; later cables see crowded cells and route around them.
 * After the first pass, runs a bounded rip-up loop: for each pair
 * of cables whose polylines visually cross, try rerouting one with
 * the other's cells pinned.
 */
export function routeAllCables(
  grid: CellGrid,
  requests: readonly RouteRequest[],
  configOverrides: Partial<RouterConfig> = {},
): RoutedPath[] {
  const config: RouterConfig = { ...DEFAULT_CONFIG, ...configOverrides };
  const cellUsage = new Int32Array(grid.cells.length);
  const results = new Map<
    string,
    { cells: Cell[]; polyline: { xIn: number; yIn: number }[] }
  >();

  // Sort by length DESCENDING so long cables (which need long
  // contiguous lanes) get first pick of the corridor. Short cables
  // routed afterward can usually fit in residual gaps; if long
  // cables came last they'd find every corridor saturated and wrap
  // around the perimeter.
  const ordered = [...requests].sort((a, b) => cableLength(b) - cableLength(a));

  for (const req of ordered) {
    const routed = routeOne(grid, req, cellUsage, config);
    results.set(req.id, routed);
    for (const c of routed.cells) {
      cellUsage[c.row * grid.cols + c.col]! += 1;
    }
  }

  // Rip-up pass. For each pair of routed cables that visually cross,
  // try rerouting the later (longer) one with the earlier's cells
  // boosted in cost.
  for (let pass = 0; pass < config.ripUpIterations; pass++) {
    let changed = false;
    const orderedIds = ordered.map((r) => r.id);
    for (let i = 0; i < orderedIds.length; i++) {
      for (let j = i + 1; j < orderedIds.length; j++) {
        const a = results.get(orderedIds[i]!)!;
        const b = results.get(orderedIds[j]!)!;
        if (!polylinesCross(a.polyline, b.polyline)) continue;
        // Try rerouting b with a's cells boosted.
        const boostedUsage = new Int32Array(cellUsage);
        for (const c of a.cells) {
          boostedUsage[c.row * grid.cols + c.col]! += config.cellMaxCables * 2;
        }
        // Subtract b's current usage so it can rejoin its own cells.
        for (const c of b.cells) {
          boostedUsage[c.row * grid.cols + c.col]! -= 1;
        }
        const req = ordered.find((r) => r.id === orderedIds[j]!)!;
        const candidate = routeOne(grid, req, boostedUsage, config);
        // Accept if the candidate no longer crosses a.
        if (!polylinesCross(a.polyline, candidate.polyline)) {
          // Update usage: remove b's old cells, add new.
          for (const c of b.cells) cellUsage[c.row * grid.cols + c.col]! -= 1;
          for (const c of candidate.cells)
            cellUsage[c.row * grid.cols + c.col]! += 1;
          results.set(orderedIds[j]!, candidate);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Return in original request order.
  return requests.map((req) => ({
    id: req.id,
    polyline: results.get(req.id)!.polyline,
  }));
}

function cableLength(req: RouteRequest): number {
  return (
    Math.abs(req.to.xIn - req.from.xIn) + Math.abs(req.to.yIn - req.from.yIn)
  );
}

function routeOne(
  grid: CellGrid,
  req: RouteRequest,
  cellUsage: Int32Array,
  config: RouterConfig,
): { cells: Cell[]; polyline: { xIn: number; yIn: number }[] } {
  const fromLeader = req.fromLeaderIn ?? config.defaultLeader;
  const toLeader = req.toLeaderIn ?? config.defaultLeader;
  const fUnit = sideOutwardUnit(req.from.side);
  const tUnit = sideOutwardUnit(req.to.side);
  const fromLeaderTip = {
    xIn: req.from.xIn + fUnit.x * fromLeader,
    yIn: req.from.yIn + fUnit.y * fromLeader,
  };
  const toLeaderTip = {
    xIn: req.to.xIn + tUnit.x * toLeader,
    yIn: req.to.yIn + tUnit.y * toLeader,
  };
  const startCell = findRoutingCell(grid, {
    xIn: fromLeaderTip.xIn,
    yIn: fromLeaderTip.yIn,
    side: req.from.side,
  });
  const endCell = findRoutingCell(grid, {
    xIn: toLeaderTip.xIn,
    yIn: toLeaderTip.yIn,
    side: req.to.side,
  });
  if (!startCell || !endCell) {
    // Degenerate fallback — straight line.
    const polyline = [
      { xIn: req.from.xIn, yIn: req.from.yIn },
      fromLeaderTip,
      toLeaderTip,
      { xIn: req.to.xIn, yIn: req.to.yIn },
    ];
    return { cells: [], polyline: dedupe(polyline) };
  }
  const cells = dijkstra(grid, startCell, endCell, cellUsage, config) ?? [
    startCell,
    endCell,
  ];
  const innerPolyline = cellPathToPolyline(cells, fromLeaderTip, toLeaderTip);
  const polyline = [
    { xIn: req.from.xIn, yIn: req.from.yIn },
    ...innerPolyline,
    { xIn: req.to.xIn, yIn: req.to.yIn },
  ];
  return { cells, polyline: dedupe(polyline) };
}

// ---------------------------------------------------------------------------
// Step 6: visual crossing detection (for rip-up)
// ---------------------------------------------------------------------------

/**
 * Whether two orthogonal polylines have at least one true segment
 * intersection (perpendicular pair sharing a point in both ranges).
 * Endpoints touching are ignored — that's how cables legitimately
 * meet at shared pedals.
 */
function polylinesCross(
  a: readonly { xIn: number; yIn: number }[],
  b: readonly { xIn: number; yIn: number }[],
): boolean {
  for (let i = 0; i < a.length - 1; i++) {
    const a0 = a[i]!;
    const a1 = a[i + 1]!;
    for (let j = 0; j < b.length - 1; j++) {
      const b0 = b[j]!;
      const b1 = b[j + 1]!;
      if (segmentsCross(a0, a1, b0, b1)) return true;
    }
  }
  return false;
}

function segmentsCross(
  a0: { xIn: number; yIn: number },
  a1: { xIn: number; yIn: number },
  b0: { xIn: number; yIn: number },
  b1: { xIn: number; yIn: number },
): boolean {
  const aHorizontal = Math.abs(a0.yIn - a1.yIn) < 1e-6;
  const bHorizontal = Math.abs(b0.yIn - b1.yIn) < 1e-6;
  if (aHorizontal === bHorizontal) return false; // parallel
  const horiz = aHorizontal ? a0 : b0;
  const horizEnd = aHorizontal ? a1 : b1;
  const vert = aHorizontal ? b0 : a0;
  const vertEnd = aHorizontal ? b1 : a1;
  const hY = horiz.yIn;
  const hMinX = Math.min(horiz.xIn, horizEnd.xIn);
  const hMaxX = Math.max(horiz.xIn, horizEnd.xIn);
  const vX = vert.xIn;
  const vMinY = Math.min(vert.yIn, vertEnd.yIn);
  const vMaxY = Math.max(vert.yIn, vertEnd.yIn);
  // Strict interior crossing — endpoint touching doesn't count.
  return (
    vX > hMinX + 1e-3 &&
    vX < hMaxX - 1e-3 &&
    hY > vMinY + 1e-3 &&
    hY < vMaxY - 1e-3
  );
}

// ---------------------------------------------------------------------------
// Public entry: single-cable shim used by routeCableWithLeader
// ---------------------------------------------------------------------------

/**
 * Route one cable in isolation. The shim used by the legacy
 * `routeCableWithLeader` API. Most callers should batch through
 * `routeAllCables` instead so cables can see each other.
 *
 * `options.claimedVerticals` / `claimedHorizontals` are inspected to
 * seed cell usage from previously-routed cables — the bridge that
 * keeps the legacy per-cable API working with the global router.
 */
export function routeSingleCable(
  from: CableEnd,
  to: CableEnd,
  obstacles: readonly ObstacleRect[],
  options: RouteOptions = {},
): { xIn: number; yIn: number }[] {
  const boardWidthIn = options.boardWidthIn ?? 20;
  const boardDepthIn = options.boardDepthIn ?? 14;
  const margin = options.obstacleMarginIn ?? 0.15;
  const inflated = obstacles.map((r) => ({
    xIn: r.xIn - margin,
    yIn: r.yIn - margin,
    widthIn: r.widthIn + 2 * margin,
    depthIn: r.depthIn + 2 * margin,
  }));
  const grid = decomposeBoard(
    boardWidthIn,
    boardDepthIn,
    inflated,
    [from.xIn, to.xIn],
    [from.yIn, to.yIn],
  );
  const cellUsage = new Int32Array(grid.cells.length);
  // Seed usage from claimed segments so this cable sees the same
  // pressure routeAllCables would have given it.
  for (const v of options.claimedVerticals ?? []) {
    seedSegmentUsage(grid, cellUsage, v.xIn, v.xIn, v.yMin, v.yMax);
  }
  for (const h of options.claimedHorizontals ?? []) {
    seedSegmentUsage(grid, cellUsage, h.xMin, h.xMax, h.yIn, h.yIn);
  }
  const req: RouteRequest = {
    id: 'single',
    from,
    to,
    ...(options.fromLeaderIn !== undefined
      ? { fromLeaderIn: options.fromLeaderIn }
      : {}),
    ...(options.toLeaderIn !== undefined
      ? { toLeaderIn: options.toLeaderIn }
      : {}),
  };
  const routed = routeOne(grid, req, cellUsage, {
    ...DEFAULT_CONFIG,
    boardWidthIn,
    boardDepthIn,
  });
  return routed.polyline;
}

function seedSegmentUsage(
  grid: CellGrid,
  cellUsage: Int32Array,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): void {
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const cell = grid.cells[row * grid.cols + col]!;
      if (cell.blocked) continue;
      if (
        cell.xMax > xMin &&
        cell.xMin < xMax &&
        cell.yMax > yMin &&
        cell.yMin < yMax
      ) {
        cellUsage[row * grid.cols + col]! += 1;
      }
    }
  }
}
