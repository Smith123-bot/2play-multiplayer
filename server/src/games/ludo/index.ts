import type { AIDifficulty, GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { LUDO_METADATA } from '@2play/shared';
export { LUDO_METADATA };
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
  BOARD_SIZE,
  colorForSeat,
  FINISH_DISTANCE,
  HOME_ENTRY_INDEX,
  HOME_STRETCH_CELLS,
  HOME_STRETCH_LENGTH,
  isSafeIndex,
  LUDO_COLORS,
  SAFE_INDICES,
  START_INDEX,
  TOKENS_PER_PLAYER,
  TRACK_CELLS,
  TRACK_LENGTH,
  trackIndexFor,
  YARD_CELLS,
  type LudoColor,
} from './board';

export * from './board';

/**
 * Ludo — classic turn-based board game, fully server authoritative.
 *
 * The server owns the dice, the legal move set, captures and the winner. The
 * client may only ask to roll or to move a specific token; every other decision
 * is made here.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type LudoPhase = 'idle' | 'awaiting-roll' | 'awaiting-move' | 'finished';

/**
 * A token is described by how far it has walked from its own starting square.
 *  - `progress === -1`     → still in the yard
 *  - `0..51`               → on the shared track
 *  - `52..56`              → in its private home stretch
 *  - `progress === 57`     → home (FINISH_DISTANCE)
 */
export interface LudoToken {
  id: string;
  seatIndex: number;
  progress: number;
}

export interface LudoPlayerSlot {
  seatIndex: number;
  color: LudoColor;
  tokens: LudoToken[];
  finishedTokens: number;
  /** Match ranking position once every token is home (1-based, 0 = still playing). */
  rank: number;
  captures: number;
  sixes: number;
  score: number;
  disconnected: boolean;
  left: boolean;
}

export interface LudoLegalMove {
  tokenId: string;
  from: number;
  to: number;
  /** Track cell that would be captured, if any. */
  capturesTokenId: string | null;
  entersBoard: boolean;
  reachesHome: boolean;
}

/**
 * The most recent roll of the match. Unlike `dice` — which only describes the
 * roll the current player still has to act on and is cleared the moment the
 * turn passes — this survives the turn switch so every client can show what was
 * just rolled. Without it a roll that has no legal move is invisible: the
 * server clears `dice` and passes the turn in the same update, so the player
 * who pressed "Roll dice" never receives the number they rolled.
 */
export interface LudoLastRoll {
  playerId: string;
  value: number;
  /** False when the roll had no legal move and the turn passed immediately. */
  playable: boolean;
}

export interface LudoState {
  phase: LudoPhase;
  turnOrder: string[];
  currentPlayerId: string | null;
  dice: number | null;
  /** Display-only record of the last roll (kept across turns). */
  lastRoll: LudoLastRoll | null;
  /** Consecutive sixes by the current player (three in a row forfeits the turn). */
  consecutiveSixes: number;
  legalMoves: LudoLegalMove[];
  players: Record<string, LudoPlayerSlot>;
  turnEndsAt: number | null;
  turnMs: number;
  /** Tokens each player must bring home to finish. */
  tokensToWin: number;
  finishedOrder: string[];
  lastEvent: string | null;
  lastMove: { playerId: string; tokenId: string; from: number; to: number; captured: string | null } | null;
  finishReason: GameFinishReason | null;
  rollsThisMatch: number;
}

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

export const TURN_MS = 20_000;
export const MAX_CONSECUTIVE_SIXES = 3;
export const CAPTURE_SCORE = 50;
export const HOME_SCORE = 100;
export const FINISH_BONUS = 150;
/** Points per cell advanced — rewards steady progress. */
export const STEP_SCORE = 1;

const AI_DELAY: Record<AIDifficulty, number> = { easy: 900, medium: 550, hard: 300 };

/* ------------------------------------------------------------------ */
/* Pure rules (exported for tests)                                     */
/* ------------------------------------------------------------------ */

export function isInYard(token: LudoToken): boolean {
  return token.progress < 0;
}

export function isHome(token: LudoToken): boolean {
  return token.progress >= FINISH_DISTANCE;
}

export function isOnTrack(token: LudoToken): boolean {
  return token.progress >= 0 && token.progress < TRACK_LENGTH;
}

export function isInHomeStretch(token: LudoToken): boolean {
  return token.progress >= TRACK_LENGTH && token.progress < FINISH_DISTANCE;
}

/** Absolute shared-track cell a token occupies, or null when off-track. */
export function absoluteCell(token: LudoToken): number | null {
  if (!isOnTrack(token)) return null;
  return trackIndexFor(token.seatIndex, token.progress);
}

/** Rolls a die using the platform's seeded PRNG. Never client supplied. */
export function rollDie(random: () => number): number {
  return 1 + Math.floor(random() * 6);
}

function allTokens(state: LudoState): LudoToken[] {
  return Object.values(state.players).flatMap((slot) => slot.tokens);
}

/**
 * A cell is blocked when two or more tokens of *another* seat sit on it
 * (a classic "block"). Own tokens may always stack.
 */
export function isBlockedFor(state: LudoState, seatIndex: number, cell: number): boolean {
  const occupants = allTokens(state).filter(
    (token) => token.seatIndex !== seatIndex && absoluteCell(token) === cell,
  );
  return occupants.length >= 2;
}

/**
 * Every legal move for `playerId` given `dice`. This is the single source of
 * truth: the client renders it and the server validates against it.
 */
export function computeLegalMoves(state: LudoState, playerId: string, dice: number): LudoLegalMove[] {
  const slot = state.players[playerId];
  if (!slot || dice < 1 || dice > 6) return [];
  const moves: LudoLegalMove[] = [];

  for (const token of slot.tokens) {
    if (isHome(token)) continue;

    // Leaving the yard requires a six and a free starting square.
    if (isInYard(token)) {
      if (dice !== 6) continue;
      const startCell = trackIndexFor(slot.seatIndex, 0);
      if (isBlockedFor(state, slot.seatIndex, startCell)) continue;
      moves.push({
        tokenId: token.id,
        from: token.progress,
        to: 0,
        capturesTokenId: captureAt(state, slot.seatIndex, startCell),
        entersBoard: true,
        reachesHome: false,
      });
      continue;
    }

    const target = token.progress + dice;
    // Exact roll required to enter the final home cell.
    if (target > FINISH_DISTANCE) continue;

    // Path into / inside the home stretch is private and never blocked.
    if (target >= TRACK_LENGTH) {
      moves.push({
        tokenId: token.id,
        from: token.progress,
        to: target,
        capturesTokenId: null,
        entersBoard: false,
        reachesHome: target === FINISH_DISTANCE,
      });
      continue;
    }

    const targetCell = trackIndexFor(slot.seatIndex, target);
    if (isBlockedFor(state, slot.seatIndex, targetCell)) continue;
    moves.push({
      tokenId: token.id,
      from: token.progress,
      to: target,
      capturesTokenId: captureAt(state, slot.seatIndex, targetCell),
      entersBoard: false,
      reachesHome: false,
    });
  }
  return moves;
}

/**
 * Which opposing token (if any) would be sent home by landing on `cell`.
 * Safe cells and blocks protect their occupants.
 */
export function captureAt(state: LudoState, seatIndex: number, cell: number): string | null {
  if (isSafeIndex(cell)) return null;
  const enemies = allTokens(state).filter(
    (token) => token.seatIndex !== seatIndex && absoluteCell(token) === cell,
  );
  if (enemies.length !== 1) return null; // 0 = empty, 2+ = protected block
  return enemies[0]?.id ?? null;
}

function findToken(state: LudoState, tokenId: string): LudoToken | undefined {
  return allTokens(state).find((token) => token.id === tokenId);
}

/** Seats still competing (not finished, not departed). */
function activeSeats(state: LudoState, ctx: GameContext): string[] {
  return state.turnOrder.filter((id) => {
    const slot = state.players[id];
    if (!slot || slot.left) return false;
    if (slot.finishedTokens >= state.tokensToWin) return false;
    const view = ctx.players.find((entry) => entry.id === id);
    return Boolean(view) && (view!.isAI || view!.isConnected || slot.disconnected);
  });
}

export function finishLudo(state: LudoState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.currentPlayerId = null;
  state.dice = null;
  state.legalMoves = [];
  state.turnEndsAt = null;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

/**
 * Hands the turn to `playerId` and arms the server-authoritative turn timer.
 * A missed turn is skipped automatically so a match can never stall.
 */
export function beginTurn(state: LudoState, ctx: GameContext, playerId: string): void {
  if (state.phase === 'finished') return;
  state.currentPlayerId = playerId;
  state.phase = 'awaiting-roll';
  state.dice = null;
  state.legalMoves = [];
  state.consecutiveSixes = 0;
  state.turnEndsAt = ctx.now() + state.turnMs;
  ctx.markStateChanged();

  ctx.schedule(
    state.turnMs,
    () => {
      if (state.phase === 'finished') return;
      if (state.currentPlayerId !== playerId) return;
      state.lastEvent = `timeout:${playerId}`;
      advanceTurn(state, ctx);
    },
    'turn',
    'turn-timeout',
  );

  const view = ctx.players.find((entry) => entry.id === playerId);
  if (view?.isAI) ctx.requestAI(playerId, AI_DELAY[view.aiDifficulty ?? 'medium']);
}

/** Moves play to the next eligible seat, or finishes the match. */
export function advanceTurn(state: LudoState, ctx: GameContext): void {
  if (state.phase === 'finished') return;
  const seats = activeSeats(state, ctx);
  if (seats.length === 0) {
    finishLudo(state, ctx, state.finishedOrder.length > 0 ? 'completed' : 'abandoned');
    return;
  }
  // A single remaining competitor ends the match (everyone else finished/left).
  if (seats.length === 1 && state.finishedOrder.length > 0) {
    finishLudo(state, ctx, 'completed');
    return;
  }
  const current = state.currentPlayerId;
  const index = current ? state.turnOrder.indexOf(current) : -1;
  for (let hop = 1; hop <= state.turnOrder.length; hop += 1) {
    const candidate = state.turnOrder[(index + hop) % state.turnOrder.length];
    if (candidate && seats.includes(candidate)) {
      beginTurn(state, ctx, candidate);
      return;
    }
  }
  finishLudo(state, ctx, 'completed');
}

/** Same player rolls again (after a six or a capture or reaching home). */
function repeatTurn(state: LudoState, ctx: GameContext, playerId: string): void {
  state.phase = 'awaiting-roll';
  state.dice = null;
  state.legalMoves = [];
  state.turnEndsAt = ctx.now() + state.turnMs;
  ctx.markStateChanged();
  ctx.schedule(
    state.turnMs,
    () => {
      if (state.phase === 'finished') return;
      if (state.currentPlayerId !== playerId) return;
      state.lastEvent = `timeout:${playerId}`;
      advanceTurn(state, ctx);
    },
    'turn',
    'turn-timeout',
  );
  const view = ctx.players.find((entry) => entry.id === playerId);
  if (view?.isAI) ctx.requestAI(playerId, AI_DELAY[view.aiDifficulty ?? 'medium']);
}

function makeSlot(seatIndex: number): LudoPlayerSlot {
  return {
    seatIndex,
    color: colorForSeat(seatIndex),
    tokens: Array.from({ length: TOKENS_PER_PLAYER }, (_unused, index) => ({
      id: `${colorForSeat(seatIndex)}-${index}`,
      seatIndex,
      progress: -1,
    })),
    finishedTokens: 0,
    rank: 0,
    captures: 0,
    sixes: 0,
    score: 0,
    disconnected: false,
    left: false,
  };
}

function resolveTokensToWin(config: GameConfig): number {
  const raw = typeof config.rounds === 'number' ? Math.round(config.rounds) : TOKENS_PER_PLAYER;
  return Math.min(TOKENS_PER_PLAYER, Math.max(1, raw));
}

/* ------------------------------------------------------------------ */
/* AI                                                                  */
/* ------------------------------------------------------------------ */

/** Scores a candidate move; higher is better. Used by medium/hard bots. */
function rateMove(state: LudoState, move: LudoLegalMove, seatIndex: number): number {
  let value = move.to * STEP_SCORE;
  if (move.reachesHome) value += 1000;
  if (move.capturesTokenId) value += 600;
  if (move.entersBoard) value += 300;
  // Prefer ending on a safe cell.
  if (move.to < TRACK_LENGTH) {
    const cell = trackIndexFor(seatIndex, move.to);
    if (isSafeIndex(cell)) value += 120;
    // Penalise stopping right in front of an enemy token.
    const threatened = allTokens(state).some((token) => {
      if (token.seatIndex === seatIndex) return false;
      const enemyCell = absoluteCell(token);
      if (enemyCell === null) return false;
      const gap = (cell - enemyCell + TRACK_LENGTH) % TRACK_LENGTH;
      return gap >= 1 && gap <= 6;
    });
    if (threatened && !isSafeIndex(cell)) value -= 150;
  } else {
    value += 200; // inside the private lane is always safe
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* Module                                                              */
/* ------------------------------------------------------------------ */

export const ludoGame: GameModule<LudoState> = {
  metadata: LUDO_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players: readonly GamePlayerView[], config: GameConfig): LudoState {
    const state: LudoState = {
      phase: 'idle',
      turnOrder: players.map((player) => player.id),
      currentPlayerId: null,
      dice: null,
      lastRoll: null,
      consecutiveSixes: 0,
      legalMoves: [],
      players: {},
      turnEndsAt: null,
      turnMs: TURN_MS,
      tokensToWin: resolveTokensToWin(config),
      finishedOrder: [],
      lastEvent: null,
      lastMove: null,
      finishReason: null,
      rollsThisMatch: 0,
    };
    players.forEach((player, index) => {
      state.players[player.id] = makeSlot(typeof player.seatIndex === 'number' ? player.seatIndex : index);
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
    state.players[player.id] = makeSlot(seat);
    if (!state.turnOrder.includes(player.id)) state.turnOrder.push(player.id);
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const slot = state.players[playerId];
    if (!slot) return;
    if (reason === 'disconnect') {
      // Seat is preserved for the 120s grace window; turns are skipped meanwhile.
      slot.disconnected = true;
      if (state.currentPlayerId === playerId && state.phase !== 'finished') {
        state.lastEvent = `disconnect-skip:${playerId}`;
        advanceTurn(state, ctx);
      }
      return;
    }
    slot.left = true;
    // Departed tokens leave the board so they cannot block or be captured.
    for (const token of slot.tokens) token.progress = -1;
    const remaining = Object.values(state.players).filter((entry) => !entry.left);
    if (remaining.length <= 1) {
      finishLudo(state, ctx, 'abandoned');
      return;
    }
    if (state.currentPlayerId === playerId && state.phase !== 'finished') advanceTurn(state, ctx);
  },

  start(state, ctx): void {
    if (state.phase !== 'idle' && state.phase !== 'finished') return;
    state.players = {};
    state.turnOrder = ctx.players.map((player) => player.id);
    ctx.players.forEach((player, index) => {
      state.players[player.id] = makeSlot(typeof player.seatIndex === 'number' ? player.seatIndex : index);
    });
    state.finishedOrder = [];
    state.finishReason = null;
    state.rollsThisMatch = 0;
    state.lastMove = null;
    state.phase = 'awaiting-roll';
    state.lastEvent = 'start';
    const first = state.turnOrder[0];
    if (!first) {
      finishLudo(state, ctx, 'abandoned');
      return;
    }
    beginTurn(state, ctx, first);
  },

  validateAction(playerId, action, state, ctx): ValidationResult {
    // Outcome-asserting actions are never accepted from a client.
    if (['score', 'win', 'finish', 'dice', 'setDice', 'complete', 'capture'].includes(action.type)) {
      return { valid: false, reason: 'The server owns the dice and the result.' };
    }
    if (state.phase === 'finished') return { valid: false, reason: 'The match is over.' };
    if (state.phase === 'idle') return { valid: false, reason: 'The match has not started.' };

    const slot = state.players[playerId];
    if (!slot || slot.left) return { valid: false, reason: 'You are not in this match.' };
    if (state.currentPlayerId !== playerId) return { valid: false, reason: 'It is not your turn.' };
    if (slot.disconnected) return { valid: false, reason: 'Reconnect to keep playing.' };

    if (action.type === 'roll') {
      if (state.phase !== 'awaiting-roll') return { valid: false, reason: 'You already rolled.' };
      return { valid: true };
    }

    if (action.type === 'move') {
      if (state.phase !== 'awaiting-move') return { valid: false, reason: 'Roll the dice first.' };
      const tokenId = action.payload?.tokenId;
      if (typeof tokenId !== 'string') return { valid: false, reason: 'Pick a token.' };
      const legal = state.legalMoves.some((move) => move.tokenId === tokenId);
      if (!legal) return { valid: false, reason: 'That token cannot make that move.' };
      // Guard against a token id belonging to another seat.
      const token = findToken(state, tokenId);
      if (!token || token.seatIndex !== slot.seatIndex) return { valid: false, reason: 'That is not your token.' };
      return { valid: true };
    }

    void ctx;
    return { valid: false, reason: 'Unknown action.' };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    const slot = state.players[playerId];
    if (!slot || state.currentPlayerId !== playerId || state.phase === 'finished') {
      return actionRejected('Not your turn.');
    }

    /* ---------------- roll ---------------- */
    if (action.type === 'roll') {
      if (state.phase !== 'awaiting-roll') return actionRejected('You already rolled.');
      const dice = rollDie(ctx.random);
      state.dice = dice;
      state.rollsThisMatch += 1;
      if (dice === 6) {
        slot.sixes += 1;
        state.consecutiveSixes += 1;
      } else {
        state.consecutiveSixes = 0;
      }
      state.lastEvent = `roll:${playerId}:${dice}`;
      // Publish the number immediately so it survives a turn that passes below.
      state.lastRoll = { playerId, value: dice, playable: false };

      // Three sixes in a row forfeits the turn (classic anti-stall rule).
      if (state.consecutiveSixes >= MAX_CONSECUTIVE_SIXES) {
        state.lastEvent = `triple-six:${playerId}`;
        state.dice = null;
        advanceTurn(state, ctx);
        return actionAccepted();
      }

      const moves = computeLegalMoves(state, playerId, dice);
      state.lastRoll = { playerId, value: dice, playable: moves.length > 0 };
      state.legalMoves = moves;
      if (moves.length === 0) {
        // Nothing playable: a six still earns another roll, otherwise pass on.
        state.lastEvent = `no-moves:${playerId}`;
        if (dice === 6) repeatTurn(state, ctx, playerId);
        else advanceTurn(state, ctx);
        return actionAccepted();
      }
      state.phase = 'awaiting-move';
      ctx.markStateChanged();
      if (ctx.players.find((entry) => entry.id === playerId)?.isAI) {
        ctx.requestAI(playerId, AI_DELAY[ctx.players.find((e) => e.id === playerId)?.aiDifficulty ?? 'medium']);
      }
      return actionAccepted();
    }

    /* ---------------- move ---------------- */
    if (action.type !== 'move') return actionRejected('Unknown action.');
    if (state.phase !== 'awaiting-move') return actionRejected('Roll the dice first.');

    const tokenId = action.payload?.tokenId;
    if (typeof tokenId !== 'string') return actionRejected('Pick a token.');
    const move = state.legalMoves.find((candidate) => candidate.tokenId === tokenId);
    if (!move) return actionRejected('Illegal move.');
    const token = findToken(state, tokenId);
    if (!token || token.seatIndex !== slot.seatIndex) return actionRejected('That is not your token.');

    const dice = state.dice ?? 0;
    const advanced = move.to - Math.max(0, move.from);
    token.progress = move.to;
    if (advanced > 0) slot.score += advanced * STEP_SCORE;

    // Capture is recomputed from the authoritative board, not trusted from the move.
    let captured: string | null = null;
    if (move.to < TRACK_LENGTH) {
      const cell = trackIndexFor(slot.seatIndex, move.to);
      const victimId = captureAt(state, slot.seatIndex, cell);
      if (victimId) {
        const victim = findToken(state, victimId);
        if (victim) {
          victim.progress = -1;
          captured = victimId;
          slot.captures += 1;
          slot.score += CAPTURE_SCORE;
        }
      }
    }

    let reachedHome = false;
    if (token.progress >= FINISH_DISTANCE) {
      slot.finishedTokens += 1;
      slot.score += HOME_SCORE;
      reachedHome = true;
    }

    state.lastMove = { playerId, tokenId, from: move.from, to: move.to, captured };
    state.lastEvent = captured
      ? `capture:${playerId}`
      : reachedHome
        ? `home:${playerId}`
        : `move:${playerId}`;
    state.dice = null;
    state.legalMoves = [];
    ctx.markStateChanged();

    // Did this player just finish?
    if (slot.finishedTokens >= state.tokensToWin && !state.finishedOrder.includes(playerId)) {
      state.finishedOrder.push(playerId);
      slot.rank = state.finishedOrder.length;
      slot.score += Math.max(0, FINISH_BONUS - (slot.rank - 1) * 50);
      state.lastEvent = `finished:${playerId}`;
      const stillPlaying = activeSeats(state, ctx);
      if (stillPlaying.length <= 1) {
        finishLudo(state, ctx, 'completed');
        return actionAccepted();
      }
      advanceTurn(state, ctx);
      return actionAccepted();
    }

    // A six, a capture or bringing a token home earns another roll.
    if (dice === 6 || captured || reachedHome) repeatTurn(state, ctx, playerId);
    else advanceTurn(state, ctx);
    return actionAccepted();
  },

  update(): void {
    // Turn based: everything is driven by actions and the turn timer.
  },

  tick(): void {
    // Not used.
  },

  calculateScore(playerId, state): number {
    return state.players[playerId]?.score ?? 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    if (state.finishedOrder.length > 0) return [state.finishedOrder[0] as string];
    const entries = Object.entries(state.players).filter(([, slot]) => !slot.left);
    if (entries.length === 0) return [];
    const best = Math.max(...entries.map(([, slot]) => slot.score));
    return entries.filter(([, slot]) => slot.score === best).map(([id]) => id);
  },

  checkDrawCondition(state): boolean {
    if (state.finishedOrder.length > 0) return false;
    return (this.checkWinCondition(state)?.length ?? 0) > 1;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
    state.currentPlayerId = null;
    state.turnEndsAt = null;
    state.legalMoves = [];
  },

  getResult(state, ctx): GameResultDraft {
    const ranked = [...ctx.players].sort((a, b) => {
      const left = state.players[a.id];
      const right = state.players[b.id];
      // Players who brought tokens home rank first, in finishing order.
      const leftRank = left?.rank ?? 0;
      const rightRank = right?.rank ?? 0;
      if (leftRank !== rightRank) {
        if (leftRank === 0) return 1;
        if (rightRank === 0) return -1;
        return leftRank - rightRank;
      }
      const byTokens = (right?.finishedTokens ?? 0) - (left?.finishedTokens ?? 0);
      if (byTokens !== 0) return byTokens;
      return (right?.score ?? 0) - (left?.score ?? 0);
    });

    const winners = state.finishedOrder.length > 0
      ? [state.finishedOrder[0] as string]
      : ranked.length > 0
        ? [ranked[0]!.id]
        : [];

    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const slot = state.players[player.id];
      return {
        playerId: player.id,
        rank: index + 1,
        score: slot?.score ?? 0,
        isWinner: winners.includes(player.id),
        isDraw: false,
        stats: {
          tokensHome: slot?.finishedTokens ?? 0,
          captures: slot?.captures ?? 0,
          sixes: slot?.sixes ?? 0,
        },
      };
    });

    return {
      winners,
      isDraw: false,
      rankings,
      reason: state.finishReason ?? 'completed',
    };
  },

  reset(state): LudoState {
    const seats = Object.entries(state.players).map(([id, slot]) => [id, slot.seatIndex] as const);
    return {
      ...state,
      phase: 'idle',
      currentPlayerId: null,
      dice: null,
      lastRoll: null,
      consecutiveSixes: 0,
      legalMoves: [],
      players: Object.fromEntries(seats.map(([id, seat]) => [id, makeSlot(seat)])),
      turnEndsAt: null,
      finishedOrder: [],
      lastEvent: null,
      lastMove: null,
      finishReason: null,
      rollsThisMatch: 0,
    };
  },

  cleanup(state): void {
    state.players = {};
    state.legalMoves = [];
    state.turnOrder = [];
    state.phase = 'finished';
  },

  /**
   * Ludo is a game of perfect information: the board is public. The only thing
   * withheld is anything that would let a client pre-empt the server — the RNG
   * itself is never exposed, and legal moves are only sent to the player whose
   * turn it is.
   */
  getPublicState(state, viewerId, ctx) {
    const isCurrent = Boolean(viewerId) && viewerId === state.currentPlayerId;
    return {
      phase: state.phase,
      currentPlayerId: state.currentPlayerId,
      dice: state.dice,
      lastRoll: state.lastRoll ? { ...state.lastRoll } : null,
      consecutiveSixes: state.consecutiveSixes,
      // Only the active player receives the playable move list.
      legalMoves: isCurrent ? state.legalMoves.map((move) => ({ ...move })) : [],
      turnOrder: [...state.turnOrder],
      turnEndsAt: state.turnEndsAt,
      tokensToWin: state.tokensToWin,
      finishedOrder: [...state.finishedOrder],
      lastEvent: state.lastEvent,
      lastMove: state.lastMove ? { ...state.lastMove } : null,
      finishReason: state.finishReason,
      serverTime: ctx.now(),
      boardSize: BOARD_SIZE,
      trackCells: TRACK_CELLS,
      safeIndices: SAFE_INDICES,
      homeStretchCells: HOME_STRETCH_CELLS,
      yardCells: YARD_CELLS,
      startIndex: START_INDEX,
      homeEntryIndex: HOME_ENTRY_INDEX,
      trackLength: TRACK_LENGTH,
      homeStretchLength: HOME_STRETCH_LENGTH,
      finishDistance: FINISH_DISTANCE,
      colors: LUDO_COLORS,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, slot]) => [
          id,
          {
            seatIndex: slot.seatIndex,
            color: slot.color,
            score: slot.score,
            captures: slot.captures,
            finishedTokens: slot.finishedTokens,
            rank: slot.rank,
            disconnected: slot.disconnected,
            left: slot.left,
            tokens: slot.tokens.map((token) => ({
              id: token.id,
              progress: token.progress,
              cell: absoluteCell(token),
              seatIndex: token.seatIndex,
            })),
          },
        ]),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase === 'finished') return null;
    if (state.currentPlayerId !== playerId) return null;
    if (state.phase === 'awaiting-roll') return { type: 'roll' };
    if (state.phase !== 'awaiting-move') return null;

    const moves = state.legalMoves;
    if (moves.length === 0) return null;
    const slot = state.players[playerId];
    if (!slot) return null;

    // Easy bots pick at random; medium/hard use the heuristic.
    if (difficulty === 'easy') {
      const pick = moves[Math.floor(ctx.random() * moves.length)];
      return pick ? { type: 'move', payload: { tokenId: pick.tokenId } } : null;
    }
    if (difficulty === 'medium' && ctx.random() < 0.25) {
      const pick = moves[Math.floor(ctx.random() * moves.length)];
      return pick ? { type: 'move', payload: { tokenId: pick.tokenId } } : null;
    }

    let best = moves[0]!;
    let bestValue = rateMove(state, best, slot.seatIndex);
    for (const move of moves.slice(1)) {
      const value = rateMove(state, move, slot.seatIndex);
      if (value > bestValue) {
        best = move;
        bestValue = value;
      }
    }
    return { type: 'move', payload: { tokenId: best.tokenId } };
  },

  maxDurationMs: 25 * 60 * 1000,
};
