/**
 * Fuse — abstract circuit puzzle generation and validation.
 *
 * This is a game-logic simulation only: it models connectivity between tiles
 * on a grid. It is NOT a model of real electricity and contains no real-world
 * electrical guidance.
 *
 * SOLVABILITY IS GUARANTEED BY CONSTRUCTION. Rather than generating a random
 * board and hoping, the generator carves real paths from each source to its
 * target, derives each tile's connection mask from the path it belongs to, and
 * only then scrambles the rotations. Rotating every tile back to its generated
 * orientation is therefore always a valid solution.
 */

export type Direction = 'N' | 'E' | 'S' | 'W';

/** Connection mask bits. A tile connects on a side when its bit is set. */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

export const DIR_BIT: Record<Direction, number> = { N, E, S, W };
export const OPPOSITE: Record<Direction, Direction> = { N: 'S', E: 'W', S: 'N', W: 'E' };
export const DELTA: Record<Direction, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
};

export type TileKind = 'empty' | 'straight' | 'corner' | 'tee' | 'cross' | 'source' | 'bulb' | 'blocker';

export interface Tile {
  id: string;
  x: number;
  y: number;
  kind: TileKind;
  /** Connection mask in its CURRENT rotation. */
  mask: number;
  /** Current rotation in degrees: 0, 90, 180 or 270. */
  rotation: number;
  /** Circuit this source/bulb belongs to (sources and bulbs only). */
  circuit: number | null;
  /** Sources, bulbs and blockers cannot be rotated by the player. */
  fixed: boolean;
}

export interface CircuitBoard {
  cols: number;
  rows: number;
  tiles: Tile[];
  /** How many source→bulb circuits must be completed. */
  circuits: number;
}

/* ------------------------------------------------------------------ */
/* Masks and rotation                                                  */
/* ------------------------------------------------------------------ */

/** Rotates a 4-bit mask clockwise by `steps` quarter turns. */
export function rotateMask(mask: number, steps: number): number {
  const turns = ((steps % 4) + 4) % 4;
  let out = mask;
  for (let i = 0; i < turns; i += 1) {
    // N->E, E->S, S->W, W->N
    out = ((out << 1) | (out >> 3)) & 0b1111;
  }
  return out;
}

export function maskHas(mask: number, direction: Direction): boolean {
  return (mask & DIR_BIT[direction]) !== 0;
}

export function countBits(mask: number): number {
  return [N, E, S, W].filter((bit) => (mask & bit) !== 0).length;
}

/** Classifies a mask into a tile kind (used when building the board). */
export function kindForMask(mask: number): TileKind {
  const bits = countBits(mask);
  if (bits === 0) return 'empty';
  if (bits === 1) return 'straight'; // a dead-end stub, rendered as a stub
  if (bits === 2) {
    const straight = mask === (N | S) || mask === (E | W);
    return straight ? 'straight' : 'corner';
  }
  if (bits === 3) return 'tee';
  return 'cross';
}

/**
 * How many DISTINCT orientations a mask has. A cross looks the same in all
 * four rotations, a straight in two. Used to guarantee a scramble is visible.
 */
export function distinctRotations(mask: number): number {
  const seen = new Set<number>();
  for (let step = 0; step < 4; step += 1) seen.add(rotateMask(mask, step));
  return seen.size;
}

/* ------------------------------------------------------------------ */
/* Board helpers                                                       */
/* ------------------------------------------------------------------ */

export function tileAt(board: CircuitBoard, x: number, y: number): Tile | undefined {
  if (x < 0 || y < 0 || x >= board.cols || y >= board.rows) return undefined;
  return board.tiles[y * board.cols + x];
}

/**
 * True when two adjacent tiles genuinely connect: A must open toward B AND B
 * must open back toward A. A one-sided opening is not a connection.
 */
export function connects(board: CircuitBoard, tile: Tile, direction: Direction): boolean {
  if (!maskHas(tile.mask, direction)) return false;
  const delta = DELTA[direction];
  const neighbour = tileAt(board, tile.x + delta.dx, tile.y + delta.dy);
  if (!neighbour || neighbour.kind === 'blocker' || neighbour.kind === 'empty') return false;
  return maskHas(neighbour.mask, OPPOSITE[direction]);
}

/** Every tile reachable from `start` by following mutual connections. */
export function reachableFrom(board: CircuitBoard, start: Tile): Set<string> {
  const seen = new Set<string>([start.id]);
  const queue: Tile[] = [start];
  while (queue.length > 0) {
    const tile = queue.shift() as Tile;
    for (const direction of ['N', 'E', 'S', 'W'] as Direction[]) {
      if (!connects(board, tile, direction)) continue;
      const delta = DELTA[direction];
      const neighbour = tileAt(board, tile.x + delta.dx, tile.y + delta.dy);
      if (!neighbour || seen.has(neighbour.id)) continue;
      seen.add(neighbour.id);
      queue.push(neighbour);
    }
  }
  return seen;
}

export interface CircuitStatus {
  circuit: number;
  /** True when the source reaches ITS OWN bulb. */
  connected: boolean;
  /** True when the source reaches a bulb belonging to a DIFFERENT circuit. */
  crossed: boolean;
}

/**
 * Evaluates every circuit. A circuit counts as complete only when its source
 * reaches its own bulb AND does not also reach another circuit's bulb — so a
 * wrong battery/bulb pairing can never be scored as a win.
 */
export function evaluateCircuits(board: CircuitBoard): CircuitStatus[] {
  const sources = board.tiles.filter((tile) => tile.kind === 'source');
  const bulbs = board.tiles.filter((tile) => tile.kind === 'bulb');
  return sources.map((source) => {
    const reach = reachableFrom(board, source);
    const ownBulb = bulbs.find((bulb) => bulb.circuit === source.circuit);
    const connected = Boolean(ownBulb && reach.has(ownBulb.id));
    const crossed = bulbs.some((bulb) => bulb.circuit !== source.circuit && reach.has(bulb.id));
    return { circuit: source.circuit ?? 0, connected, crossed };
  });
}

/** Bulb ids that are currently lit (their own source reaches them cleanly). */
export function litBulbs(board: CircuitBoard): string[] {
  const statuses = evaluateCircuits(board);
  const good = new Set(statuses.filter((status) => status.connected && !status.crossed).map((s) => s.circuit));
  return board.tiles.filter((tile) => tile.kind === 'bulb' && good.has(tile.circuit ?? -1)).map((tile) => tile.id);
}

export function isSolved(board: CircuitBoard): boolean {
  const statuses = evaluateCircuits(board);
  if (statuses.length === 0) return false;
  return statuses.length === board.circuits && statuses.every((s) => s.connected && !s.crossed);
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

export function seededRandom(seed: number): () => number {
  let value = (seed >>> 0) || 1;
  return () => {
    value ^= value << 13;
    value >>>= 0;
    value ^= value >> 17;
    value ^= value << 5;
    value >>>= 0;
    return value / 0xffffffff;
  };
}

export interface FuseDifficulty {
  cols: number;
  rows: number;
  circuits: number;
  blockers: number;
}

export const FUSE_LEVELS: FuseDifficulty[] = [
  { cols: 5, rows: 5, circuits: 1, blockers: 0 },
  { cols: 6, rows: 6, circuits: 1, blockers: 2 },
  { cols: 6, rows: 6, circuits: 2, blockers: 2 },
  { cols: 7, rows: 7, circuits: 2, blockers: 4 },
  { cols: 8, rows: 8, circuits: 2, blockers: 5 },
  { cols: 8, rows: 8, circuits: 3, blockers: 6 },
  { cols: 9, rows: 9, circuits: 3, blockers: 8 },
  { cols: 10, rows: 10, circuits: 3, blockers: 10 },
];

export const FUSE_TOTAL_LEVELS = FUSE_LEVELS.length;

export function fuseSpec(level: number): FuseDifficulty {
  const spec = FUSE_LEVELS[Math.max(0, Math.min(level, FUSE_LEVELS.length - 1))];
  return spec ?? (FUSE_LEVELS[0] as FuseDifficulty);
}

/**
 * Carves a self-avoiding path between two cells using a randomised walk with
 * backtracking. Returns the cell sequence, or null when no route exists.
 *
 * The search is STEP BUDGETED. An unbounded backtracker degenerates badly on
 * larger grids (the search space is exponential), so we cap the number of
 * explored nodes. Exceeding the budget simply means "no path this attempt" and
 * the caller retries with fresh endpoints — generation stays fast and always
 * terminates.
 */
function carvePath(
  cols: number,
  rows: number,
  used: Set<string>,
  from: { x: number; y: number },
  to: { x: number; y: number },
  random: () => number,
): Array<{ x: number; y: number }> | null {
  const key = (x: number, y: number) => `${x}:${y}`;
  const path: Array<{ x: number; y: number }> = [];
  const visited = new Set<string>();
  const maxDepth = Math.min(cols * rows, (cols + rows) * 3);
  let budget = 4000;

  const walk = (x: number, y: number, depth: number): boolean => {
    if (budget-- <= 0) return false;
    if (depth > maxDepth) return false;
    path.push({ x, y });
    visited.add(key(x, y));
    if (x === to.x && y === to.y) return true;

    // Prefer directions that reduce the distance, with some randomness so the
    // routes are not all straight lines.
    const dirs = (['N', 'E', 'S', 'W'] as Direction[])
      .map((direction) => {
        const delta = DELTA[direction];
        const nx = x + delta.dx;
        const ny = y + delta.dy;
        const distance = Math.abs(nx - to.x) + Math.abs(ny - to.y);
        return { direction, nx, ny, score: distance + random() * 3 };
      })
      .sort((a, b) => a.score - b.score);

    for (const option of dirs) {
      const { nx, ny } = option;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const cell = key(nx, ny);
      if (visited.has(cell)) continue;
      // The target may already be "used" (it is the endpoint we want).
      if (used.has(cell) && !(nx === to.x && ny === to.y)) continue;
      if (walk(nx, ny, depth + 1)) return true;
    }

    path.pop();
    visited.delete(key(x, y));
    return false;
  };

  return walk(from.x, from.y, 0) ? path : null;
}

/**
 * Generates a solvable board.
 *
 * 1. Place a source and a bulb per circuit.
 * 2. Carve a real path between them and set each tile's mask from the path.
 * 3. Fill unused cells with blockers or empties.
 * 4. Scramble the rotation of every rotatable tile.
 *
 * Because the masks come from genuine paths, rotating everything back to its
 * generated orientation always solves the board.
 */
export function generateBoard(seed: number, level: number): CircuitBoard {
  const spec = fuseSpec(level);
  const random = seededRandom(seed ^ ((level + 1) * 0x85ebca6b));
  const { cols, rows } = spec;

  // Solution masks, keyed by cell.
  const masks = new Map<string, number>();
  const used = new Set<string>();
  const key = (x: number, y: number) => `${x}:${y}`;

  const endpoints: Array<{ source: { x: number; y: number }; bulb: { x: number; y: number }; circuit: number }> = [];

  let circuitsBuilt = 0;
  let attempts = 0;
  while (circuitsBuilt < spec.circuits && attempts < spec.circuits * 60) {
    attempts += 1;
    const source = { x: Math.floor(random() * cols), y: Math.floor(random() * rows) };
    const bulb = { x: Math.floor(random() * cols), y: Math.floor(random() * rows) };
    const distance = Math.abs(source.x - bulb.x) + Math.abs(source.y - bulb.y);
    // Endpoints must be distinct, unused and reasonably far apart.
    if (distance < Math.max(3, Math.floor((cols + rows) / 3))) continue;
    if (used.has(key(source.x, source.y)) || used.has(key(bulb.x, bulb.y))) continue;

    const path = carvePath(cols, rows, used, source, bulb, random);
    if (!path || path.length < 3) continue;

    // Derive masks from consecutive path steps.
    for (let i = 0; i < path.length; i += 1) {
      const cell = path[i] as { x: number; y: number };
      const cellKey = key(cell.x, cell.y);
      let mask = masks.get(cellKey) ?? 0;
      const previous = path[i - 1];
      const next = path[i + 1];
      for (const neighbour of [previous, next]) {
        if (!neighbour) continue;
        const dx = neighbour.x - cell.x;
        const dy = neighbour.y - cell.y;
        if (dx === 1) mask |= E;
        else if (dx === -1) mask |= W;
        else if (dy === 1) mask |= S;
        else if (dy === -1) mask |= N;
      }
      masks.set(cellKey, mask);
      used.add(cellKey);
    }

    endpoints.push({ source, bulb, circuit: circuitsBuilt });
    circuitsBuilt += 1;
  }

  // Build the tile grid.
  const tiles: Tile[] = [];
  const sourceKeys = new Map(endpoints.map((entry) => [key(entry.source.x, entry.source.y), entry.circuit]));
  const bulbKeys = new Map(endpoints.map((entry) => [key(entry.bulb.x, bulbYOf(entry)), entry.circuit]));

  function bulbYOf(entry: { bulb: { x: number; y: number } }): number {
    return entry.bulb.y;
  }

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const cellKey = key(x, y);
      const solutionMask = masks.get(cellKey) ?? 0;
      const circuitOfSource = sourceKeys.get(cellKey);
      const circuitOfBulb = bulbKeys.get(cellKey);

      let kind: TileKind;
      let fixed = false;
      let circuit: number | null = null;

      if (circuitOfSource !== undefined) {
        kind = 'source';
        fixed = true;
        circuit = circuitOfSource;
      } else if (circuitOfBulb !== undefined) {
        kind = 'bulb';
        fixed = true;
        circuit = circuitOfBulb;
      } else if (solutionMask === 0) {
        kind = 'empty';
        fixed = true;
      } else {
        kind = kindForMask(solutionMask);
      }

      tiles.push({
        id: `t${x}-${y}`,
        x,
        y,
        kind,
        mask: solutionMask,
        rotation: 0,
        circuit,
        fixed,
      });
    }
  }

  const board: CircuitBoard = { cols, rows, tiles, circuits: circuitsBuilt };

  // Sanity: the generated orientation must actually solve the board.
  if (circuitsBuilt === 0 || !isSolved(board)) {
    // Fall back to the simplest guaranteed board rather than shipping a broken
    // puzzle. This is defensive; the carve above succeeds in practice.
    return fallbackBoard(cols, rows);
  }

  // Turn some unused empties into blockers for visual interest.
  const emptyTiles = board.tiles.filter((tile) => tile.kind === 'empty');
  for (let i = 0; i < Math.min(spec.blockers, emptyTiles.length); i += 1) {
    const pick = emptyTiles[Math.floor(random() * emptyTiles.length)];
    if (pick && pick.kind === 'empty') pick.kind = 'blocker';
  }

  // Scramble: rotate every rotatable tile away from its solved orientation
  // where the tile actually has more than one distinct orientation.
  for (const tile of board.tiles) {
    if (tile.fixed) continue;
    const options = distinctRotations(tile.mask);
    if (options <= 1) continue;
    const steps = 1 + Math.floor(random() * (options - 1));
    tile.mask = rotateMask(tile.mask, steps);
    tile.rotation = (steps * 90) % 360;
  }

  return board;
}

/** A tiny, always-solvable board used only if generation somehow fails. */
function fallbackBoard(cols: number, rows: number): CircuitBoard {
  const tiles: Tile[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      let kind: TileKind = 'empty';
      let mask = 0;
      let fixed = true;
      let circuit: number | null = null;
      if (y === 0 && x === 0) {
        kind = 'source';
        mask = E;
        circuit = 0;
      } else if (y === 0 && x === cols - 1) {
        kind = 'bulb';
        mask = W;
        circuit = 0;
      } else if (y === 0) {
        kind = 'straight';
        mask = E | W;
        fixed = false;
      }
      tiles.push({ id: `t${x}-${y}`, x, y, kind, mask, rotation: 0, circuit, fixed });
    }
  }
  return { cols, rows, tiles, circuits: 1 };
}

/** Rotates a tile one quarter turn clockwise. Returns false when not allowed. */
export function rotateTile(board: CircuitBoard, tileId: string): boolean {
  const tile = board.tiles.find((entry) => entry.id === tileId);
  if (!tile || tile.fixed) return false;
  if (tile.kind === 'empty' || tile.kind === 'blocker') return false;
  tile.mask = rotateMask(tile.mask, 1);
  tile.rotation = (tile.rotation + 90) % 360;
  return true;
}

/** Progress as a fraction: how many circuits are correctly connected. */
export function progressOf(board: CircuitBoard): number {
  if (board.circuits === 0) return 0;
  const statuses = evaluateCircuits(board);
  const good = statuses.filter((status) => status.connected && !status.crossed).length;
  return good / board.circuits;
}
