import type { AIDifficulty, GameFinishReason } from '@2play/shared';
import { BLACK_BLAST_METADATA } from '@2play/shared';
import type { ActionResult, GameContext, GameModule, GameResultDraft, ValidationResult } from '../GameModule';
import { actionAccepted, actionRejected } from '../GameModule';

export interface Blast { id: number; ownerId: string; x: number; y: number; radius: number; expiresAt: number; }
export interface BlastObject { id: number; x: number; y: number; value: number; active: boolean; }
export interface BlastPlayer { x: number; y: number; score: number; combo: number; lastBlastAt: number; disconnected: boolean; left: boolean; }
export interface BlackBlastState { phase: 'idle' | 'playing' | 'finished'; width: number; height: number; players: Record<string, BlastPlayer>; objects: BlastObject[]; blasts: Blast[]; nextBlastId: number; endsAt: number | null; winnerId: string | null; finishReason: GameFinishReason | null; lastEvent: string | null; }

export const BLAST_DURATION_MS = 900;
export const BLAST_COOLDOWN_MS = 1200;
export const BLAST_MATCH_MS = 150_000;
const STARTS = [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 10, y: 90 }, { x: 90, y: 90 }];
const COLORS = ['#f87171', '#60a5fa', '#4ade80', '#facc15'];
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
function finish(state: BlackBlastState, ctx: GameContext, reason: GameFinishReason) { if (state.phase === 'finished') return; state.phase = 'finished'; state.finishReason = reason; state.endsAt = null; const active = Object.entries(state.players).filter(([, p]) => !p.left); state.winnerId = active.sort((a, b) => b[1].score - a[1].score)[0]?.[0] ?? null; ctx.markStateChanged(); ctx.finish(reason); }
function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }
function makeObjects(seed: number): BlastObject[] { let value = seed >>> 0 || 7; const random = () => { value = (value * 1103515245 + 12345) >>> 0; return value / 4294967296; }; return Array.from({ length: 18 }, (_, id) => ({ id, x: 15 + random() * 70, y: 15 + random() * 70, value: 10 + Math.floor(random() * 21), active: true })); }
function legalMove(state: BlackBlastState, id: string, dx: number, dy: number) { const p = state.players[id]; if (!p || Math.abs(dx) > 1 || Math.abs(dy) > 1) return false; const nx = p.x + dx * 4, ny = p.y + dy * 4; return nx >= 5 && nx <= 95 && ny >= 5 && ny <= 95; }

export const blackBlastGame: GameModule<BlackBlastState> = {
  metadata: BLACK_BLAST_METADATA,
  initialize(): void {},
  createInitialState(players, config): BlackBlastState { return { phase: 'idle', width: 100, height: 100, players: Object.fromEntries(players.map((p, i) => { const s = STARTS[i % STARTS.length]!; return [p.id, { x: s.x, y: s.y, score: 0, combo: 0, lastBlastAt: -Infinity, disconnected: false, left: false }]; })), objects: makeObjects(config.seed ?? 7), blasts: [], nextBlastId: 1, endsAt: null, winnerId: null, finishReason: null, lastEvent: null }; },
  playerJoined(player, state): void { const s = STARTS[Object.keys(state.players).length % STARTS.length]!; state.players[player.id] ??= { x: s.x, y: s.y, score: 0, combo: 0, lastBlastAt: -Infinity, disconnected: false, left: false }; state.players[player.id]!.disconnected = false; },
  playerReady(): void {},
  playerLeft(id, state, ctx, reason): void { const p = state.players[id]; if (!p) return; if (reason === 'disconnect') p.disconnected = true; else { p.left = true; if (Object.values(state.players).filter((x) => !x.left).length < 2 && state.phase === 'playing') finish(state, ctx, 'abandoned'); } },
  start(state, ctx): void { if (state.phase === 'playing') return; state.objects = makeObjects(ctx.seed); state.phase = 'playing'; state.endsAt = ctx.now() + BLAST_MATCH_MS; ctx.schedule(BLAST_MATCH_MS, () => finish(state, ctx, 'timeout'), 'gameDuration', 'black-blast-match'); ctx.markStateChanged(); for (const player of ctx.players) if (player.isAI) ctx.requestAI(player.id, 500); },
  validateAction(id, action, state, ctx): ValidationResult { const p = state.players[id]; if (state.phase !== 'playing' || !p || p.left || p.disconnected) return { valid: false, reason: 'Arena is not accepting actions.' }; if (action.type === 'move') { const dx = action.payload?.dx, dy = action.payload?.dy; if (typeof dx !== 'number' || typeof dy !== 'number' || !Number.isInteger(dx) || !Number.isInteger(dy) || !legalMove(state, id, dx, dy)) return { valid: false, reason: 'Invalid movement.' }; return { valid: true }; } if (action.type === 'blast') { if (ctx.now() < p.lastBlastAt + BLAST_COOLDOWN_MS) return { valid: false, reason: 'Blast is cooling down.' }; return { valid: true }; } return { valid: false, reason: 'Unknown arena action.' }; },
  handlePlayerAction(id, action, state, ctx): ActionResult { const p = state.players[id]!; if (action.type === 'move') { p.x = clamp(p.x + (action.payload?.dx as number) * 4, 5, 95); p.y = clamp(p.y + (action.payload?.dy as number) * 4, 5, 95); state.lastEvent = `move:${id}`; ctx.markStateChanged(); return actionAccepted(); } if (action.type !== 'blast') return actionRejected('Invalid action.'); const now = ctx.now(); p.lastBlastAt = now; const blast: Blast = { id: state.nextBlastId++, ownerId: id, x: p.x, y: p.y, radius: 7, expiresAt: now + BLAST_DURATION_MS }; state.blasts.push(blast); let reactions = 0; for (const object of state.objects) if (object.active && dist(blast, object) <= blast.radius) { object.active = false; p.score += object.value; reactions += 1; } if (reactions > 0) { p.combo += 1; p.score += p.combo * 5; state.lastEvent = `chain:${id}:${reactions}`; } else p.combo = 0; ctx.markStateChanged(); return actionAccepted(); },
  update(state, _delta, ctx): void { if (state.phase !== 'playing') return; const now = ctx.now(); state.blasts = state.blasts.filter((blast) => blast.expiresAt > now); for (const player of ctx.players) { const p = state.players[player.id]; if (!player.isAI || !p || p.left) continue; if (now >= p.lastBlastAt + BLAST_COOLDOWN_MS) ctx.requestAI(player.id, 60); } }, tick(): void {},
  calculateScore(id, state) { return state.players[id]?.score ?? 0; }, checkWinCondition(state) { return state.winnerId ? [state.winnerId] : null; }, checkDrawCondition(): boolean { return false; }, isGameFinished(state) { return state.phase === 'finished'; }, finish(state) { state.phase = 'finished'; },
  getResult(state, ctx): GameResultDraft { const rankings = ctx.players.map((p) => ({ playerId: p.id, rank: 0, score: state.players[p.id]?.score ?? 0, isWinner: p.id === state.winnerId, isDraw: false, stats: { combo: state.players[p.id]?.combo ?? 0 } })).sort((a, b) => b.score - a.score).map((p, i) => ({ ...p, rank: i + 1 })); return { winners: state.winnerId ? [state.winnerId] : rankings[0] ? [rankings[0].playerId] : [], isDraw: false, rankings, reason: state.finishReason ?? 'completed' }; },
  reset(state) { return blackBlastGame.createInitialState(Object.keys(state.players).map((id, i) => ({ id, nickname: '', avatar: '', isAI: false, aiDifficulty: null, isConnected: true, seatIndex: i, isHost: false })), { playerCount: Object.keys(state.players).length, humanCount: Object.keys(state.players).length, aiOpponents: 0, aiDifficulty: 'medium', seed: Date.now() }); },
  cleanup(state) { state.players = {}; state.blasts = []; state.objects = []; },
  getPublicState(state, _viewerId, ctx) { return { ...state, players: Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, { ...p, color: COLORS[p.x % COLORS.length] }])), objects: state.objects.filter((o) => o.active).map((o) => ({ ...o })), blasts: state.blasts.map((b) => ({ ...b })), serverTime: ctx.now() }; },
  getAIMove(id, _difficulty: AIDifficulty, state, ctx) { const p = state.players[id]; if (!p) return null; const target = state.objects.find((o) => o.active); if (target && ctx.now() >= p.lastBlastAt + BLAST_COOLDOWN_MS && dist(p, target) < 12) return { type: 'blast' }; const dx = target && target.x > p.x ? 1 : -1; const dy = target && target.y > p.y ? 1 : -1; return { type: 'move', payload: { dx, dy } }; },
  needsUpdateLoop: true,
  maxDurationMs: 4 * 60 * 1000,
};
