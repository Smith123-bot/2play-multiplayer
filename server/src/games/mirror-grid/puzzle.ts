/**
 * Mirror Grid — reflection puzzle generation and validation.
 *
 * A puzzle shows a source pattern on one side of a mirror line. The player
 * must build the pattern as it appears AFTER reflection — not a copy of it.
 * The reflected grid is derived mathematically, so every puzzle has exactly
 * one correct answer.
 */

/** Original 2D symbols. `null` means an empty cell. */
export type Symbol = 'circle' | 'square' | 'triangle' | 'diamond' | 'star' | 'arrow';

export const SYMBOLS: Symbol[] = ['circle', 'square', 'triangle', 'diamond', 'star', 'arrow'];

export type Color = 'red' | 'blue' | 'green' | 'yellow';

export const COLORS: Color[] = ['red', 'blue', 'green', 'yellow'];

/** A cell is either empty or a coloured symbol. */
export interface Cell {
  symbol: Symbol;
  color: Color;
}

export type Grid = Array<Cell | null>;

/**
 * The four supported transformations.
 *  - `left-right`  reflects across a VERTICAL mirror line (columns swap)
 *  - `top-bottom`  reflects across a HORIZONTAL mirror line (rows swap)
 *  - `horizontal`  is the horizontal-axis flip, i.e. the same as top-bottom
 *  - `vertical`    is the vertical-axis flip, i.e. the same as left-right
 *
 * `horizontal`/`vertical` are named after the AXIS of the mirror, which is the
 * common source of confusion, so both namings are supported explicitly and the
 * UI always states which one is in play.
 */
export type MirrorType = 'left-right' | 'top-bottom' | 'horizontal' | 'vertical';

export const MIRROR_TYPES: MirrorType[] = ['left-right', 'top-bottom', 'horizontal', 'vertical'];

export const MIRROR_LABEL: Record<MirrorType, string> = {
  'left-right': 'Left ↔ Right (vertical mirror line)',
  'vertical': 'Vertical mirror line (left ↔ right)',
  'top-bottom': 'Top ↕ Bottom (horizontal mirror line)',
  'horizontal': 'Horizontal mirror line (top ↕ bottom)',
};

export interface MirrorLevel {
  size: number;
  mirror: MirrorType;
  /** The pattern shown to the player. */
  source: Grid;
  /** SERVER ONLY — the mathematically correct answer. */
  solution: Grid;
}

export function indexOf(size: number, col: number, row: number): number {
  return row * size + col;
}

/** True when this mirror flips columns (a vertical mirror line). */
export function flipsColumns(mirror: MirrorType): boolean {
  return mirror === 'left-right' || mirror === 'vertical';
}

/**
 * Reflects a grid. This is the single source of truth for the answer — the
 * generator and the validator both use it, so they can never disagree.
 */
export function reflect(grid: Grid, size: number, mirror: MirrorType): Grid {
  const out: Grid = new Array(size * size).fill(null);
  const byColumn = flipsColumns(mirror);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const srcIndex = indexOf(size, col, row);
      const dstCol = byColumn ? size - 1 - col : col;
      const dstRow = byColumn ? row : size - 1 - row;
      out[indexOf(size, dstCol, dstRow)] = grid[srcIndex] ?? null;
    }
  }
  return out;
}

/** Small deterministic PRNG so a seed always yields the same puzzle. */
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

export interface DifficultySpec {
  size: number;
  /** How many cells carry a symbol. */
  filled: number;
  /** How many distinct symbols may appear. */
  symbolCount: number;
  /** How many distinct colours may appear. */
  colorCount: number;
}

/**
 * Difficulty ramps by grid size, density and palette. Level 0 is a gentle 3x3
 * with two symbols in one colour; the last levels are dense 7x7 boards using
 * the whole palette.
 */
export const LEVEL_SPECS: DifficultySpec[] = [
  { size: 3, filled: 4, symbolCount: 2, colorCount: 1 },
  { size: 3, filled: 6, symbolCount: 3, colorCount: 2 },
  { size: 4, filled: 7, symbolCount: 3, colorCount: 2 },
  { size: 4, filled: 10, symbolCount: 4, colorCount: 3 },
  { size: 5, filled: 12, symbolCount: 4, colorCount: 3 },
  { size: 5, filled: 15, symbolCount: 5, colorCount: 4 },
  { size: 6, filled: 18, symbolCount: 5, colorCount: 4 },
  { size: 6, filled: 22, symbolCount: 6, colorCount: 4 },
  { size: 7, filled: 26, symbolCount: 6, colorCount: 4 },
  { size: 7, filled: 32, symbolCount: 6, colorCount: 4 },
];

export const MIRROR_TOTAL_LEVELS = LEVEL_SPECS.length;

export function specForLevel(level: number): DifficultySpec {
  const spec = LEVEL_SPECS[Math.max(0, Math.min(level, LEVEL_SPECS.length - 1))];
  return spec ?? (LEVEL_SPECS[0] as DifficultySpec);
}

/**
 * Builds a level from a seed. Deterministic: the same seed and level always
 * produce the same puzzle, which is what makes a fair versus race possible.
 *
 * The solution is derived by reflecting the source, so it is correct by
 * construction and always unique.
 */
export function generateLevel(seed: number, level: number): MirrorLevel {
  const spec = specForLevel(level);
  const random = seededRandom(seed ^ ((level + 1) * 0x9e3779b1));
  const { size } = spec;

  const symbols = SYMBOLS.slice(0, Math.max(1, Math.min(spec.symbolCount, SYMBOLS.length)));
  const colors = COLORS.slice(0, Math.max(1, Math.min(spec.colorCount, COLORS.length)));
  const mirror = MIRROR_TYPES[Math.floor(random() * MIRROR_TYPES.length)] as MirrorType;

  const source: Grid = new Array(size * size).fill(null);
  const cells = Array.from({ length: size * size }, (_unused, index) => index);
  // Shuffle the candidate cells, then fill the first `filled` of them.
  for (let i = cells.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = cells[i] as number;
    cells[i] = cells[j] as number;
    cells[j] = a;
  }
  const filled = Math.min(spec.filled, cells.length);
  for (let i = 0; i < filled; i += 1) {
    const index = cells[i] as number;
    source[index] = {
      symbol: symbols[Math.floor(random() * symbols.length)] as Symbol,
      color: colors[Math.floor(random() * colors.length)] as Color,
    };
  }

  return { size, mirror, source, solution: reflect(source, size, mirror) };
}

export function cellsEqual(a: Cell | null, b: Cell | null): boolean {
  if (a === null || b === null) return a === b;
  return a.symbol === b.symbol && a.color === b.color;
}

/** How many cells of `answer` match the solution. */
export function countCorrect(answer: Grid, solution: Grid): number {
  let correct = 0;
  for (let i = 0; i < solution.length; i += 1) {
    if (cellsEqual(answer[i] ?? null, solution[i] ?? null)) correct += 1;
  }
  return correct;
}

export function isSolved(answer: Grid, solution: Grid): boolean {
  return countCorrect(answer, solution) === solution.length;
}

/**
 * Indices that are currently wrong. Used for "which area needs correction"
 * feedback WITHOUT handing over the answer itself.
 */
export function wrongIndices(answer: Grid, solution: Grid): number[] {
  const wrong: number[] = [];
  for (let i = 0; i < solution.length; i += 1) {
    if (!cellsEqual(answer[i] ?? null, solution[i] ?? null)) wrong.push(i);
  }
  return wrong;
}
