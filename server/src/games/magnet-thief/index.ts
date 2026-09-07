import type { GameAction, GameFinishReason } from '@2play/shared';
import { MAGNET_THIEF_METADATA } from '@2play/shared';
export { MAGNET_THIEF_METADATA };
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
 * Magnet Thief — range, cooldown, attraction, steal, and ownership are server-owned.
 */

export type MagnetPhase = 'idle' | 'playing' | 'finished';

export interface MagnetGem {
  id: string;
  x: number;
  y: number;
  ownerId: string | null;
  value: number;
}

export interface MagnetPlayer {
  x: number;
  y: number;
  score: number;
  stolen: number;
  lastPullAt: number;
  carrying: string[];
  disconnected: boolean;
  left: boolean;
}

export interface MagnetState {
  phase: MagnetPhase;
  gems: MagnetGem[];
  players: Record<string, MagnetPlayer>;
  startedAt: number | null;
  endsAt: number | null;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

export const MAGNET_W = 18;
export const MAGNET_H = 12;
export const MAGNET_RANGE = 3;
export const MAGNET_COOLDOWN = 2_000;
export const MOVE_STEP = 0.45;
export const MATCH_MS = 60_000;
export const SAFE_CORNERS: Array<{ x: number; y: number }> = [
  { x: 1.2, y: 1.2 },
  { x: MAGNET_W - 1.2, y: 1.2 },
  { x: 1.2, y: MAGNET_H - 1.2 },
  { x: MAGNET_W - 1.2, y: MAGNET_H - 1.2 },
];

export function inSafeCorner(x: number, y: number): boolean {
  return SAFE_CORNERS.some((corner) => Math.hypot(x - corner.x, y - corner.y) <= 1.6);
}

export function spawnGems(count: number): MagnetGem[] {
  const gems: MagnetGem[] = [];
  const used = new Set<string>();
  let i = 0;
  while (gems.length < count && i < 80) {
    i += 1;
    const x = 3 + ((gems.length * 3.1) % (MAGNET_W - 6));
    const y = 2.5 + ((gems.length * 2.4) % (MAGNET_H - 5));
    const key = `${Math.round(x)}:${Math.round(y)}`;
    if (used.has(key) || inSafeCorner(x, y)) continue;
    used.add(key);
    gems.push({ id: `gem-${gems.length}`, x, y, ownerId: null, value: 10 + (gems.length % 3) * 5 });
  }
  return gems;
}

function makePlayer(index: number): MagnetPlayer {
  const spawn = SAFE_CORNERS[index % SAFE_CORNERS.length]!;
  return {
    x: spawn.x,
    y: spawn.y,
    score: 0,
    stolen: 0,
    lastPullAt: -MAGNET_COOLDOWN,
    carrying: [],
    disconnected: false,
    left: false,
  };
}

export function finishMagnet(state: MagnetState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

export function tryMagnetMove(player: MagnetPlayer, dx: number, dy: number): void {
  player.x = Math.max(0.4, Math.min(MAGNET_W - 0.4, player.x + dx * MOVE_STEP));
  player.y = Math.max(0.4, Math.min(MAGNET_H - 0.4, player.y + dy * MOVE_STEP));
}

export function pullGems(playerId: string, state: MagnetState, ctx: GameContext): { ok: boolean; reason?: string } {
  const player = state.players[playerId];
  if (!player || player.left || state.phase !== 'playing') return { ok: false, reason: 'You cannot pull.' };
  if (ctx.now() - player.lastPullAt < MAGNET_COOLDOWN) return { ok: false, reason: 'Magnet is cooling down.' };
  player.lastPullAt = ctx.now();
  let stole = 0;
  for (const gem of state.gems) {
    const dist = Math.hypot(gem.x - player.x, gem.y - player.y);
    if (dist > MAGNET_RANGE) continue;
    if (gem.ownerId === playerId) continue;
    if (gem.ownerId) {
      const owner = state.players[gem.ownerId];
      if (owner && inSafeCorner(owner.x, owner.y)) continue;
      if (owner) {
        owner.carrying = owner.carrying.filter((id) => id !== gem.id);
        owner.score = Math.max(0, owner.score - gem.value);
      }
      player.stolen += 1;
      stole += 1;
    }
    gem.ownerId = playerId;
    gem.x = player.x;
    gem.y = player.y;
    if (!player.carrying.includes(gem.id)) player.carrying.push(gem.id);
    player.score += gem.value;
  }
  state.lastEvent = stole > 0 ? `steal:${playerId}` : `pull:${playerId}`;
  ctx.markStateChanged();
  return { ok: true };
}

export const magnetThiefGame: GameModule<MagnetState> = {
  metadata: MAGNET_THIEF_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players): MagnetState {
    return {
      phase: 'idle',
      gems: spawnGems(8),
      players: Object.fromEntries(players.map((player, index) => [player.id, makePlayer(index)])),
      startedAt: null,
      endsAt: null,
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
    state.players[player.id] = makePlayer(Object.keys(state.players).length);
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
    for (const gem of state.gems) {
      if (gem.ownerId === playerId) gem.ownerId = null;
    }
    player.carrying = [];
    const remaining = Object.values(state.players).filter((entry) => !entry.left);
    if (remaining.length <= 1) finishMagnet(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    ctx.players.forEach((player, index) => {
      state.players[player.id] = makePlayer(index);
    });
    state.gems = spawnGems(8);
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = ctx.now() + MATCH_MS;
    state.lastEvent = 'start';
    ctx.markStateChanged();
    ctx.schedule(MATCH_MS, () => finishMagnet(state, ctx, 'timeout'), 'gameDuration', 'match-timeout');
    for (const player of ctx.players) {
      if (player.isAI) ctx.requestAI(player.id, 280);
    }
  },

  validateAction(playerId, action, state, ctx): ValidationResult {
    if (action.type === 'score' || action.type === 'grant' || action.type === 'own') {
      return { valid: false, reason: 'The server owns magnets and gems.' };
    }
    const player = state.players[playerId];
    if (!player || player.left) return { valid: false, reason: 'You are not in this match.' };
    if (state.phase !== 'playing') return { valid: false, reason: 'Magnets are offline.' };
    if (action.type === 'move') {
      const dx = action.payload?.dx;
      const dy = action.payload?.dy;
      if (typeof dx !== 'number' || typeof dy !== 'number') return { valid: false, reason: 'Need a direction.' };
      if (Math.abs(dx) > 1.05 || Math.abs(dy) > 1.05) return { valid: false, reason: 'Move too large.' };
      return { valid: true };
    }
    if (action.type === 'pull') {
      if (ctx.now() - player.lastPullAt < MAGNET_COOLDOWN) return { valid: false, reason: 'Magnet is cooling down.' };
      return { valid: true };
    }
    return { valid: false, reason: 'Unknown action.' };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    const player = state.players[playerId];
    if (!player || state.phase !== 'playing') return actionRejected('Magnets are offline.');
    if (action.type === 'move') {
      const dx = typeof action.payload?.dx === 'number' ? action.payload.dx : 0;
      const dy = typeof action.payload?.dy === 'number' ? action.payload.dy : 0;
      tryMagnetMove(player, dx, dy);
      for (const gem of state.gems) {
        if (gem.ownerId === playerId) {
          gem.x = player.x;
          gem.y = player.y;
        }
      }
      ctx.markStateChanged();
      return actionAccepted();
    }
    if (action.type === 'pull') {
      const result = pullGems(playerId, state, ctx);
      return result.ok ? actionAccepted() : actionRejected(result.reason ?? 'You cannot pull.');
    }
    return actionRejected('The server owns magnets and gems.');
  },

  update(state, _delta, ctx): void {
    if (state.phase !== 'playing') return;
    for (const player of ctx.players) {
      if (player.isAI && !state.players[player.id]?.left) ctx.requestAI(player.id, 240);
    }
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
        stats: { stolen: entry?.stolen ?? 0, carrying: entry?.carrying.length ?? 0 },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): MagnetState {
    const ids = Object.keys(state.players);
    return {
      ...state,
      phase: 'idle',
      gems: spawnGems(8),
      players: Object.fromEntries(ids.map((id, index) => [id, makePlayer(index)])),
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  cleanup(state): void {
    state.players = {};
    state.gems = [];
    state.phase = 'finished';
  },

  getPublicState(state, viewerId, ctx) {
    return {
      phase: state.phase,
      gems: state.gems.map((gem) => ({ ...gem })),
      endsAt: state.endsAt,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      width: MAGNET_W,
      height: MAGNET_H,
      range: MAGNET_RANGE,
      cooldown: MAGNET_COOLDOWN,
      safeCorners: SAFE_CORNERS,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, player]) => [
          id,
          {
            x: player.x,
            y: player.y,
            score: player.score,
            stolen: player.stolen,
            carrying: player.carrying.length,
            cooldownLeft: Math.max(0, MAGNET_COOLDOWN - (ctx.now() - player.lastPullAt)),
            inSafe: inSafeCorner(player.x, player.y),
            disconnected: player.disconnected,
          },
        ]),
      ),
      myCarrying: viewerId ? state.players[viewerId]?.carrying ?? [] : [],
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const player = state.players[playerId];
    if (!player || player.left) return null;
    const target =
      state.gems.find((gem) => gem.ownerId !== playerId && Math.hypot(gem.x - player.x, gem.y - player.y) <= MAGNET_RANGE + 2) ??
      state.gems.find((gem) => gem.ownerId !== playerId);
    if (!target) return { type: 'move', payload: { dx: 0, dy: 0 } };
    const dist = Math.hypot(target.x - player.x, target.y - player.y);
    if (dist <= MAGNET_RANGE && ctx.now() - player.lastPullAt >= MAGNET_COOLDOWN) {
      if (difficulty === 'easy' && ctx.random() < 0.4) {
        return { type: 'move', payload: { dx: Math.sign(ctx.random() - 0.5), dy: Math.sign(ctx.random() - 0.5) } };
      }
      return { type: 'pull', payload: {} };
    }
    return { type: 'move', payload: { dx: Math.sign(target.x - player.x), dy: Math.sign(target.y - player.y) } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 6 * 60 * 1000,
};
