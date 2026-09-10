import type { GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { BUILD_TOGETHER_METADATA } from '@2play/shared';
export { BUILD_TOGETHER_METADATA };
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
import { BUILD_LEVELS, BUILD_TOTAL_LEVELS, type BuildLevel, type PieceKind } from './levels';

export * from './levels';

/**
 * Build Together — two partners reproduce a blueprint from a limited supply.
 *
 * Cooperation is enforced by the inventory: `a` pieces can only be placed by
 * partner A, `b` pieces only by partner B. Every blueprint mixes both, so a
 * structure literally cannot be completed by one person.
 *
 * The server owns the grid, the inventory and — critically — the completion
 * check. A client can never declare "BUILD COMPLETE".
 */

export type BuildPhase = 'idle' | 'playing' | 'level-clear' | 'finished';

export interface PlacedPiece {
  x: number;
  y: number;
  kind: PieceKind;
  /** 0/90/180/270 — matters only on rotation levels. */
  rotation: number;
  placedBy: string;
}

export interface BuildPlayer {
  role: 'a' | 'b';
  placed: number;
  removed: number;
  misplacements: number;
  disconnected: boolean;
  left: boolean;
}

export interface BuildState {
  phase: BuildPhase;
  level: number;
  totalLevels: number;
  levelName: string;
  hint: string;
  cols: number;
  rows: number;
  /** Required kind per cell, or null where the blueprint is empty. */
  blueprint: Array<Array<PieceKind | null>>;
  /** What has actually been built. */
  placed: PlacedPiece[];
  /** Remaining pieces by kind. */
  inventory: Record<PieceKind, number>;
  rotationRequired: boolean;
  /** Required rotation per cell on rotation levels (0 when irrelevant). */
  requiredRotation: number[][];
  players: Record<string, BuildPlayer>;
  cellsRequired: number;
  cellsCorrect: number;
  teamScore: number;
  levelsCleared: number;
  mistakes: number;
  levelStartedAt: number | null;
  levelEndsAt: number | null;
  lastEvent: string | null;
  finishReason: GameFinishReason | null;
}

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

export const PLACE_SCORE = 25;
export const MISPLACE_PENALTY = 15;
export const LEVEL_CLEAR_SCORE = 250;
export const TIME_BONUS_MAX = 200;
export const UNUSED_PIECE_BONUS = 20;
export const ACCURACY_BONUS_MAX = 150;
export const LEVEL_BREAK_MS = 2_800;

const CHAR_TO_KIND: Record<string, PieceKind> = { A: 'a', B: 'b', S: 'shared' };

export function levelAt(index: number): BuildLevel {
  const level = BUILD_LEVELS[Math.max(0, Math.min(index, BUILD_LEVELS.length - 1))];
  return level ?? (BUILD_LEVELS[0] as BuildLevel);
}

export interface BuiltBlueprint {
  cols: number;
  rows: number;
  blueprint: Array<Array<PieceKind | null>>;
  requiredRotation: number[][];
  counts: Record<PieceKind, number>;
  cellsRequired: number;
}

export function buildBlueprint(level: BuildLevel): BuiltBlueprint {
  const blueprint: Array<Array<PieceKind | null>> = [];
  const requiredRotation: number[][] = [];
  const counts: Record<PieceKind, number> = { a: 0, b: 0, shared: 0 };
  let cellsRequired = 0;

  const width = Math.max(...level.blueprint.map((row) => row.length));

  level.blueprint.forEach((line, y) => {
    const row: Array<PieceKind | null> = [];
    const rotations: number[] = [];
    for (let x = 0; x < width; x += 1) {
      const char = line[x] ?? '.';
      const kind = CHAR_TO_KIND[char] ?? null;
      row.push(kind);
      if (kind) {
        counts[kind] += 1;
        cellsRequired += 1;
        // A deterministic required rotation derived from the cell position, so
        // it is stable for everyone and easy to reason about.
        rotations.push(level.rotationRequired ? ((x + y) % 4) * 90 : 0);
      } else {
        rotations.push(0);
      }
    }
    blueprint.push(row);
    requiredRotation.push(rotations);
  });

  return { cols: width, rows: blueprint.length, blueprint, requiredRotation, counts, cellsRequired };
}

export function blueprintAt(state: BuildState, x: number, y: number): PieceKind | null {
  if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return null;
  return state.blueprint[y]?.[x] ?? null;
}

export function pieceAt(state: BuildState, x: number, y: number): PlacedPiece | undefined {
  return state.placed.find((piece) => piece.x === x && piece.y === y);
}

export function requiredRotationAt(state: BuildState, x: number, y: number): number {
  if (!state.rotationRequired) return 0;
  return state.requiredRotation[y]?.[x] ?? 0;
}

/** A cell counts as correct when kind AND rotation both match the blueprint. */
export function isCellCorrect(state: BuildState, piece: PlacedPiece): boolean {
  const required = blueprintAt(state, piece.x, piece.y);
  if (!required || required !== piece.kind) return false;
  if (state.rotationRequired && piece.rotation !== requiredRotationAt(state, piece.x, piece.y)) return false;
  return true;
}

/** Recomputes progress from the authoritative board. */
export function recount(state: BuildState): void {
  state.cellsCorrect = state.placed.filter((piece) => isCellCorrect(state, piece)).length;
}

/** The server's own completion check — never trusted from a client. */
export function isComplete(state: BuildState): boolean {
  if (state.cellsRequired === 0) return false;
  for (let y = 0; y < state.rows; y += 1) {
    for (let x = 0; x < state.cols; x += 1) {
      const required = blueprintAt(state, x, y);
      const piece = pieceAt(state, x, y);
      if (required === null) {
        if (piece) return false; // stray piece outside the blueprint
        continue;
      }
      if (!piece || !isCellCorrect(state, piece)) return false;
    }
  }
  return true;
}

/** Which kinds this player is allowed to place. */
export function canPlace(role: 'a' | 'b', kind: PieceKind): boolean {
  if (kind === 'shared') return true;
  return kind === role;
}

function activePlayers(state: BuildState): Array<[string, BuildPlayer]> {
  return Object.entries(state.players).filter(([, player]) => !player.left);
}

function makePlayer(role: 'a' | 'b'): BuildPlayer {
  return { role, placed: 0, removed: 0, misplacements: 0, disconnected: false, left: false };
}

export function finishBuild(state: BuildState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.levelEndsAt = null;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

export function loadLevel(state: BuildState, ctx: GameContext): void {
  const level = levelAt(state.level);
  const built = buildBlueprint(level);

  state.levelName = level.name;
  state.hint = level.hint;
  state.cols = built.cols;
  state.rows = built.rows;
  state.blueprint = built.blueprint;
  state.requiredRotation = built.requiredRotation;
  state.rotationRequired = level.rotationRequired;
  state.cellsRequired = built.cellsRequired;
  state.cellsCorrect = 0;
  state.placed = [];
  state.inventory = {
    a: built.counts.a + level.spare,
    b: built.counts.b + level.spare,
    shared: built.counts.shared + level.spare,
  };

  state.phase = 'playing';
  state.levelStartedAt = ctx.now();
  state.levelEndsAt = ctx.now() + level.timeLimit * 1000;
  state.lastEvent = `level:${state.level}`;
  ctx.markStateChanged();

  ctx.schedule(
    level.timeLimit * 1000,
    () => {
      if (state.phase !== 'playing') return;
      state.lastEvent = 'level-timeout';
      finishBuild(state, ctx, 'timeout');
    },
    'turn',
    `level-${state.level}`,
  );

  for (const player of ctx.players) {
    if (player.isAI) ctx.requestAI(player.id, 900);
  }
}

export function completeLevel(state: BuildState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  const level = levelAt(state.level);
  const elapsed = ctx.now() - (state.levelStartedAt ?? ctx.now());
  const limit = level.timeLimit * 1000;

  state.teamScore += LEVEL_CLEAR_SCORE;
  state.teamScore += Math.round(TIME_BONUS_MAX * Math.min(1, Math.max(0, limit - elapsed) / limit));
  // Efficiency: leftover pieces and a clean build both pay.
  const spare = state.inventory.a + state.inventory.b + state.inventory.shared;
  state.teamScore += Math.min(spare, 6) * UNUSED_PIECE_BONUS;
  const totalAttempts = state.cellsRequired + state.mistakes;
  const accuracy = totalAttempts > 0 ? state.cellsRequired / totalAttempts : 1;
  state.teamScore += Math.round(ACCURACY_BONUS_MAX * accuracy);

  state.levelsCleared += 1;
  state.lastEvent = `level-clear:${state.level}`;

  if (state.level + 1 >= state.totalLevels) {
    finishBuild(state, ctx, 'completed');
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

function resolveLevels(config: GameConfig): number {
  if (typeof config.rounds === 'number' && Number.isFinite(config.rounds)) {
    return Math.min(BUILD_TOTAL_LEVELS, Math.max(1, Math.round(config.rounds)));
  }
  return BUILD_TOTAL_LEVELS;
}

function isKind(value: unknown): value is PieceKind {
  return value === 'a' || value === 'b' || value === 'shared';
}

export const buildTogetherGame: GameModule<BuildState> = {
  metadata: BUILD_TOGETHER_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players: readonly GamePlayerView[], config: GameConfig): BuildState {
    const state: BuildState = {
      phase: 'idle',
      level: 0,
      totalLevels: resolveLevels(config),
      levelName: '',
      hint: '',
      cols: 0,
      rows: 0,
      blueprint: [],
      placed: [],
      inventory: { a: 0, b: 0, shared: 0 },
      rotationRequired: false,
      requiredRotation: [],
      players: {},
      cellsRequired: 0,
      cellsCorrect: 0,
      teamScore: 0,
      levelsCleared: 0,
      mistakes: 0,
      levelStartedAt: null,
      levelEndsAt: null,
      lastEvent: null,
      finishReason: null,
    };
    players.forEach((player, index) => {
      const seat = typeof player.seatIndex === 'number' ? player.seatIndex : index;
      state.players[player.id] = makePlayer(seat === 0 ? 'a' : 'b');
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
    state.players[player.id] = makePlayer(seat === 0 ? 'a' : 'b');
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const player = state.players[playerId];
    if (!player) return;
    if (reason === 'disconnect') {
      player.disconnected = true;
      ctx.markStateChanged();
      return;
    }
    player.left = true;
    // A blueprint needs both roles, so one partner leaving ends the run.
    if (activePlayers(state).length < 2) finishBuild(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    state.players = {};
    ctx.players.forEach((player, index) => {
      const seat = typeof player.seatIndex === 'number' ? player.seatIndex : index;
      state.players[player.id] = makePlayer(seat === 0 ? 'a' : 'b');
    });
    state.level = 0;
    state.teamScore = 0;
    state.levelsCleared = 0;
    state.mistakes = 0;
    state.finishReason = null;
    loadLevel(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    if (['score', 'win', 'complete', 'finish', 'build-complete'].includes(action.type)) {
      return { valid: false, reason: 'The server validates the structure.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'No blueprint is live.' };

    const player = state.players[playerId];
    if (!player || player.left) return { valid: false, reason: 'You are not on this build.' };
    if (player.disconnected) return { valid: false, reason: 'Reconnect to keep building.' };

    if (action.type === 'remove') {
      const x = action.payload?.x;
      const y = action.payload?.y;
      if (typeof x !== 'number' || typeof y !== 'number') return { valid: false, reason: 'Pick a cell.' };
      const piece = pieceAt(state, x, y);
      if (!piece) return { valid: false, reason: 'Nothing to remove there.' };
      // You may only pick up pieces you are allowed to hold.
      if (!canPlace(player.role, piece.kind)) return { valid: false, reason: 'That is your partner\u2019s piece.' };
      return { valid: true };
    }

    if (action.type === 'rotate') {
      const x = action.payload?.x;
      const y = action.payload?.y;
      if (typeof x !== 'number' || typeof y !== 'number') return { valid: false, reason: 'Pick a cell.' };
      const piece = pieceAt(state, x, y);
      if (!piece) return { valid: false, reason: 'Nothing to rotate there.' };
      if (!canPlace(player.role, piece.kind)) return { valid: false, reason: 'That is your partner\u2019s piece.' };
      return { valid: true };
    }

    if (action.type !== 'place') return { valid: false, reason: 'Unknown action.' };

    const { x, y, kind, rotation } = (action.payload ?? {}) as {
      x?: unknown;
      y?: unknown;
      kind?: unknown;
      rotation?: unknown;
    };
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y)) {
      return { valid: false, reason: 'Pick a cell.' };
    }
    if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return { valid: false, reason: 'Off the board.' };
    if (!isKind(kind)) return { valid: false, reason: 'Pick a piece.' };
    if (rotation !== undefined && ![0, 90, 180, 270].includes(rotation as number)) {
      return { valid: false, reason: 'Rotation must be 0, 90, 180 or 270.' };
    }
    if (!canPlace(player.role, kind)) return { valid: false, reason: 'Only your partner can place that piece.' };
    if ((state.inventory[kind] ?? 0) <= 0) return { valid: false, reason: 'No pieces of that type left.' };
    if (pieceAt(state, x, y)) return { valid: false, reason: 'That cell is already filled.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (state.phase !== 'playing') return actionRejected('No blueprint is live.');
    const player = state.players[playerId];
    if (!player || player.left || player.disconnected) return actionRejected('You cannot build.');

    /* ---------------- remove ---------------- */
    if (action.type === 'remove') {
      const x = action.payload?.x;
      const y = action.payload?.y;
      if (typeof x !== 'number' || typeof y !== 'number') return actionRejected('Pick a cell.');
      const piece = pieceAt(state, x, y);
      if (!piece) return actionRejected('Nothing to remove there.');
      if (!canPlace(player.role, piece.kind)) return actionRejected('That is your partner\u2019s piece.');

      state.placed = state.placed.filter((entry) => entry !== piece);
      state.inventory[piece.kind] += 1; // the piece returns to the supply
      player.removed += 1;
      recount(state);
      state.lastEvent = `remove:${playerId}`;
      ctx.markStateChanged();
      return actionAccepted();
    }

    /* ---------------- rotate ---------------- */
    if (action.type === 'rotate') {
      const x = action.payload?.x;
      const y = action.payload?.y;
      if (typeof x !== 'number' || typeof y !== 'number') return actionRejected('Pick a cell.');
      const piece = pieceAt(state, x, y);
      if (!piece) return actionRejected('Nothing to rotate there.');
      if (!canPlace(player.role, piece.kind)) return actionRejected('That is your partner\u2019s piece.');

      piece.rotation = (piece.rotation + 90) % 360;
      recount(state);
      state.lastEvent = `rotate:${playerId}`;
      ctx.markStateChanged();
      if (isComplete(state)) completeLevel(state, ctx);
      return actionAccepted();
    }

    /* ---------------- place ---------------- */
    if (action.type !== 'place') return actionRejected('Unknown action.');
    const { x, y, kind, rotation } = (action.payload ?? {}) as {
      x?: unknown;
      y?: unknown;
      kind?: unknown;
      rotation?: unknown;
    };
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isInteger(x) || !Number.isInteger(y)) {
      return actionRejected('Pick a cell.');
    }
    if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return actionRejected('Off the board.');
    if (!isKind(kind)) return actionRejected('Pick a piece.');
    if (rotation !== undefined && ![0, 90, 180, 270].includes(rotation as number)) {
      return actionRejected('Invalid rotation.');
    }
    // Role lock: this is the cooperative constraint.
    if (!canPlace(player.role, kind)) return actionRejected('Only your partner can place that piece.');
    if ((state.inventory[kind] ?? 0) <= 0) return actionRejected('No pieces of that type left.');
    if (pieceAt(state, x, y)) return actionRejected('That cell is already filled.');

    const piece: PlacedPiece = {
      x,
      y,
      kind,
      rotation: typeof rotation === 'number' ? rotation : 0,
      placedBy: playerId,
    };
    state.placed.push(piece);
    state.inventory[kind] -= 1;
    player.placed += 1;

    if (isCellCorrect(state, piece)) {
      state.teamScore += PLACE_SCORE;
      state.lastEvent = `place:${playerId}`;
    } else {
      // A wrong placement still occupies the cell — remove it to try again.
      player.misplacements += 1;
      state.mistakes += 1;
      state.teamScore = Math.max(0, state.teamScore - MISPLACE_PENALTY);
      state.lastEvent = `misplace:${playerId}`;
    }

    recount(state);
    ctx.markStateChanged();

    // Server-side completion check only.
    if (isComplete(state)) completeLevel(state, ctx);
    return actionAccepted();
  },

  update(state, _deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;
    for (const view of ctx.players) {
      if (!view.isAI) continue;
      const player = state.players[view.id];
      if (!player || player.left || player.disconnected) continue;
      const difficulty = view.aiDifficulty ?? 'medium';
      ctx.requestAI(view.id, difficulty === 'hard' ? 500 : difficulty === 'medium' ? 850 : 1_300);
    }
  },

  tick(): void {
    // Handled by update().
  },

  calculateScore(_playerId, state): number {
    return state.teamScore;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    return state.levelsCleared > 0 ? Object.keys(state.players) : [];
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
    const attempts = state.cellsRequired + state.mistakes;
    const accuracy = attempts > 0 ? Math.round((state.cellsRequired / attempts) * 100) : 100;
    const rankings: RankingDraft[] = ctx.players.map((player) => {
      const entry = state.players[player.id];
      return {
        playerId: player.id,
        rank: 1,
        score: state.teamScore,
        isWinner: cleared,
        isDraw: !cleared,
        stats: {
          structuresCompleted: state.levelsCleared,
          accuracy,
          piecesPlaced: entry?.placed ?? 0,
          misplacements: entry?.misplacements ?? 0,
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

  reset(state): BuildState {
    return {
      ...state,
      phase: 'idle',
      level: 0,
      levelName: '',
      hint: '',
      cols: 0,
      rows: 0,
      blueprint: [],
      placed: [],
      inventory: { a: 0, b: 0, shared: 0 },
      rotationRequired: false,
      requiredRotation: [],
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, player]) => [id, makePlayer(player.role)]),
      ),
      cellsRequired: 0,
      cellsCorrect: 0,
      teamScore: 0,
      levelsCleared: 0,
      mistakes: 0,
      levelStartedAt: null,
      levelEndsAt: null,
      lastEvent: null,
      finishReason: null,
    };
  },

  cleanup(state): void {
    state.players = {};
    state.blueprint = [];
    state.placed = [];
    state.phase = 'finished';
  },

  /** The blueprint is shared: both partners see the same target and progress. */
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
      blueprint: state.blueprint,
      requiredRotation: state.rotationRequired ? state.requiredRotation : [],
      rotationRequired: state.rotationRequired,
      placed: state.placed.map((piece) => ({ ...piece })),
      inventory: { ...state.inventory },
      cellsRequired: state.cellsRequired,
      cellsCorrect: state.cellsCorrect,
      teamScore: state.teamScore,
      levelsCleared: state.levelsCleared,
      mistakes: state.mistakes,
      levelEndsAt: state.levelEndsAt,
      lastEvent: state.lastEvent,
      finishReason: state.finishReason,
      serverTime: ctx.now(),
      myRole: me?.role ?? null,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, player]) => [
          id,
          {
            role: player.role,
            placed: player.placed,
            removed: player.removed,
            misplacements: player.misplacements,
            disconnected: player.disconnected,
          },
        ]),
      ),
    };
  },

  /**
   * Co-op AI builder: fills the next empty cell that its own role is allowed
   * to place, with the correct rotation. It never touches its partner's cells.
   */
  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const player = state.players[playerId];
    if (!player || player.left) return null;

    const candidates: Array<{ x: number; y: number; kind: PieceKind }> = [];
    for (let y = 0; y < state.rows; y += 1) {
      for (let x = 0; x < state.cols; x += 1) {
        const required = blueprintAt(state, x, y);
        if (!required) continue;
        if (pieceAt(state, x, y)) continue;
        if (!canPlace(player.role, required)) continue;
        if ((state.inventory[required] ?? 0) <= 0) continue;
        candidates.push({ x, y, kind: required });
      }
    }
    if (candidates.length === 0) return null;

    const target = candidates[0] as { x: number; y: number; kind: PieceKind };
    const correctRotation = requiredRotationAt(state, target.x, target.y);

    // Weaker builders sometimes fumble the rotation — a real, penalised error.
    const fumble = difficulty === 'easy' ? 0.35 : difficulty === 'medium' ? 0.12 : 0.0;
    const rotation =
      state.rotationRequired && ctx.random() < fumble
        ? (correctRotation + 90) % 360
        : correctRotation;

    return { type: 'place', payload: { x: target.x, y: target.y, kind: target.kind, rotation } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 35 * 60 * 1000,
};
