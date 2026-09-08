import type { AIDifficulty, GameFinishReason } from '@2play/shared';
import { LUDO_METADATA } from '@2play/shared';
import type { ActionResult, GameContext, GameModule, GameResultDraft, ValidationResult } from '../GameModule';
import { actionAccepted, actionRejected } from '../GameModule';

export type LudoPhase = 'idle' | 'playing' | 'finished';
export interface LudoToken { progress: number; }
export interface LudoPlayer { color: number; tokens: LudoToken[]; score: number; finished: boolean; disconnected: boolean; left: boolean; }
export interface LudoState {
  phase: LudoPhase; players: Record<string, LudoPlayer>; currentPlayerId: string | null;
  dice: number | null; canRoll: boolean; turnEndsAt: number | null; winnerId: string | null;
  lastEvent: string | null; startedAt: number | null; finishReason: GameFinishReason | null;
}

export const TURN_MS = 15_000;
export const TRACK_LENGTH = 52;
export const HOME_PROGRESS = 56;
export const LUDO_SAFE_CELLS = [0, 8, 13, 21, 26, 34, 39, 47] as const;
const COLORS = ['red', 'blue', 'green', 'yellow'];
const START_OFFSETS = [0, 13, 26, 39];

function playerAt(state: LudoState, id: string) { return state.players[id]; }
function activeIds(state: LudoState) { return Object.keys(state.players).filter((id) => !state.players[id]!.left); }
function routeCell(player: LudoPlayer, token: LudoToken): number | null {
  if (token.progress < 0 || token.progress >= TRACK_LENGTH) return null;
  return (START_OFFSETS[player.color] + token.progress) % TRACK_LENGTH;
}
function canMove(token: LudoToken, roll: number): boolean { return token.progress < HOME_PROGRESS && (token.progress >= 0 || roll === 6); }
function nextPlayer(state: LudoState, from: string): string | null {
  const ids = activeIds(state); const index = ids.indexOf(from);
  return ids.length ? ids[(index + 1 + ids.length) % ids.length]! : null;
}
function finishGame(state: LudoState, ctx: GameContext, reason: GameFinishReason, winnerId: string | null = null) {
  if (state.phase === 'finished') return;
  state.phase = 'finished'; state.finishReason = reason; state.winnerId = winnerId;
  state.canRoll = false; state.turnEndsAt = null; state.lastEvent = winnerId ? `winner:${winnerId}` : reason;
  ctx.markStateChanged(); ctx.finish(reason);
}
function startTurn(state: LudoState, ctx: GameContext, id: string | null) {
  state.currentPlayerId = id; state.dice = null; state.canRoll = Boolean(id); state.turnEndsAt = id ? ctx.now() + TURN_MS : null;
  if (id) {
    ctx.schedule(TURN_MS, () => {
      if (state.phase !== 'playing' || state.currentPlayerId !== id) return;
      state.lastEvent = `timeout:${id}`; startTurn(state, ctx, nextPlayer(state, id)); ctx.markStateChanged();
    }, 'turn', 'ludo-turn');
    if (ctx.players.some((player) => player.id === id && player.isAI)) ctx.requestAI(id, 400);
  }
}

export const ludoGame: GameModule<LudoState> = {
  metadata: LUDO_METADATA,
  initialize(): void {},
  createInitialState(players): LudoState {
    return { phase: 'idle', players: Object.fromEntries(players.map((p, i) => [p.id, { color: i % 4, tokens: Array.from({ length: 4 }, () => ({ progress: -1 })), score: 0, finished: false, disconnected: false, left: false }])), currentPlayerId: null, dice: null, canRoll: false, turnEndsAt: null, winnerId: null, lastEvent: null, startedAt: null, finishReason: null };
  },
  playerJoined(player, state): void { state.players[player.id] ??= { color: Object.keys(state.players).length % 4, tokens: Array.from({ length: 4 }, () => ({ progress: -1 })), score: 0, finished: false, disconnected: false, left: false }; state.players[player.id]!.disconnected = false; },
  playerReady(): void {},
  playerLeft(id, state, ctx, reason): void { const p = state.players[id]; if (!p) return; if (reason === 'disconnect') p.disconnected = true; else { p.left = true; if (state.currentPlayerId === id) startTurn(state, ctx, nextPlayer(state, id)); if (activeIds(state).length < 2 && state.phase === 'playing') finishGame(state, ctx, 'abandoned'); } },
  start(state, ctx): void { if (state.phase === 'playing') return; state.phase = 'playing'; state.startedAt = ctx.now(); state.finishReason = null; state.winnerId = null; startTurn(state, ctx, activeIds(state)[0] ?? null); ctx.markStateChanged(); for (const p of ctx.players) if (p.isAI) ctx.requestAI(p.id, 500); },
  validateAction(id, action, state): ValidationResult {
    const p = playerAt(state, id);
    if (state.phase !== 'playing' || !p || p.left || p.disconnected) return { valid: false, reason: 'The match is not accepting actions.' };
    if (action.type === 'roll-dice') { if (state.currentPlayerId !== id || !state.canRoll || state.dice !== null) return { valid: false, reason: 'It is not your roll.' }; return { valid: true }; }
    if (action.type === 'move-token') { const index = action.payload?.tokenIndex; if (state.currentPlayerId !== id || state.dice === null || typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 3) return { valid: false, reason: 'That token cannot move now.' }; if (!canMove(p.tokens[index]!, state.dice)) return { valid: false, reason: 'That token cannot make this move.' }; if (p.tokens[index]!.progress + state.dice > HOME_PROGRESS) return { valid: false, reason: 'An exact roll is required.' }; return { valid: true }; }
    return { valid: false, reason: 'Unknown Ludo action.' };
  },
  handlePlayerAction(id, action, state, ctx): ActionResult {
    const p = state.players[id]!;
    if (action.type === 'roll-dice') { const roll = 1 + Math.floor(ctx.random() * 6); state.dice = roll; state.canRoll = false; state.lastEvent = `roll:${id}:${roll}`; if (!p.tokens.some((t) => canMove(t, roll))) { state.lastEvent = `no-move:${id}`; startTurn(state, ctx, roll === 6 ? id : nextPlayer(state, id)); } ctx.markStateChanged(); return actionAccepted(); }
    if (action.type !== 'move-token' || state.dice === null) return actionRejected('Roll first.');
    const index = action.payload?.tokenIndex as number; const token = p.tokens[index]!; const roll = state.dice;
    token.progress = token.progress < 0 ? 0 : token.progress + roll; p.score += token.progress === HOME_PROGRESS ? 100 : 10;
    const cell = routeCell(p, token);
    if (cell !== null && !LUDO_SAFE_CELLS.includes(cell as (typeof LUDO_SAFE_CELLS)[number])) for (const [otherId, other] of Object.entries(state.players)) if (otherId !== id && !other.left) for (const enemy of other.tokens) if (routeCell(other, enemy) === cell) { enemy.progress = -1; p.score += 25; state.lastEvent = `capture:${id}`; }
    if (p.tokens.every((t) => t.progress === HOME_PROGRESS)) { p.finished = true; finishGame(state, ctx, 'completed', id); return actionAccepted(); }
    state.lastEvent = `move:${id}:${index}`; startTurn(state, ctx, roll === 6 ? id : nextPlayer(state, id)); ctx.markStateChanged(); return actionAccepted();
  },
  update(): void {}, tick(): void {},
  calculateScore(id, state) { return state.players[id]?.score ?? 0; },
  checkWinCondition(state) { return state.winnerId ? [state.winnerId] : null; },
  checkDrawCondition(): boolean { return false; }, isGameFinished(state) { return state.phase === 'finished'; },
  finish(state) { state.phase = 'finished'; state.canRoll = false; },
  getResult(state, ctx): GameResultDraft { const rankings = ctx.players.map((p, i) => ({ playerId: p.id, rank: i + 1, score: state.players[p.id]?.score ?? 0, isWinner: p.id === state.winnerId, isDraw: false, stats: { captures: Math.floor((state.players[p.id]?.score ?? 0) / 25) } })).sort((a, b) => b.score - a.score).map((r, i) => ({ ...r, rank: i + 1 })); return { winners: state.winnerId ? [state.winnerId] : rankings[0] ? [rankings[0].playerId] : [], isDraw: false, rankings, reason: state.finishReason ?? 'completed' }; },
  reset(state) { const ids = Object.keys(state.players); return ludoGame.createInitialState(ids.map((id) => ({ id, nickname: '', avatar: '', isAI: false, aiDifficulty: null, isConnected: true, seatIndex: state.players[id]!.color, isHost: false })), { playerCount: ids.length, humanCount: ids.length, aiOpponents: 0, aiDifficulty: 'medium' }); },
  cleanup(state) { state.players = {}; },
  getPublicState(state, viewerId, ctx) { return { ...state, players: Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, { ...p, tokens: p.tokens.map((t) => ({ ...t })), color: COLORS[p.color] }])), safeCells: LUDO_SAFE_CELLS, serverTime: ctx.now(), viewerId }; },
  getAIMove(id, _difficulty: AIDifficulty, state) { if (state.currentPlayerId !== id) return null; if (state.dice === null) return { type: 'roll-dice' }; const p = state.players[id]; const index = p?.tokens.findIndex((t) => canMove(t, state.dice!)); return index !== undefined && index >= 0 ? { type: 'move-token', payload: { tokenIndex: index } } : null; },
  maxDurationMs: 20 * 60 * 1000,
};
