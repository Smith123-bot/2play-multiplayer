import type { GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { LOVE_MAZE_METADATA } from '@2play/shared';
export { LOVE_MAZE_METADATA };
import type {
  ActionResult,
  GameContext,
  GameModule,
  GamePlayerView,
  GameResultDraft,
  RankingDraft,
  ValidationResult,
} from '../GameModule';
import { actionAccepted, actionRejected } from '../GameModule';
import { MAZE_LEVELS, MAZE_TOTAL_LEVELS, type MazeLevel } from './levels';

export * from './levels';

/**
 * Love Maze — two players, one maze, one shared clock.
 *
 * Cooperation is structural, not cosmetic: switch `a` only responds to player
 * A, switch `b` only to player B, plates need both bodies at once, and the exit
 * only fires when BOTH players stand on it with every key collected.
 */

export type MazePhase = 'idle' | 'playing' | 'level-clear' | 'finished';
export type MazeDirection = 'up' | 'down' | 'left' | 'right';

export type MazeTile =
  | 'wall'
  | 'floor'
  | 'switch-a'
  | 'switch-b'
  | 'plate'
  | 'door'
  | 'key'
  | 'hazard'
  | 'checkpoint'
  | 'exit';

export interface MazeActor {
  x: number;
  y: number;
  spawnX: number;
  spawnY: number;
  /** Last checkpoint reached; hazards send the player back here. */
  checkpointX: number;
  checkpointY: number;
  /** 'a' for the first seat, 'b' for the second. */
  role: 'a' | 'b';
  onExit: boolean;
  holding: string | null;
  hazardHits: number;
  keysCollected: number;
  disconnected: boolean;
  left: boolean;
}

export interface MazeState {
  phase: MazePhase;
  level: number;
  totalLevels: number;
  levelName: string;
  hint: string;
  cols: number;
  rows: number;
  tiles: MazeTile[][];
  /** Cells whose key has already been taken. */
  keysTaken: string[];
  keysRequired: number;
  keysCollected: number;
  /** Door cells currently open. */
  doorsOpen: boolean;
  /** True while the coordinated condition is being held right now. */
  coopSatisfied: boolean;
  switchesHeld: { a: boolean; b: boolean };
  platesHeld: number;
  platesTotal: number;
  players: Record<string, MazeActor>;
  levelEndsAt: number | null;
  levelStartedAt: number | null;
  teamScore: number;
  levelsCleared: number;
  mistakes: number;
  clearTimes: number[];
  lastEvent: string | null;
  finishReason: GameFinishReason | null;
}

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

export const LEVEL_CLEAR_SCORE = 200;
export const KEY_SCORE = 40;
export const CHECKPOINT_SCORE = 15;
export const HAZARD_PENALTY = 25;
export const TIME_BONUS_MAX = 150;
export const COOP_BONUS = 60;
export const LEVEL_BREAK_MS = 2_600;

const DELTA: Record<MazeDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export function isMazeDirection(value: unknown): value is MazeDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

const CHAR_TO_TILE: Record<string, MazeTile> = {
  '#': 'wall',
  '.': 'floor',
  A: 'floor',
  B: 'floor',
  a: 'switch-a',
  b: 'switch-b',
  p: 'plate',
  D: 'door',
  K: 'key',
  H: 'hazard',
  C: 'checkpoint',
  E: 'exit',
};

export interface BuiltMaze {
  cols: number;
  rows: number;
  tiles: MazeTile[][];
  spawnA: { x: number; y: number };
  spawnB: { x: number; y: number };
  platesTotal: number;
  keyCells: string[];
}

export function levelAt(index: number): MazeLevel {
  const level = MAZE_LEVELS[Math.max(0, Math.min(index, MAZE_LEVELS.length - 1))];
  return level ?? (MAZE_LEVELS[0] as MazeLevel);
}

export function buildMaze(level: MazeLevel): BuiltMaze {
  const tiles: MazeTile[][] = [];
  let spawnA = { x: 1, y: 1 };
  let spawnB = { x: 1, y: 1 };
  let platesTotal = 0;
  const keyCells: string[] = [];

  level.layout.forEach((line, y) => {
    const row: MazeTile[] = [];
    [...line].forEach((char, x) => {
      const tile = CHAR_TO_TILE[char] ?? 'floor';
      if (char === 'A') spawnA = { x, y };
      if (char === 'B') spawnB = { x, y };
      if (tile === 'plate') platesTotal += 1;
      if (tile === 'key') keyCells.push(`${x}:${y}`);
      row.push(tile);
    });
    tiles.push(row);
  });

  return { cols: tiles[0]?.length ?? 0, rows: tiles.length, tiles, spawnA, spawnB, platesTotal, keyCells };
}

export function tileAt(state: MazeState, x: number, y: number): MazeTile {
  if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return 'wall';
  return state.tiles[y]?.[x] ?? 'wall';
}

/** Walls always block; doors block until their condition is satisfied. */
export function isWalkable(state: MazeState, x: number, y: number): boolean {
  const tile = tileAt(state, x, y);
  if (tile === 'wall') return false;
  if (tile === 'door' && !state.doorsOpen) return false;
  return true;
}

function actorsOf(state: MazeState): MazeActor[] {
  return Object.values(state.players).filter((actor) => !actor.left);
}

/**
 * Recomputes every cooperative condition from the authoritative board.
 * Called after each move — never trusted from a client.
 */
export function refreshCoop(state: MazeState): void {
  const actors = actorsOf(state).filter((actor) => !actor.disconnected);

  // Role-locked switches: only the matching player can hold one.
  state.switchesHeld.a = actors.some(
    (actor) => actor.role === 'a' && tileAt(state, actor.x, actor.y) === 'switch-a',
  );
  state.switchesHeld.b = actors.some(
    (actor) => actor.role === 'b' && tileAt(state, actor.x, actor.y) === 'switch-b',
  );

  // Shared plates need a distinct body on each plate.
  const platesCovered = new Set<string>();
  for (const actor of actors) {
    if (tileAt(state, actor.x, actor.y) === 'plate') platesCovered.add(`${actor.x}:${actor.y}`);
  }
  state.platesHeld = platesCovered.size;

  // The cooperative requirement: every switch present must be held by its own
  // partner, and every plate must be covered, all at the same moment.
  const hasA = state.tiles.some((row) => row.includes('switch-a'));
  const hasB = state.tiles.some((row) => row.includes('switch-b'));
  const needsSwitches = hasA || hasB;
  const needsPlates = state.platesTotal > 0;

  let satisfied = needsSwitches || needsPlates;
  if (hasA) satisfied = satisfied && state.switchesHeld.a;
  if (hasB) satisfied = satisfied && state.switchesHeld.b;
  if (needsPlates) satisfied = satisfied && state.platesHeld >= state.platesTotal;
  state.coopSatisfied = satisfied;

  // The gate LATCHES: the pair must coordinate to trigger it, but once it is
  // open they can both leave their switches and walk through. Without this a
  // two player level would be unsolvable — everyone would be stuck holding.
  if (satisfied) state.doorsOpen = true;

  for (const actor of actors) actor.onExit = tileAt(state, actor.x, actor.y) === 'exit';
}

/** BOTH players on the exit with every key collected. */
export function exitSatisfied(state: MazeState): boolean {
  const actors = actorsOf(state);
  if (actors.length < 2) return false;
  if (state.keysCollected < state.keysRequired) return false;
  return actors.every((actor) => !actor.disconnected && tileAt(state, actor.x, actor.y) === 'exit');
}

export function finishMaze(state: MazeState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.levelEndsAt = null;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

export function loadLevel(state: MazeState, ctx: GameContext): void {
  const level = levelAt(state.level);
  const built = buildMaze(level);
  state.levelName = level.name;
  state.hint = level.hint;
  state.cols = built.cols;
  state.rows = built.rows;
  state.tiles = built.tiles;
  state.keysTaken = [];
  state.keysRequired = level.keysRequired;
  state.keysCollected = 0;
  state.platesTotal = built.platesTotal;
  state.platesHeld = 0;
  state.doorsOpen = false;
  state.coopSatisfied = false;
  state.switchesHeld = { a: false, b: false };

  const seats = Object.values(state.players);
  seats.forEach((actor) => {
    const spawn = actor.role === 'a' ? built.spawnA : built.spawnB;
    actor.x = spawn.x;
    actor.y = spawn.y;
    actor.spawnX = spawn.x;
    actor.spawnY = spawn.y;
    actor.checkpointX = spawn.x;
    actor.checkpointY = spawn.y;
    actor.onExit = false;
    actor.keysCollected = 0;
  });

  state.phase = 'playing';
  state.levelStartedAt = ctx.now();
  state.levelEndsAt = ctx.now() + level.timeLimit * 1000;
  state.lastEvent = `level:${state.level}`;
  refreshCoop(state);
  ctx.markStateChanged();

  ctx.schedule(
    level.timeLimit * 1000,
    () => {
      if (state.phase !== 'playing') return;
      // Running out of time ends the run — the team keeps what it scored.
      state.lastEvent = 'level-timeout';
      finishMaze(state, ctx, 'timeout');
    },
    'turn',
    `level-${state.level}`,
  );
}

/** Awards the level bonus and moves the team on (or wins the run). */
export function completeLevel(state: MazeState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  const level = levelAt(state.level);
  const elapsed = ctx.now() - (state.levelStartedAt ?? ctx.now());
  const limit = level.timeLimit * 1000;
  const remaining = Math.max(0, limit - elapsed);

  state.teamScore += LEVEL_CLEAR_SCORE;
  state.teamScore += Math.round(TIME_BONUS_MAX * Math.min(1, remaining / limit));
  // Cooperation bonus for levels that actually required a gate.
  if (state.platesTotal > 0 || state.tiles.some((row) => row.includes('switch-a') || row.includes('switch-b'))) {
    state.teamScore += COOP_BONUS;
  }
  state.levelsCleared += 1;
  state.clearTimes.push(elapsed);
  state.lastEvent = `level-clear:${state.level}`;

  if (state.level + 1 >= state.totalLevels) {
    state.phase = 'finished';
    ctx.markStateChanged();
    finishMaze(state, ctx, 'completed');
    return;
  }

  state.level += 1;
  state.phase = 'level-clear';
  state.levelEndsAt = ctx.now() + LEVEL_BREAK_MS;
  ctx.markStateChanged();
  ctx.schedule(
    LEVEL_BREAK_MS,
    () => {
      if (state.phase !== 'level-clear') return;
      loadLevel(state, ctx);
    },
    'turn',
    `break-${state.level}`,
  );
}

function makeActor(role: 'a' | 'b'): MazeActor {
  return {
    x: 1,
    y: 1,
    spawnX: 1,
    spawnY: 1,
    checkpointX: 1,
    checkpointY: 1,
    role,
    onExit: false,
    holding: null,
    hazardHits: 0,
    keysCollected: 0,
    disconnected: false,
    left: false,
  };
}

function resolveLevels(config: GameConfig): number {
  if (typeof config.rounds === 'number' && Number.isFinite(config.rounds)) {
    return Math.min(MAZE_TOTAL_LEVELS, Math.max(1, Math.round(config.rounds)));
  }
  return MAZE_TOTAL_LEVELS;
}

export const loveMazeGame: GameModule<MazeState> = {
  metadata: LOVE_MAZE_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players: readonly GamePlayerView[], config: GameConfig): MazeState {
    const state: MazeState = {
      phase: 'idle',
      level: 0,
      totalLevels: resolveLevels(config),
      levelName: '',
      hint: '',
      cols: 0,
      rows: 0,
      tiles: [],
      keysTaken: [],
      keysRequired: 0,
      keysCollected: 0,
      doorsOpen: false,
      coopSatisfied: false,
      switchesHeld: { a: false, b: false },
      platesHeld: 0,
      platesTotal: 0,
      players: {},
      levelEndsAt: null,
      levelStartedAt: null,
      teamScore: 0,
      levelsCleared: 0,
      mistakes: 0,
      clearTimes: [],
      lastEvent: null,
      finishReason: null,
    };
    players.forEach((player, index) => {
      const seat = typeof player.seatIndex === 'number' ? player.seatIndex : index;
      state.players[player.id] = makeActor(seat === 0 ? 'a' : 'b');
    });
    return state;
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    const seat = typeof player.seatIndex === 'number' ? player.seatIndex : Object.keys(state.players).length;
    state.players[player.id] = makeActor(seat === 0 ? 'a' : 'b');
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const actor = state.players[playerId];
    if (!actor) return;
    if (reason === 'disconnect') {
      // Seat preserved for the 120s grace window; held plates release at once.
      actor.disconnected = true;
      refreshCoop(state);
      ctx.markStateChanged();
      return;
    }
    actor.left = true;
    refreshCoop(state);
    // Love Maze needs two players — one leaving ends the run.
    if (actorsOf(state).length < 2) finishMaze(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    state.players = {};
    ctx.players.forEach((player, index) => {
      const seat = typeof player.seatIndex === 'number' ? player.seatIndex : index;
      state.players[player.id] = makeActor(seat === 0 ? 'a' : 'b');
    });
    state.level = 0;
    state.teamScore = 0;
    state.levelsCleared = 0;
    state.mistakes = 0;
    state.clearTimes = [];
    state.finishReason = null;
    loadLevel(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (['score', 'win', 'complete', 'finish', 'open', 'teleport'].includes(action.type)) {
      return { valid: false, reason: 'The server owns the maze.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'The maze is not live.' };
    if (action.type !== 'move') return { valid: false, reason: 'Unknown action.' };
    if (!isMazeDirection(action.payload?.direction)) {
      return { valid: false, reason: 'Use up, down, left or right.' };
    }
    const actor = state.players[playerId];
    if (!actor || actor.left) return { valid: false, reason: 'You are not in this maze.' };
    if (actor.disconnected) return { valid: false, reason: 'Reconnect to keep moving.' };

    const delta = DELTA[action.payload.direction as MazeDirection];
    if (!isWalkable(state, actor.x + delta.dx, actor.y + delta.dy)) {
      return { valid: false, reason: 'A wall or a closed door blocks that way.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (state.phase !== 'playing') return actionRejected('The maze is not live.');
    if (action.type !== 'move') return actionRejected('Unknown action.');
    const direction = action.payload?.direction;
    if (!isMazeDirection(direction)) return actionRejected('Invalid direction.');

    const actor = state.players[playerId];
    if (!actor || actor.left || actor.disconnected) return actionRejected('You cannot move.');

    const delta = DELTA[direction];
    const nx = actor.x + delta.dx;
    const ny = actor.y + delta.dy;
    if (!isWalkable(state, nx, ny)) return actionRejected('Blocked.');

    actor.x = nx;
    actor.y = ny;
    const tile = tileAt(state, nx, ny);
    let event = `move:${playerId}`;

    if (tile === 'hazard') {
      // Back to the last checkpoint, and the team loses points.
      actor.x = actor.checkpointX;
      actor.y = actor.checkpointY;
      actor.hazardHits += 1;
      state.mistakes += 1;
      state.teamScore = Math.max(0, state.teamScore - HAZARD_PENALTY);
      event = `hazard:${playerId}`;
    } else if (tile === 'checkpoint') {
      if (actor.checkpointX !== nx || actor.checkpointY !== ny) {
        actor.checkpointX = nx;
        actor.checkpointY = ny;
        state.teamScore += CHECKPOINT_SCORE;
        event = `checkpoint:${playerId}`;
      }
    } else if (tile === 'key') {
      const cell = `${nx}:${ny}`;
      // Keys are one-time rewards — no duplicate scoring.
      if (!state.keysTaken.includes(cell)) {
        state.keysTaken.push(cell);
        state.keysCollected += 1;
        actor.keysCollected += 1;
        state.teamScore += KEY_SCORE;
        event = `key:${playerId}`;
      }
    }

    refreshCoop(state);
    state.lastEvent = event;
    ctx.markStateChanged();

    // The level only clears when BOTH players are on the exit.
    if (exitSatisfied(state)) completeLevel(state, ctx);
    return actionAccepted();
  },

  update(): void {
    // Movement driven; the level timer lives on the TimerManager.
  },

  tick(): void {
    // Not used.
  },

  calculateScore(_playerId, state): number {
    // Co-op: both partners share the team score.
    return state.teamScore;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    // Co-op: the whole team wins together, or nobody does.
    if (state.levelsCleared > 0) return Object.keys(state.players);
    return [];
  },

  checkDrawCondition(state): boolean {
    return state.phase === 'finished' && state.levelsCleared === 0;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
    state.levelEndsAt = null;
  },

  getResult(state, ctx): GameResultDraft {
    const cleared = state.levelsCleared > 0;
    const rankings: RankingDraft[] = ctx.players.map((player) => {
      const actor = state.players[player.id];
      return {
        playerId: player.id,
        // Cooperative: both partners share rank 1 and the same score.
        rank: 1,
        score: state.teamScore,
        isWinner: cleared,
        isDraw: !cleared,
        stats: {
          levelsCleared: state.levelsCleared,
          keys: actor?.keysCollected ?? 0,
          hazardHits: actor?.hazardHits ?? 0,
        },
      };
    });
    return {
      winners: cleared ? ctx.players.map((player) => player.id) : [],
      isDraw: !cleared,
      rankings,
      reason: state.finishReason ?? 'completed',
    };
  },

  reset(state): MazeState {
    return {
      ...state,
      phase: 'idle',
      level: 0,
      levelName: '',
      hint: '',
      cols: 0,
      rows: 0,
      tiles: [],
      keysTaken: [],
      keysRequired: 0,
      keysCollected: 0,
      doorsOpen: false,
      coopSatisfied: false,
      switchesHeld: { a: false, b: false },
      platesHeld: 0,
      platesTotal: 0,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, actor]) => [id, makeActor(actor.role)]),
      ),
      levelEndsAt: null,
      levelStartedAt: null,
      teamScore: 0,
      levelsCleared: 0,
      mistakes: 0,
      clearTimes: [],
      lastEvent: null,
      finishReason: null,
    };
  },

  cleanup(state): void {
    state.players = {};
    state.tiles = [];
    state.keysTaken = [];
    state.phase = 'finished';
  },

  /** Co-op game: the maze is shared, so both partners see the same board. */
  getPublicState(state, viewerId, ctx) {
    const me = viewerId ? state.players[viewerId] : undefined;
    return {
      phase: state.phase,
      level: state.level,
      totalLevels: state.totalLevels,
      levelName: state.levelName,
      hint: state.hint,
      cols: state.cols,
      rows: state.rows,
      tiles: state.tiles,
      keysTaken: [...state.keysTaken],
      keysRequired: state.keysRequired,
      keysCollected: state.keysCollected,
      doorsOpen: state.doorsOpen,
      coopSatisfied: state.coopSatisfied,
      switchesHeld: { ...state.switchesHeld },
      platesHeld: state.platesHeld,
      platesTotal: state.platesTotal,
      levelEndsAt: state.levelEndsAt,
      teamScore: state.teamScore,
      levelsCleared: state.levelsCleared,
      mistakes: state.mistakes,
      lastEvent: state.lastEvent,
      finishReason: state.finishReason,
      serverTime: ctx.now(),
      myRole: me?.role ?? null,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, actor]) => [
          id,
          {
            x: actor.x,
            y: actor.y,
            role: actor.role,
            onExit: actor.onExit,
            hazardHits: actor.hazardHits,
            keysCollected: actor.keysCollected,
            disconnected: actor.disconnected,
          },
        ]),
      ),
    };
  },

  /**
   * Co-op AI partner: walks toward whatever the team needs next — its own
   * switch, an uncollected key, or the exit — using BFS over the real board.
   */
  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const actor = state.players[playerId];
    if (!actor || actor.left) return null;

    const target = mazeTarget(state, actor);
    if (!target) return null;

    // Easy partners dawdle; hard partners path straight to the goal.
    if (difficulty === 'easy' && ctx.random() < 0.35) {
      const options = (['up', 'down', 'left', 'right'] as MazeDirection[]).filter((dir) =>
        isWalkable(state, actor.x + DELTA[dir].dx, actor.y + DELTA[dir].dy),
      );
      const pick = options[Math.floor(ctx.random() * options.length)];
      return pick ? { type: 'move', payload: { direction: pick } } : null;
    }

    const step = bfsStep(state, actor, target, difficulty !== 'easy');
    return step ? { type: 'move', payload: { direction: step } } : null;
  },

  maxDurationMs: 30 * 60 * 1000,
};

/** What this AI partner should walk toward right now. */
function mazeTarget(state: MazeState, actor: MazeActor): { x: number; y: number } | null {
  const mine: MazeTile = actor.role === 'a' ? 'switch-a' : 'switch-b';
  const partner = actorsOf(state).find((other) => other !== actor);

  // If a gate needs holding and the partner is already past it, take the switch.
  const hasMySwitch = state.tiles.some((row) => row.includes(mine));
  const held = actor.role === 'a' ? state.switchesHeld.a : state.switchesHeld.b;
  if (hasMySwitch && !held && !state.doorsOpen) {
    const cell = findTile(state, mine);
    if (cell) return cell;
  }
  // Shared plates: stand on the nearest free one.
  if (state.platesTotal > 0 && state.platesHeld < state.platesTotal) {
    const plate = findTile(state, 'plate', (x, y) => !(partner && partner.x === x && partner.y === y));
    if (plate) return plate;
  }
  // Keys still to collect.
  if (state.keysCollected < state.keysRequired) {
    const key = findTile(state, 'key', (x, y) => !state.keysTaken.includes(`${x}:${y}`));
    if (key) return key;
  }
  return findTile(state, 'exit');
}

function findTile(
  state: MazeState,
  tile: MazeTile,
  predicate?: (x: number, y: number) => boolean,
): { x: number; y: number } | null {
  for (let y = 0; y < state.rows; y += 1) {
    for (let x = 0; x < state.cols; x += 1) {
      if (state.tiles[y]?.[x] !== tile) continue;
      if (predicate && !predicate(x, y)) continue;
      return { x, y };
    }
  }
  return null;
}

/** Breadth-first first-step search over the live board. */
function bfsStep(
  state: MazeState,
  from: { x: number; y: number },
  target: { x: number; y: number },
  avoidHazards: boolean,
): MazeDirection | null {
  if (from.x === target.x && from.y === target.y) return null;
  const dirs: MazeDirection[] = ['up', 'down', 'left', 'right'];
  const seen = new Set<string>([`${from.x}:${from.y}`]);
  const queue: Array<{ x: number; y: number; first: MazeDirection }> = [];

  for (const dir of dirs) {
    const nx = from.x + DELTA[dir].dx;
    const ny = from.y + DELTA[dir].dy;
    if (!isWalkable(state, nx, ny)) continue;
    if (avoidHazards && tileAt(state, nx, ny) === 'hazard') continue;
    if (nx === target.x && ny === target.y) return dir;
    seen.add(`${nx}:${ny}`);
    queue.push({ x: nx, y: ny, first: dir });
  }

  while (queue.length > 0) {
    const node = queue.shift() as { x: number; y: number; first: MazeDirection };
    for (const dir of dirs) {
      const nx = node.x + DELTA[dir].dx;
      const ny = node.y + DELTA[dir].dy;
      const key = `${nx}:${ny}`;
      if (seen.has(key)) continue;
      if (!isWalkable(state, nx, ny)) continue;
      if (avoidHazards && tileAt(state, nx, ny) === 'hazard') continue;
      if (nx === target.x && ny === target.y) return node.first;
      seen.add(key);
      queue.push({ x: nx, y: ny, first: node.first });
    }
  }
  return null;
}
