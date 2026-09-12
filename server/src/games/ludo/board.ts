/**
 * Ludo board geometry.
 *
 * The classic board is a 15x15 grid with a 52 cell shared track running around
 * it. Everything here is pure data + pure functions so the rules module (and
 * the tests) can reason about the board without any platform dependencies.
 *
 * Seats are indexed 0..3 and map to the four corners:
 *   0 = red, 1 = green, 2 = yellow, 3 = blue
 */

export type LudoColor = 'red' | 'green' | 'yellow' | 'blue';

export const LUDO_COLORS: LudoColor[] = ['red', 'green', 'yellow', 'blue'];

/** Cells on the shared loop. */
export const TRACK_LENGTH = 52;
/** Private coloured lane each player walks before reaching home. */
export const HOME_STRETCH_LENGTH = 5;
/** Tokens per player. */
export const TOKENS_PER_PLAYER = 4;

/**
 * Track index each seat enters the board on. The classic spacing is 13 cells
 * between consecutive starting squares.
 */
export const START_INDEX: Record<number, number> = { 0: 0, 1: 13, 2: 26, 3: 39 };

/**
 * The last shared-track cell a seat stands on before turning into its own
 * home stretch (its start index minus one, wrapped).
 */
export const HOME_ENTRY_INDEX: Record<number, number> = { 0: 51, 1: 12, 2: 25, 3: 38 };

/**
 * Safe cells: the four coloured starting squares plus the four classic star
 * cells. A token on a safe cell can never be captured.
 */
export const SAFE_INDICES: number[] = [0, 8, 13, 21, 26, 34, 39, 47];

export function isSafeIndex(index: number): boolean {
  return SAFE_INDICES.includes(index);
}

export function colorForSeat(seatIndex: number): LudoColor {
  return LUDO_COLORS[((seatIndex % 4) + 4) % 4] ?? 'red';
}

/**
 * Absolute track cell for a seat that has walked `steps` cells from its own
 * starting square (0-based). Wraps around the 52 cell loop.
 */
export function trackIndexFor(seatIndex: number, steps: number): number {
  const start = START_INDEX[((seatIndex % 4) + 4) % 4] ?? 0;
  return (start + steps) % TRACK_LENGTH;
}

/**
 * Total distance a token must travel to go from its starting square all the
 * way into the final home cell: 52 shared cells + 5 lane cells. Progress 57
 * is the centre "home" itself — the board layout has exactly five lane cells,
 * so the finish must sit directly after them (a sixth lane cell would render
 * nowhere).
 */
export const FINISH_DISTANCE = TRACK_LENGTH + HOME_STRETCH_LENGTH;

/* ------------------------------------------------------------------ */
/* Pixel/grid layout for the client                                    */
/* ------------------------------------------------------------------ */

export interface Cell {
  x: number;
  y: number;
}

/**
 * The 52 shared track cells as 15x15 grid coordinates, walking clockwise and
 * starting at red's entry square. This is shipped to the client so the board
 * renders identically everywhere.
 */
export const TRACK_CELLS: Cell[] = [
  // Red start, heading up the left-centre column
  { x: 1, y: 6 }, { x: 2, y: 6 }, { x: 3, y: 6 }, { x: 4, y: 6 }, { x: 5, y: 6 },
  { x: 6, y: 5 }, { x: 6, y: 4 }, { x: 6, y: 3 }, { x: 6, y: 2 }, { x: 6, y: 1 }, { x: 6, y: 0 },
  { x: 7, y: 0 },
  { x: 8, y: 0 },
  // Green start, heading right along the top-centre row
  { x: 8, y: 1 }, { x: 8, y: 2 }, { x: 8, y: 3 }, { x: 8, y: 4 }, { x: 8, y: 5 },
  { x: 9, y: 6 }, { x: 10, y: 6 }, { x: 11, y: 6 }, { x: 12, y: 6 }, { x: 13, y: 6 }, { x: 14, y: 6 },
  { x: 14, y: 7 },
  { x: 14, y: 8 },
  // Yellow start, heading down the right-centre column
  { x: 13, y: 8 }, { x: 12, y: 8 }, { x: 11, y: 8 }, { x: 10, y: 8 }, { x: 9, y: 8 },
  { x: 8, y: 9 }, { x: 8, y: 10 }, { x: 8, y: 11 }, { x: 8, y: 12 }, { x: 8, y: 13 }, { x: 8, y: 14 },
  { x: 7, y: 14 },
  { x: 6, y: 14 },
  // Blue start, heading left along the bottom-centre row
  { x: 6, y: 13 }, { x: 6, y: 12 }, { x: 6, y: 11 }, { x: 6, y: 10 }, { x: 6, y: 9 },
  { x: 5, y: 8 }, { x: 4, y: 8 }, { x: 3, y: 8 }, { x: 2, y: 8 }, { x: 1, y: 8 }, { x: 0, y: 8 },
  { x: 0, y: 7 },
  { x: 0, y: 6 },
];

/** The five private lane cells for each seat, walking toward the centre. */
export const HOME_STRETCH_CELLS: Record<number, Cell[]> = {
  0: [{ x: 1, y: 7 }, { x: 2, y: 7 }, { x: 3, y: 7 }, { x: 4, y: 7 }, { x: 5, y: 7 }],
  1: [{ x: 7, y: 1 }, { x: 7, y: 2 }, { x: 7, y: 3 }, { x: 7, y: 4 }, { x: 7, y: 5 }],
  2: [{ x: 13, y: 7 }, { x: 12, y: 7 }, { x: 11, y: 7 }, { x: 10, y: 7 }, { x: 9, y: 7 }],
  3: [{ x: 7, y: 13 }, { x: 7, y: 12 }, { x: 7, y: 11 }, { x: 7, y: 10 }, { x: 7, y: 9 }],
};

/** Parking spots for tokens still in their yard. */
export const YARD_CELLS: Record<number, Cell[]> = {
  0: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }],
  1: [{ x: 11, y: 2 }, { x: 12, y: 2 }, { x: 11, y: 3 }, { x: 12, y: 3 }],
  2: [{ x: 11, y: 11 }, { x: 12, y: 11 }, { x: 11, y: 12 }, { x: 12, y: 12 }],
  3: [{ x: 2, y: 11 }, { x: 3, y: 11 }, { x: 2, y: 12 }, { x: 3, y: 12 }],
};

export const BOARD_SIZE = 15;
export const CENTER_CELL: Cell = { x: 7, y: 7 };
