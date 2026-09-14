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
/**
 * Shared-track cells a seat actually WALKS: it enters on its start square and
 * turns into its home lane on `START_INDEX - 2` (the middle cell of its own
 * arm), so the walk is 51 cells (progress 0..50). Progress 51 would be the
 * OUTER corner cell past the lane entrance — that cell belongs to the next
 * seat's approach and must never be stepped on by this seat.
 */
export const TRACK_WALK_LENGTH = TRACK_LENGTH - 1; // 51
/** Private coloured lane each player walks before reaching home (5 cells). */
export const HOME_STRETCH_LENGTH = 5;
/** Tokens per player. */
export const TOKENS_PER_PLAYER = 4;

/** Progress buckets for one seat's journey. */
export const LANE_START = TRACK_WALK_LENGTH; // 51: first lane cell
export const LANE_END = TRACK_WALK_LENGTH + HOME_STRETCH_LENGTH - 1; // 55: last lane cell
export const HOME_PROGRESS = TRACK_WALK_LENGTH + HOME_STRETCH_LENGTH; // 56: final home

/**
 * Track index each seat enters the board on. The classic spacing is 13 cells
 * between consecutive starting squares.
 */
export const START_INDEX: Record<number, number> = { 0: 0, 1: 13, 2: 26, 3: 39 };

/**
 * The last shared-track cell a seat stands on before turning into its own
 * home lane: `START_INDEX - 2` wrapped. Geometrically this is the MIDDLE cell
 * of the seat's arm (red {0,7}, green {7,0}, yellow {14,7}, blue {7,14}),
 * directly adjacent to that seat's first lane cell. The old value (start - 1)
 * pointed at the OUTER corner cell past the entrance, which is exactly the
 * "token walks through an unrelated corner" bug.
 */
export const HOME_ENTRY_INDEX: Record<number, number> = Object.fromEntries(
  [0, 1, 2, 3].map((seat) => [
    seat,
    (START_INDEX[seat]! + TRACK_WALK_LENGTH - 1) % TRACK_LENGTH,
  ]),
) as Record<number, number>;

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
 * Total distance a token must travel to go from its starting square to the
 * final home cell: 51 walked track cells + 5 lane cells = 56. The journey is
 * therefore: progress 0..50 track, 51..55 lane, 56 home. (The old value of 58
 * produced a lane index of 5 for the final step — a cell that does not exist —
 * which made freshly-arrived home tokens disappear on the client.)
 */
export const FINISH_DISTANCE = TRACK_WALK_LENGTH + HOME_STRETCH_LENGTH;

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

/**
 * Where a seat's finished tokens rest inside the central home area — one
 * offset per token inside that seat's triangle, so a completed token keeps a
 * stable, clearly-visible "home" position (fix for tokens vanishing at home).
 */
export const HOME_TRIANGLE_SPOTS: Record<number, Cell[]> = {
  0: [
    { x: 6, y: 7 },
    { x: 6, y: 6.5 },
    { x: 6, y: 7.5 },
    { x: 6, y: 6 },
  ],
  1: [
    { x: 7, y: 6 },
    { x: 6.5, y: 6 },
    { x: 7.5, y: 6 },
    { x: 7, y: 6.5 },
  ],
  2: [
    { x: 8, y: 7 },
    { x: 8, y: 6.5 },
    { x: 8, y: 7.5 },
    { x: 8, y: 8 },
  ],
  3: [
    { x: 7, y: 8 },
    { x: 6.5, y: 8 },
    { x: 7.5, y: 8 },
    { x: 7, y: 8.5 },
  ],
};

/** The kind of location a progress value represents for a seat. */
export type ProgressKind = 'yard' | 'track' | 'lane' | 'home';

export function progressKind(progress: number): ProgressKind {
  if (progress < 0) return 'yard';
  if (progress < LANE_START) return 'track';
  if (progress <= LANE_END) return 'lane';
  return 'home';
}

export function isOnTrack(progress: number): boolean {
  return progress >= 0 && progress < LANE_START;
}

export function isInHomeLane(progress: number): boolean {
  return progress >= LANE_START && progress <= LANE_END;
}

export function isHome(progress: number): boolean {
  return progress >= HOME_PROGRESS;
}

/**
 * Grid cell for a seat's progress — THE single source of truth for both the
 * server and the client renderer, so the logical path and the drawn path can
 * never diverge. Returns null only for out-of-range progress.
 */
export function cellForProgress(seatIndex: number, progress: number, tokenIndex: number): Cell | null {
  const seat = ((seatIndex % 4) + 4) % 4;
  if (progress < 0) return YARD_CELLS[seat]?.[tokenIndex] ?? null;
  if (isOnTrack(progress)) {
    return TRACK_CELLS[trackIndexFor(seat, progress)] ?? null;
  }
  if (isInHomeLane(progress)) return HOME_STRETCH_CELLS[seat]?.[progress - LANE_START] ?? null;
  if (isHome(progress)) {
    // Final home: the seat's triangle inside the centre. Tokens cluster at
    // slightly different offsets inside their triangle so all four stay
    // visible, but every home token of a seat lives in that seat's triangle.
    const spots = HOME_TRIANGLE_SPOTS[seat];
    return spots?.[Math.min(tokenIndex, spots.length - 1)] ?? CENTER_CELL;
  }
  return null;
}

/**
 * Resolved grid cells for walking every step from one progress value to
 * another along a seat's route (used for move animations). `from`/`to` are
 * progress values on the same seat path.
 */
export function pathCellsFor(
  seatIndex: number,
  from: number,
  to: number,
  tokenIndex: number,
): Cell[] {
  const cells: Cell[] = [];
  for (let progress = from; progress <= to; progress += 1) {
    const cell = cellForProgress(seatIndex, progress, tokenIndex);
    if (cell) cells.push(cell);
  }
  return cells;
}

/**
 * Grid cells of a seat's FULL route: start square -> lane -> final home.
 * Used by tests to assert the rendered path never passes an unrelated corner.
 */
export function routeCellsFor(seatIndex: number, tokenIndex = 0): Cell[] {
  return pathCellsFor(seatIndex, 0, HOME_PROGRESS, tokenIndex);
}



