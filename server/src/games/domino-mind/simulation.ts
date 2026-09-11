/**
 * Domino Mind — deterministic 2D chain-reaction simulation.
 *
 * This is NOT traditional dominoes and NOT 3D physics. It is a pure,
 * deterministic 2D simulation: a domino falls in a direction, and topples any
 * standing domino within its reach along that direction. The same board always
 * produces the same result, and changing the layout changes the outcome —
 * nothing is pre-recorded.
 */

export type Facing = 'N' | 'E' | 'S' | 'W';

export const FACINGS: Facing[] = ['N', 'E', 'S', 'W'];

export const FACING_DELTA: Record<Facing, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
};

export type PieceKind =
  /** A normal domino the player may move and rotate. */
  | 'domino'
  /**
   * The ONLY piece the player may push to begin the chain. Without this the
   * puzzle would be trivial: a player could simply push the target directly.
   */
  | 'start'
  /** Pre-placed and immovable, but it still falls and propagates. */
  | 'fixed'
  /** Stops a chain dead; never falls. */
  | 'blocker'
  /** Falls, and topples in BOTH perpendicular directions as well. */
  | 'splitter'
  /** Must end up fallen for the level to be solved. */
  | 'target';

export interface Piece {
  id: string;
  x: number;
  y: number;
  /** The direction this piece topples toward when pushed. */
  facing: Facing;
  kind: PieceKind;
  /** Set by the simulation, not stored between attempts. */
  fallen: boolean;
  /** Order in which it fell (0 = the pushed piece). -1 when standing. */
  fallOrder: number;
}

export interface DominoLevel {
  id: number;
  name: string;
  hint: string;
  cols: number;
  rows: number;
  /** Pieces already on the board at the start. */
  pieces: Piece[];
  /** How many dominoes the player may place. */
  budget: number;
  /** How far a falling domino reaches along its facing. */
  reach: number;
  /**
   * Ids that MUST be fallen when the chain settles. The chain may only be
   * started from the level's `start` piece, so reaching these requires the
   * player to actually build a working route.
   */
  requiredTargets: string[];
  /** Ids that must NOT be fallen (decoys / forbidden). */
  forbidden: string[];
  timeLimit: number;
}

export interface SimulationResult {
  /** Ids of every piece that fell, in order. */
  fallen: string[];
  /** Ids still standing when the chain settled. */
  standing: string[];
  /** All required targets fell and no forbidden piece did. */
  success: boolean;
  /** Required target ids that failed to fall. */
  missingTargets: string[];
  /** Forbidden ids that fell. */
  hitForbidden: string[];
  /** Number of pieces toppled. */
  triggered: number;
}

export function pieceAt(pieces: Piece[], x: number, y: number): Piece | undefined {
  return pieces.find((piece) => piece.x === x && piece.y === y);
}

export function inBounds(level: { cols: number; rows: number }, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < level.cols && y < level.rows;
}

/**
 * Which pieces a falling `piece` topples.
 *
 * The rule: scan outward along the facing up to `reach` cells. The first
 * standing piece found is toppled and the scan stops (a domino cannot reach
 * past another one). A blocker stops the scan without falling. A splitter also
 * topples the two perpendicular directions.
 */
export function targetsOf(
  piece: Piece,
  pieces: Piece[],
  level: { cols: number; rows: number },
  reach: number,
): Piece[] {
  const directions: Facing[] = [piece.facing];
  if (piece.kind === 'splitter') {
    // A splitter also pushes sideways relative to its facing.
    const perpendicular: Facing[] =
      piece.facing === 'N' || piece.facing === 'S' ? ['E', 'W'] : ['N', 'S'];
    directions.push(...perpendicular);
  }

  const hits: Piece[] = [];
  for (const direction of directions) {
    const delta = FACING_DELTA[direction];
    for (let step = 1; step <= reach; step += 1) {
      const x = piece.x + delta.dx * step;
      const y = piece.y + delta.dy * step;
      if (!inBounds(level, x, y)) break;
      const found = pieceAt(pieces, x, y);
      if (!found) continue;
      // A blocker absorbs the fall and stops the scan.
      if (found.kind === 'blocker') break;
      hits.push(found);
      break; // the first piece in the line takes the hit
    }
  }
  return hits;
}

/**
 * Runs the chain reaction from `startId` on a COPY of the pieces.
 *
 * Deterministic breadth-first propagation: the pushed piece falls, then
 * everything it reaches falls, and so on until nothing new can topple.
 */
export function simulate(
  pieces: Piece[],
  level: { cols: number; rows: number },
  reach: number,
  startId: string,
  requiredTargets: string[],
  forbidden: string[],
): { result: SimulationResult; pieces: Piece[] } {
  const board = pieces.map((piece) => ({ ...piece, fallen: false, fallOrder: -1 }));
  const start = board.find((piece) => piece.id === startId);

  if (!start || start.kind === 'blocker') {
    return {
      result: {
        fallen: [],
        standing: board.map((piece) => piece.id),
        success: false,
        missingTargets: [...requiredTargets],
        hitForbidden: [],
        triggered: 0,
      },
      pieces: board,
    };
  }

  const order: string[] = [];
  const queue: Piece[] = [start];
  start.fallen = true;
  start.fallOrder = 0;
  order.push(start.id);

  while (queue.length > 0) {
    const piece = queue.shift() as Piece;
    for (const hit of targetsOf(piece, board, level, reach)) {
      if (hit.fallen || hit.kind === 'blocker') continue;
      hit.fallen = true;
      hit.fallOrder = order.length;
      order.push(hit.id);
      queue.push(hit);
    }
  }

  const fallenSet = new Set(order);
  const missingTargets = requiredTargets.filter((id) => !fallenSet.has(id));
  const hitForbidden = forbidden.filter((id) => fallenSet.has(id));

  return {
    result: {
      fallen: order,
      standing: board.filter((piece) => !piece.fallen).map((piece) => piece.id),
      success: missingTargets.length === 0 && hitForbidden.length === 0,
      missingTargets,
      hitForbidden,
      triggered: order.length,
    },
    pieces: board,
  };
}

/* ------------------------------------------------------------------ */
/* Levels                                                              */
/* ------------------------------------------------------------------ */

function piece(id: string, x: number, y: number, facing: Facing, kind: PieceKind = 'domino'): Piece {
  return { id, x, y, facing, kind, fallen: false, fallOrder: -1 };
}

/**
 * Ten handcrafted levels. Each has a validated solution (see the test suite,
 * which proves every level is solvable within its placement budget).
 *
 * Difficulty ramps: short obvious chains, then gaps needing a placed domino,
 * then blockers, splitters and forbidden decoys.
 */
export const DOMINO_LEVELS: DominoLevel[] = [
  {
    id: 1,
    name: 'First Push',
    hint: 'One domino is missing from the line. Place it, then push from the left.',
    cols: 6,
    rows: 3,
    reach: 2,
    budget: 1,
    pieces: [
      piece('a', 0, 1, 'E', 'start'),
      // gap at x=1 and x=2: reach 2 cannot span it, so a placement is required
      piece('c', 3, 1, 'E'),
      piece('t', 4, 1, 'E', 'target'),
    ],
    requiredTargets: ['t'],
    forbidden: [],
    timeLimit: 90,
  },
  {
    id: 2,
    name: 'Mind the Gap',
    hint: 'Two gaps to bridge before the chain reaches the target.',
    cols: 8,
    rows: 3,
    reach: 2,
    budget: 2,
    pieces: [
      piece('a', 0, 1, 'E', 'start'),
      piece('c', 3, 1, 'E'),
      piece('e', 6, 1, 'E'),
      piece('t', 7, 1, 'E', 'target'),
    ],
    requiredTargets: ['t'],
    forbidden: [],
    timeLimit: 100,
  },
  {
    id: 3,
    name: 'Turn the Corner',
    hint: 'Place a domino facing south so the chain turns downward.',
    cols: 6,
    rows: 5,
    reach: 2,
    budget: 1,
    pieces: [
      piece('a', 0, 0, 'E', 'start'),
      piece('b', 1, 0, 'E'),
      // a south-facing turner is needed around (2,0)/(3,0)
      piece('c', 3, 2, 'S'),
      piece('t', 3, 3, 'S', 'target'),
    ],
    requiredTargets: ['t'],
    forbidden: [],
    timeLimit: 110,
  },
  {
    id: 4,
    name: 'Two Targets',
    hint: 'A splitter pushes sideways as well as forward — but it must be reached first.',
    cols: 7,
    rows: 5,
    reach: 2,
    budget: 1,
    pieces: [
      piece('a', 0, 2, 'E', 'start'),
      piece('s', 3, 2, 'E', 'splitter'),
      piece('t1', 3, 1, 'N', 'target'),
      piece('t2', 3, 3, 'S', 'target'),
    ],
    requiredTargets: ['t1', 't2'],
    forbidden: [],
    timeLimit: 120,
  },
  {
    id: 5,
    name: 'Blocked Path',
    hint: 'A blocker stops the chain dead. Route the cascade around it.',
    cols: 7,
    rows: 5,
    reach: 2,
    budget: 3,
    pieces: [
      piece('a', 0, 2, 'N', 'start'),
      piece('x', 2, 2, 'E', 'blocker'),
      // The direct corridor is blocked, so the chain must detour via row 0.
      piece('c', 4, 0, 'S'),
      piece('t', 4, 2, 'S', 'target'),
    ],
    requiredTargets: ['t'],
    forbidden: [],
    timeLimit: 130,
  },
  {
    id: 6,
    name: 'Do Not Touch',
    hint: 'The forbidden domino must stay standing. Bridge the gap without disturbing it.',
    cols: 7,
    rows: 5,
    reach: 2,
    budget: 1,
    pieces: [
      piece('a', 0, 1, 'E', 'start'),
      piece('t', 3, 1, 'E', 'target'),
      piece('f', 0, 3, 'E'),
    ],
    requiredTargets: ['t'],
    forbidden: ['f'],
    timeLimit: 130,
  },
  {
    id: 7,
    name: 'Long Way Round',
    hint: 'Bridge two gaps to send the chain all the way down.',
    cols: 8,
    rows: 6,
    reach: 2,
    budget: 2,
    pieces: [
      piece('a', 0, 0, 'E', 'start'),
      piece('c', 3, 0, 'S'),
      piece('d', 3, 3, 'S'),
      piece('t', 3, 4, 'S', 'target'),
    ],
    requiredTargets: ['t'],
    forbidden: [],
    timeLimit: 150,
  },
  {
    id: 8,
    name: 'Split Decision',
    hint: 'Reach the splitter, and it will take care of both targets.',
    cols: 8,
    rows: 6,
    reach: 2,
    budget: 2,
    pieces: [
      piece('a', 0, 3, 'E', 'start'),
      piece('s', 4, 3, 'E', 'splitter'),
      piece('t1', 4, 1, 'N', 'target'),
      piece('t2', 4, 5, 'S', 'target'),
    ],
    requiredTargets: ['t1', 't2'],
    forbidden: [],
    timeLimit: 160,
  },
  {
    id: 9,
    name: 'Threading',
    hint: 'A blocker guards the top row and one domino must survive. Thread the lower route.',
    cols: 9,
    rows: 6,
    reach: 2,
    budget: 2,
    pieces: [
      piece('a', 0, 2, 'E', 'start'),
      piece('x1', 2, 0, 'E', 'blocker'),
      piece('d', 3, 2, 'E'),
      piece('t', 6, 2, 'E', 'target'),
      piece('f', 4, 0, 'E'),
    ],
    requiredTargets: ['t'],
    forbidden: ['f'],
    timeLimit: 170,
  },
  {
    id: 10,
    name: 'Grand Cascade',
    hint: 'Three targets. Bridge to the splitter, then carry the chain onward.',
    cols: 9,
    rows: 7,
    reach: 2,
    budget: 3,
    pieces: [
      piece('a', 0, 3, 'E', 'start'),
      piece('s', 3, 3, 'E', 'splitter'),
      piece('t1', 3, 1, 'N', 'target'),
      piece('t2', 3, 5, 'S', 'target'),
      piece('t3', 7, 3, 'E', 'target'),
    ],
    requiredTargets: ['t1', 't2', 't3'],
    forbidden: [],
    timeLimit: 190,
  },
];

export const DOMINO_TOTAL_LEVELS = DOMINO_LEVELS.length;

/** The only piece a player may push. */
export function startPieceOf(pieces: Piece[]): Piece | undefined {
  return pieces.find((entry) => entry.kind === 'start');
}

export function levelAt(index: number): DominoLevel {
  const level = DOMINO_LEVELS[Math.max(0, Math.min(index, DOMINO_LEVELS.length - 1))];
  return level ?? (DOMINO_LEVELS[0] as DominoLevel);
}

/** Deep-copies a level's starting pieces so a run never mutates the template. */
export function clonePieces(level: DominoLevel): Piece[] {
  return level.pieces.map((entry) => ({ ...entry, fallen: false, fallOrder: -1 }));
}
