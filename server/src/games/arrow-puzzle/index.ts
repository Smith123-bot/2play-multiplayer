import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { ARROW_PUZZLE_METADATA } from '@2play/shared';
export { ARROW_PUZZLE_METADATA };
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
import {
  canFire,
  firableTiles,
  generatePuzzle,
  type ArrowBoard,
  type ArrowDifficulty,
  type ArrowTile,
} from './generator';

export * from './generator';

/**
 * Arrow Puzzle — every player races to clear the SAME generated board.
 *
 * Each player owns a private copy of the identical puzzle, so one player's
 * progress never mutates another's board. The server generates the puzzle,
 * validates every fire against its own copy and decides completion — a client
 * can never assert "solved".
 */

export type ArrowPhase = 'idle' | 'playing' | 'finished';

export interface ArrowPlayerState {
  /** This player's own working copy of the shared puzzle. */
  tiles: ArrowTile[];
  cleared: number;
  mistakes: number;
  score: number;
  solved: boolean;
  /** Server timestamp of completion — the tie-breaker. */
  solvedAt: number | null;
  finishRank: number;
  hintsUsed: number;
  disconnected: boolean;
  left: boolean;
}

export interface ArrowState {
  phase: ArrowPhase;
  round: number;
  totalRounds: number;
  difficulty: ArrowDifficulty;
  seed: number;
  cols: number;
  rows: number;
  totalTiles: number;
  /** The shared starting layout (identical for everyone). */
  layout: ArrowTile[];
  players: Record<string, ArrowPlayerState>;
  startedAt: number | null;
  endsAt: number | null;
  roundMs: number;
  finishOrder: string[];
  lastEvent: string | null;
  finishReason: GameFinishReason | null;
  nextAIRequestAt: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

export const ROUND_MS = 120_000;
export const CLEAR_SCORE = 10;
export const MISTAKE_PENALTY = 5;
export const SOLVE_BONUS = 200;
/** Extra points for finishing first, second, ... */
export const PLACE_BONUS = [150, 90, 50, 20];
export const SPEED_BONUS_MAX = 100;
export const HINT_PENALTY = 25;
export const DEFAULT_ROUNDS = 3;

/** Difficulty ramps as the match progresses. */
const ROUND_DIFFICULTY: ArrowDifficulty[] = ['easy', 'medium', 'hard', 'expert', 'expert'];

const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 2600, medium: 1500, hard: 850 };
/** Chance an AI fires a deliberately illegal/suboptimal tile. */
const AI_MISTAKE: Record<AIDifficulty, number> = { easy: 0.3, medium: 0.12, hard: 0.02 };

export function difficultyForRound(round: number): ArrowDifficulty {
  return ROUND_DIFFICULTY[Math.min(round, ROUND_DIFFICULTY.length - 1)] ?? 'medium';
}

function cloneTiles(tiles: ArrowTile[]): ArrowTile[] {
  return tiles.map((tile) => ({ ...tile }));
}

function makePlayer(layout: ArrowTile[]): ArrowPlayerState {
  return {
    tiles: cloneTiles(layout),
    cleared: 0,
    mistakes: 0,
    score: 0,
    solved: false,
    solvedAt: null,
    finishRank: 0,
    hintsUsed: 0,
    disconnected: false,
    left: false,
  };
}

/** Board view used by the generator helpers for a single player. */
function boardFor(state: ArrowState, player: ArrowPlayerState): ArrowBoard {
  return {
    cols: state.cols,
    rows: state.rows,
    tiles: player.tiles,
    difficulty: state.difficulty,
    solution: [],
  };
}

export function finishArrow(state: ArrowState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.endsAt = null;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

/** Builds and starts a round: one puzzle, identical for every player. */
export function beginRound(state: ArrowState, ctx: GameContext): void {
  if (state.phase === 'finished') return;
  const difficulty = difficultyForRound(state.round);
  // Seed derives from the platform PRNG, so puzzles differ per match but are
  // reproducible for a given seed.
  const seed = Math.floor(ctx.random() * 0x7fffffff) ^ ((state.round + 1) * 0x9e3779b1);
  const puzzle = generatePuzzle(seed >>> 0, difficulty);

  state.difficulty = difficulty;
  state.seed = seed >>> 0;
  state.cols = puzzle.cols;
  state.rows = puzzle.rows;
  state.totalTiles = puzzle.tiles.length;
  state.layout = cloneTiles(puzzle.tiles);
  state.finishOrder = [];
  state.startedAt = ctx.now();
  state.endsAt = ctx.now() + state.roundMs;
  state.phase = 'playing';
  state.lastEvent = `round:${state.round}`;

  for (const player of Object.values(state.players)) {
    player.tiles = cloneTiles(puzzle.tiles);
    player.cleared = 0;
    player.mistakes = 0;
    player.solved = false;
    player.solvedAt = null;
    player.finishRank = 0;
    player.hintsUsed = 0;
  }
  state.nextAIRequestAt = {};
  ctx.markStateChanged();

  ctx.schedule(state.roundMs, () => endRound(state, ctx), 'turn', `round-${state.round}`);
  for (const player of ctx.players) {
    if (player.isAI) ctx.requestAI(player.id, 900);
  }
}

export function endRound(state: ArrowState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  if (state.round + 1 >= state.totalRounds) {
    finishArrow(state, ctx, 'completed');
    return;
  }
  state.round += 1;
  state.lastEvent = `round-end:${state.round}`;
  beginRound(state, ctx);
}

/** Ends the round early once everyone still playing has solved it. */
function maybeEndRound(state: ArrowState, ctx: GameContext): void {
  const contenders = Object.values(state.players).filter((player) => !player.left && !player.disconnected);
  if (contenders.length > 0 && contenders.every((player) => player.solved)) endRound(state, ctx);
}

/* ------------------------------------------------------------------ */
/* Module                                                              */
/* ------------------------------------------------------------------ */

function resolveRounds(config: GameConfig): number {
  if (typeof config.rounds === 'number' && Number.isFinite(config.rounds)) {
    return Math.min(5, Math.max(1, Math.round(config.rounds)));
  }
  return DEFAULT_ROUNDS;
}

export const arrowPuzzleGame: GameModule<ArrowState> = {
  metadata: ARROW_PUZZLE_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players: readonly GamePlayerView[], config: GameConfig): ArrowState {
    const state: ArrowState = {
      phase: 'idle',
      round: 0,
      totalRounds: resolveRounds(config),
      difficulty: 'easy',
      seed: 0,
      cols: 0,
      rows: 0,
      totalTiles: 0,
      layout: [],
      players: {},
      startedAt: null,
      endsAt: null,
      roundMs: ROUND_MS,
      finishOrder: [],
      lastEvent: null,
      finishReason: null,
      nextAIRequestAt: {},
    };
    for (const player of players) state.players[player.id] = makePlayer([]);
    return state;
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    // A late joiner gets the current shared layout, not a different puzzle.
    state.players[player.id] = makePlayer(state.layout);
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const player = state.players[playerId];
    if (!player) return;
    if (reason === 'disconnect') {
      player.disconnected = true;
      return;
    }
    player.left = true;
    const remaining = Object.values(state.players).filter((entry) => !entry.left);
    if (remaining.length === 0) finishArrow(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    state.players = {};
    for (const player of ctx.players) state.players[player.id] = makePlayer([]);
    state.round = 0;
    state.finishReason = null;
    beginRound(state, ctx);
  },

  validateAction(playerId, action, state): ValidationResult {
    // A client may never declare the puzzle solved or set its own score.
    if (['solved', 'complete', 'score', 'win', 'finish'].includes(action.type)) {
      return { valid: false, reason: 'The server decides completion.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'No puzzle is live.' };

    const player = state.players[playerId];
    if (!player || player.left) return { valid: false, reason: 'You are not in this match.' };
    if (player.disconnected) return { valid: false, reason: 'Reconnect to keep playing.' };
    if (player.solved) return { valid: false, reason: 'You already solved this board.' };

    if (action.type === 'hint') return { valid: true };
    if (action.type !== 'fire') return { valid: false, reason: 'Unknown action.' };

    const tileId = action.payload?.tileId;
    if (typeof tileId !== 'string') return { valid: false, reason: 'Pick an arrow.' };
    const tile = player.tiles.find((entry) => entry.id === tileId);
    if (!tile) return { valid: false, reason: 'No such arrow.' };
    if (tile.cleared) return { valid: false, reason: 'That arrow is already gone.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (state.phase !== 'playing') return actionRejected('No puzzle is live.');
    const player = state.players[playerId];
    if (!player || player.left || player.disconnected) return actionRejected('You cannot act.');
    if (player.solved) return actionRejected('Already solved.');

    /* ---------------- hint ---------------- */
    if (action.type === 'hint') {
      const options = firableTiles(boardFor(state, player));
      if (options.length === 0) return actionRejected('No arrow can be fired right now.');
      player.hintsUsed += 1;
      player.score = Math.max(0, player.score - HINT_PENALTY);
      state.lastEvent = `hint:${playerId}:${options[0]!.id}`;
      ctx.markStateChanged();
      return actionAccepted();
    }

    if (action.type !== 'fire') return actionRejected('Unknown action.');
    const tileId = action.payload?.tileId;
    if (typeof tileId !== 'string') return actionRejected('Pick an arrow.');

    const tile = player.tiles.find((entry) => entry.id === tileId);
    if (!tile || tile.cleared) return actionRejected('That arrow is not on the board.');

    // The server re-derives legality from its own copy of the board.
    if (!canFire(boardFor(state, player), tileId)) {
      player.mistakes += 1;
      player.score = Math.max(0, player.score - MISTAKE_PENALTY);
      state.lastEvent = `blocked:${playerId}`;
      ctx.markStateChanged();
      return actionRejected('That arrow is blocked.');
    }

    tile.cleared = true;
    player.cleared += 1;
    player.score += CLEAR_SCORE;
    state.lastEvent = `clear:${playerId}`;

    // Completion is determined here, never announced by the client.
    if (player.tiles.every((entry) => entry.cleared)) {
      player.solved = true;
      player.solvedAt = ctx.now();
      state.finishOrder.push(playerId);
      player.finishRank = state.finishOrder.length;
      player.score += SOLVE_BONUS;
      player.score += PLACE_BONUS[player.finishRank - 1] ?? 0;
      const remainingMs = Math.max(0, (state.endsAt ?? ctx.now()) - ctx.now());
      player.score += Math.round(SPEED_BONUS_MAX * Math.min(1, remainingMs / state.roundMs));
      state.lastEvent = `solved:${playerId}`;
      ctx.markStateChanged();
      maybeEndRound(state, ctx);
      return actionAccepted();
    }

    ctx.markStateChanged();
    return actionAccepted();
  },

  update(state, _deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;
    const now = ctx.now();
    for (const view of ctx.players) {
      if (!view.isAI) continue;
      const player = state.players[view.id];
      if (!player || player.left || player.solved) continue;
      const difficulty = view.aiDifficulty ?? 'medium';
      if (now >= (state.nextAIRequestAt[view.id] ?? 0)) {
        ctx.requestAI(view.id, 40);
        state.nextAIRequestAt[view.id] = now + AI_INTERVAL[difficulty];
      }
    }
  },

  tick(): void {
    // Handled by update().
  },

  calculateScore(playerId, state): number {
    return state.players[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const entries = Object.entries(state.players).filter(([, player]) => !player.left);
    if (entries.length === 0) return [];
    const best = Math.max(...entries.map(([, player]) => player.score));
    return entries.filter(([, player]) => player.score === best).map(([id]) => id);
  },

  checkDrawCondition(state): boolean {
    return (this.checkWinCondition(state)?.length ?? 0) > 1;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
    state.endsAt = null;
  },

  getResult(state, ctx): GameResultDraft {
    const ranked = [...ctx.players].sort((a, b) => {
      const left = state.players[a.id];
      const right = state.players[b.id];
      const byScore = (right?.score ?? 0) - (left?.score ?? 0);
      if (byScore !== 0) return byScore;
      // Tie-break on completion time (earlier wins).
      const leftAt = left?.solvedAt ?? Number.POSITIVE_INFINITY;
      const rightAt = right?.solvedAt ?? Number.POSITIVE_INFINITY;
      return leftAt - rightAt;
    });
    const best = ranked.length > 0 ? state.players[ranked[0]?.id ?? '']?.score ?? 0 : 0;
    const winners = ranked
      .filter((player) => (state.players[player.id]?.score ?? 0) === best)
      .map((player) => player.id);
    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const entry = state.players[player.id];
      return {
        playerId: player.id,
        rank: index + 1,
        score: entry?.score ?? 0,
        isWinner: winners.includes(player.id),
        isDraw: winners.length > 1,
        stats: {
          cleared: entry?.cleared ?? 0,
          mistakes: entry?.mistakes ?? 0,
          hints: entry?.hintsUsed ?? 0,
        },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): ArrowState {
    return {
      ...state,
      phase: 'idle',
      round: 0,
      difficulty: 'easy',
      seed: 0,
      cols: 0,
      rows: 0,
      totalTiles: 0,
      layout: [],
      players: Object.fromEntries(Object.keys(state.players).map((id) => [id, makePlayer([])])),
      startedAt: null,
      endsAt: null,
      finishOrder: [],
      lastEvent: null,
      finishReason: null,
      nextAIRequestAt: {},
    };
  },

  cleanup(state): void {
    state.players = {};
    state.layout = [];
    state.phase = 'finished';
  },

  /**
   * Everyone gets the same puzzle, so the board itself is public — but a
   * player only ever receives THEIR OWN tile progress. Opponents are reduced to
   * a progress count, so nobody can read another player's solution path.
   */
  getPublicState(state, viewerId, ctx) {
    const me = viewerId ? state.players[viewerId] : undefined;
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      difficulty: state.difficulty,
      cols: state.cols,
      rows: state.rows,
      totalTiles: state.totalTiles,
      endsAt: state.endsAt,
      roundMs: state.roundMs,
      finishOrder: [...state.finishOrder],
      lastEvent: state.lastEvent,
      finishReason: state.finishReason,
      serverTime: ctx.now(),
      // The viewer's own board, including which arrows are currently firable.
      board: me
        ? me.tiles.map((tile) => ({
            id: tile.id,
            x: tile.x,
            y: tile.y,
            direction: tile.direction,
            cleared: tile.cleared,
            firable: !tile.cleared && canFire(boardFor(state, me), tile.id),
          }))
        : [],
      me: me
        ? {
            cleared: me.cleared,
            mistakes: me.mistakes,
            score: me.score,
            solved: me.solved,
            hintsUsed: me.hintsUsed,
            finishRank: me.finishRank,
          }
        : null,
      // Opponents: progress only, never their board layout.
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, player]) => [
          id,
          {
            cleared: player.cleared,
            total: state.totalTiles,
            score: player.score,
            solved: player.solved,
            finishRank: player.finishRank,
            mistakes: player.mistakes,
            disconnected: player.disconnected,
          },
        ]),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const player = state.players[playerId];
    if (!player || player.left || player.solved) return null;

    const options = firableTiles(boardFor(state, player));
    if (options.length === 0) return null;

    // Weaker bots sometimes stab at a blocked arrow (a real, penalised mistake).
    if (ctx.random() < AI_MISTAKE[difficulty]) {
      const blocked = player.tiles.filter(
        (tile) => !tile.cleared && !canFire(boardFor(state, player), tile.id),
      );
      const pick = blocked[Math.floor(ctx.random() * blocked.length)];
      if (pick) return { type: 'fire', payload: { tileId: pick.id } };
    }

    const chosen = options[Math.floor(ctx.random() * options.length)] ?? options[0];
    return chosen ? { type: 'fire', payload: { tileId: chosen.id } } : null;
  },

  needsUpdateLoop: true,
  maxDurationMs: 15 * 60 * 1000,
};
