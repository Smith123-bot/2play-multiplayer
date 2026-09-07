import type { GameAction, GameFinishReason } from '@2play/shared';
import { FAKE_DOOR_METADATA } from '@2play/shared';
export { FAKE_DOOR_METADATA };
import type {
  ActionResult,
  GameContext,
  GameModule,
  GameResultDraft,
  RankingDraft,
  ValidationResult,
} from '../GameModule';
import { actionAccepted, actionRejected } from '../GameModule';

/**
 * Fake Door Battle — learnable clues, server-owned correct door.
 */

export type DoorPhase = 'idle' | 'round' | 'reveal' | 'finished';
export type DoorClueKind = 'color' | 'symbol' | 'number' | 'position' | 'memory';

export interface DoorFace {
  id: string;
  color: string;
  symbol: string;
  number: number;
  position: number;
}

export interface DoorPlayer {
  score: number;
  correct: number;
  wrongs: number;
  picked: string | null;
  freezeUntil: number;
  disconnected: boolean;
  left: boolean;
}

export interface DoorState {
  phase: DoorPhase;
  round: number;
  totalRounds: number;
  doors: DoorFace[];
  clue: string;
  clueKind: DoorClueKind;
  correctDoorId: string;
  lastCorrectColor: string | null;
  players: Record<string, DoorPlayer>;
  startedAt: number | null;
  endsAt: number | null;
  roundMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

export const DOOR_COLORS = ['crimson', 'azure', 'lime', 'gold'] as const;
export const DOOR_SYMBOLS = ['star', 'moon', 'sun', 'leaf'] as const;
export const SCORE_CORRECT = 100;
export const SCORE_SPEED = 40;
export const PENALTY_MS = 1_500;
export const ROUND_MS = 8_000;
export const REVEAL_MS = 1_200;
const KINDS: DoorClueKind[] = ['color', 'symbol', 'number', 'position', 'memory'];

export function buildDoorRound(
  rng: () => number,
  round: number,
  lastCorrectColor: string | null,
): { doors: DoorFace[]; clue: string; clueKind: DoorClueKind; correctDoorId: string } {
  const kind = KINDS[round % KINDS.length]!;
  const colors = [...DOOR_COLORS];
  const symbols = [...DOOR_SYMBOLS];
  const doors: DoorFace[] = [0, 1, 2, 3].map((position) => ({
    id: `door-${position}`,
    color: colors[position]!,
    symbol: symbols[position]!,
    number: position + 1,
    position,
  }));

  if (kind === 'color') {
    const target = doors[Math.floor(rng() * doors.length)]!;
    return { doors, clue: `The ${target.color} door is safe.`, clueKind: kind, correctDoorId: target.id };
  }
  if (kind === 'symbol') {
    const target = doors[Math.floor(rng() * doors.length)]!;
    return { doors, clue: `Follow the ${target.symbol}.`, clueKind: kind, correctDoorId: target.id };
  }
  if (kind === 'number') {
    const even = doors.find((door) => door.number % 2 === 0)!;
    return { doors, clue: 'The even-numbered door is safe.', clueKind: kind, correctDoorId: even.id };
  }
  if (kind === 'position') {
    const target = doors[3]!;
    return { doors, clue: 'The far-right door is safe.', clueKind: kind, correctDoorId: target.id };
  }
  const match = lastCorrectColor ? doors.find((door) => door.color === lastCorrectColor) : doors[0]!;
  const target = match ?? doors[0]!;
  return {
    doors,
    clue: lastCorrectColor ? 'The same colour as last round is safe.' : 'Start with the crimson door.',
    clueKind: kind,
    correctDoorId: target.id,
  };
}

function makePlayer(): DoorPlayer {
  return { score: 0, correct: 0, wrongs: 0, picked: null, freezeUntil: 0, disconnected: false, left: false };
}

export function finishDoors(state: DoorState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

export function beginDoorRound(state: DoorState, ctx: GameContext): void {
  const built = buildDoorRound(ctx.random, state.round, state.lastCorrectColor);
  state.doors = built.doors;
  state.clue = built.clue;
  state.clueKind = built.clueKind;
  state.correctDoorId = built.correctDoorId;
  state.phase = 'round';
  state.endsAt = ctx.now() + state.roundMs;
  for (const player of Object.values(state.players)) {
    player.picked = null;
    player.freezeUntil = 0;
  }
  state.lastEvent = 'clue';
  ctx.markStateChanged();
  ctx.schedule(state.roundMs, () => completeDoorRound(state, ctx), 'turn', 'round-timeout');
  for (const player of ctx.players) {
    if (player.isAI) ctx.requestAI(player.id, 200 + Math.floor(ctx.random() * 400));
  }
}

export function completeDoorRound(state: DoorState, ctx: GameContext): void {
  if (state.phase !== 'round') return;
  const correct = state.doors.find((door) => door.id === state.correctDoorId);
  state.lastCorrectColor = correct?.color ?? state.lastCorrectColor;
  state.phase = 'reveal';
  state.lastEvent = 'reveal';
  ctx.markStateChanged();
  ctx.schedule(
    REVEAL_MS,
    () => {
      if (state.phase !== 'reveal') return;
      if (state.round + 1 >= state.totalRounds) {
        finishDoors(state, ctx, 'completed');
        return;
      }
      state.round += 1;
      beginDoorRound(state, ctx);
    },
    'turn',
    'reveal',
  );
}

export const fakeDoorGame: GameModule<DoorState> = {
  metadata: FAKE_DOOR_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players, config): DoorState {
    return {
      phase: 'idle',
      round: 0,
      totalRounds: typeof config.rounds === 'number' ? Math.min(8, Math.max(3, config.rounds)) : 5,
      doors: [],
      clue: '',
      clueKind: 'color',
      correctDoorId: 'door-0',
      lastCorrectColor: null,
      players: Object.fromEntries(players.map((player) => [player.id, makePlayer()])),
      startedAt: null,
      endsAt: null,
      roundMs: ROUND_MS,
      finishReason: null,
      lastEvent: null,
    };
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    state.players[player.id] = makePlayer();
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
    if (remaining.length <= 1) finishDoors(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'round') return;
    ctx.players.forEach((player) => {
      state.players[player.id] = makePlayer();
    });
    state.round = 0;
    state.startedAt = ctx.now();
    beginDoorRound(state, ctx);
    ctx.schedule(state.totalRounds * (ROUND_MS + REVEAL_MS) + 3_000, () => finishDoors(state, ctx, 'timeout'), 'gameDuration', 'match-timeout');
  },

  validateAction(playerId, action, state, ctx): ValidationResult {
    if (action.type === 'score' || action.type === 'solve' || action.type === 'finish') {
      return { valid: false, reason: 'The server owns the correct door.' };
    }
    if (action.type !== 'pick') return { valid: false, reason: 'Unknown action.' };
    if (state.phase !== 'round') return { valid: false, reason: 'Wait for the next clue.' };
    const player = state.players[playerId];
    if (!player || player.left) return { valid: false, reason: 'You are not in this match.' };
    if (player.picked) return { valid: false, reason: 'You already picked this round.' };
    if (ctx.now() < player.freezeUntil) return { valid: false, reason: 'A fake door slowed you down.' };
    const doorId = action.payload?.doorId;
    if (typeof doorId !== 'string' || !state.doors.some((door) => door.id === doorId)) {
      return { valid: false, reason: 'That door is not here.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'pick') return actionRejected('The server owns the correct door.');
    const player = state.players[playerId];
    if (!player || state.phase !== 'round' || player.picked) return actionRejected('You cannot pick.');
    if (ctx.now() < player.freezeUntil) return actionRejected('A fake door slowed you down.');
    const doorId = action.payload?.doorId;
    if (typeof doorId !== 'string' || !state.doors.some((door) => door.id === doorId)) {
      return actionRejected('That door is not here.');
    }
    player.picked = doorId;
    if (doorId === state.correctDoorId) {
      const remain = Math.max(0, (state.endsAt ?? ctx.now()) - ctx.now());
      const gained = SCORE_CORRECT + Math.floor((remain / ROUND_MS) * SCORE_SPEED);
      player.score += gained;
      player.correct += 1;
      state.lastEvent = `correct:${playerId}`;
    } else {
      player.wrongs += 1;
      player.freezeUntil = ctx.now() + PENALTY_MS;
      state.lastEvent = `wrong:${playerId}`;
    }
    ctx.markStateChanged();
    const active = Object.entries(state.players).filter(([, entry]) => !entry.left);
    if (active.length > 0 && active.every(([, entry]) => entry.picked)) completeDoorRound(state, ctx);
    return actionAccepted();
  },

  update(): void {
    // Timer driven.
  },

  tick(): void {
    // Timer driven.
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
  },

  getResult(state, ctx): GameResultDraft {
    const ranked = [...ctx.players].sort((a, b) => (state.players[b.id]?.score ?? 0) - (state.players[a.id]?.score ?? 0));
    const best = ranked[0] ? state.players[ranked[0].id]?.score ?? 0 : 0;
    const winners = ranked.filter((player) => (state.players[player.id]?.score ?? 0) === best).map((player) => player.id);
    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const entry = state.players[player.id];
      return {
        playerId: player.id,
        rank: index + 1,
        score: entry?.score ?? 0,
        isWinner: winners.includes(player.id),
        isDraw: winners.length > 1,
        stats: { correct: entry?.correct ?? 0, wrongs: entry?.wrongs ?? 0 },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): DoorState {
    const ids = Object.keys(state.players);
    return {
      ...state,
      phase: 'idle',
      round: 0,
      doors: [],
      clue: '',
      correctDoorId: 'door-0',
      lastCorrectColor: null,
      players: Object.fromEntries(ids.map((id) => [id, makePlayer()])),
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  cleanup(state): void {
    state.players = {};
    state.phase = 'finished';
  },

  getPublicState(state, viewerId, ctx) {
    const reveal = state.phase === 'reveal' || state.phase === 'finished';
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      clue: state.clue,
      clueKind: state.clueKind,
      doors: state.doors.map((door) => ({ ...door })),
      correctDoorId: reveal ? state.correctDoorId : null,
      endsAt: state.endsAt,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, player]) => [
          id,
          {
            score: player.score,
            correct: player.correct,
            wrongs: player.wrongs,
            picked: player.picked,
            frozen: ctx.now() < player.freezeUntil,
            disconnected: player.disconnected,
          },
        ]),
      ),
      myPick: viewerId ? state.players[viewerId]?.picked ?? null : null,
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'round') return null;
    const player = state.players[playerId];
    if (!player || player.picked || player.left) return null;
    if (difficulty === 'hard' || (difficulty === 'medium' && ctx.random() > 0.25)) {
      return { type: 'pick', payload: { doorId: state.correctDoorId } };
    }
    const door = state.doors[Math.floor(ctx.random() * state.doors.length)]!;
    return { type: 'pick', payload: { doorId: door.id } };
  },

  maxDurationMs: 6 * 60 * 1000,
};
