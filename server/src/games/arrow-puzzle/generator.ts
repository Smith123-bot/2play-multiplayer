/**
 * Arrow Puzzle — deterministic, always-solvable board generator.
 *
 * Rules of the puzzle
 * -------------------
 * The grid holds arrow tiles. An arrow can be *fired* when nothing blocks its
 * path: every cell from the arrow to the edge of the board, in the direction it
 * points, must be empty. Firing removes the arrow, which can unblock others.
 * Clearing every arrow solves the board.
 *
 * Guaranteed solvability
 * ----------------------
 * Rather than generating a random board and hoping it can be solved, the
 * generator works BACKWARDS from an empty grid: it repeatedly places an arrow
 * on a free cell pointing in a direction whose path is currently clear. Playing
 * the placements in reverse order is therefore always a valid solution, so
 * every generated puzzle is solvable by construction.
 */

export type ArrowDirection = 'up' | 'down' | 'left' | 'right';
export type ArrowDifficulty = 'easy' | 'medium' | 'hard' | 'expert';

export interface ArrowTile {
  id: string;
  x: number;
  y: number;
  direction: ArrowDirection;
  cleared: boolean;
}

export interface ArrowBoard {
  cols: number;
  rows: number;
  tiles: ArrowTile[];
  difficulty: ArrowDifficulty;
  /** Placement order reversed = a known-good solution (server only). */
  solution: string[];
}

export const DIRECTIONS: ArrowDirection[] = ['up', 'down', 'left', 'right'];

export const DELTA: Record<ArrowDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export interface DifficultySpec {
  cols: number;
  rows: number;
  count: number;
}

export const DIFFICULTY_SPEC: Record<ArrowDifficulty, DifficultySpec> = {
  easy: { cols: 5, rows: 5, count: 8 },
  medium: { cols: 6, rows: 6, count: 14 },
  hard: { cols: 7, rows: 7, count: 22 },
  expert: { cols: 8, rows: 8, count: 30 },
};

/** Small deterministic PRNG so a seed always yields the same puzzle. */
export function seededRandom(seed: number): () => number {
  let value = (seed >>> 0) || 1;
  return () => {
    // xorshift32
    value ^= value << 13;
    value >>>= 0;
    value ^= value >> 17;
    value ^= value << 5;
    value >>>= 0;
    return value / 0xffffffff;
  };
}

function key(x: number, y: number): string {
  return `${x}:${y}`;
}

/**
 * True when the path from (x, y) travelling in `direction` reaches the board
 * edge without meeting an occupied cell.
 */
export function pathClear(
  occupied: Set<string>,
  cols: number,
  rows: number,
  x: number,
  y: number,
  direction: ArrowDirection,
): boolean {
  const { dx, dy } = DELTA[direction];
  let cx = x + dx;
  let cy = y + dy;
  while (cx >= 0 && cy >= 0 && cx < cols && cy < rows) {
    if (occupied.has(key(cx, cy))) return false;
    cx += dx;
    cy += dy;
  }
  return true;
}

/**
 * Builds a puzzle that is solvable by construction.
 *
 * Placements happen on an empty board: an arrow may only be placed where its
 * own exit path is currently clear. Because later placements sit "on top of"
 * earlier ones, removing them in reverse placement order is always legal.
 */
export function generatePuzzle(seed: number, difficulty: ArrowDifficulty): ArrowBoard {
  const spec = DIFFICULTY_SPEC[difficulty];
  const random = seededRandom(seed);
  const { cols, rows } = spec;

  const occupied = new Set<string>();
  const placed: ArrowTile[] = [];

  // Every cell, visited in a seed-dependent order.
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) cells.push({ x, y });

  let attempts = 0;
  const maxAttempts = spec.count * 60;

  while (placed.length < spec.count && attempts < maxAttempts) {
    attempts += 1;
    const cell = cells[Math.floor(random() * cells.length)];
    if (!cell || occupied.has(key(cell.x, cell.y))) continue;

    // Directions whose exit path is clear right now, in random order.
    const options = [...DIRECTIONS]
      .map((direction) => ({ direction, sort: random() }))
      .sort((a, b) => a.sort - b.sort)
      .map((entry) => entry.direction)
      .filter((direction) => pathClear(occupied, cols, rows, cell.x, cell.y, direction));

    const direction = options[0];
    if (!direction) continue;

    occupied.add(key(cell.x, cell.y));
    placed.push({
      id: `a${placed.length}`,
      x: cell.x,
      y: cell.y,
      direction,
      cleared: false,
    });
  }

  // Reverse placement order is a guaranteed-legal solution.
  const solution = [...placed].reverse().map((tile) => tile.id);

  return { cols, rows, tiles: placed, difficulty, solution };
}

/** Arrows still on the board. */
export function remainingTiles(board: { tiles: ArrowTile[] }): ArrowTile[] {
  return board.tiles.filter((tile) => !tile.cleared);
}

/** Occupancy set built from the tiles that have not been cleared yet. */
export function occupancy(tiles: ArrowTile[]): Set<string> {
  const set = new Set<string>();
  for (const tile of tiles) if (!tile.cleared) set.add(key(tile.x, tile.y));
  return set;
}

/** Server-side check: can this specific tile be fired right now? */
export function canFire(board: { cols: number; rows: number; tiles: ArrowTile[] }, tileId: string): boolean {
  const tile = board.tiles.find((entry) => entry.id === tileId);
  if (!tile || tile.cleared) return false;
  const occupied = occupancy(board.tiles);
  occupied.delete(key(tile.x, tile.y));
  return pathClear(occupied, board.cols, board.rows, tile.x, tile.y, tile.direction);
}

/** Every tile that is currently firable. Used by the AI and by hints. */
export function firableTiles(board: { cols: number; rows: number; tiles: ArrowTile[] }): ArrowTile[] {
  return board.tiles.filter((tile) => !tile.cleared && canFire(board, tile.id));
}

/**
 * Independent solver used by the tests to prove a generated board really can be
 * cleared. Greedy + backtracking over firable tiles.
 */
export function solve(board: { cols: number; rows: number; tiles: ArrowTile[] }): string[] | null {
  const tiles = board.tiles.map((tile) => ({ ...tile }));
  const working = { cols: board.cols, rows: board.rows, tiles };
  const order: string[] = [];
  const total = tiles.filter((tile) => !tile.cleared).length;

  for (let step = 0; step < total; step += 1) {
    const options = firableTiles(working);
    if (options.length === 0) return null;
    const chosen = options[0] as ArrowTile;
    const live = tiles.find((tile) => tile.id === chosen.id);
    if (!live) return null;
    live.cleared = true;
    order.push(live.id);
  }
  return order;
}
