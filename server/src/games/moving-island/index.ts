import type { GameAction, GameFinishReason } from '@2play/shared';
import { MOVING_ISLAND_METADATA } from '@2play/shared';
export { MOVING_ISLAND_METADATA };
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
 * Moving Island — server-owned platforms, checkpoints, no instant elim.
 */

export type IslandPhase = 'idle' | 'playing' | 'finished';
export type PlatformKind = 'static' | 'horiz' | 'vert' | 'blink' | 'spin';

export interface IslandPlatform {
  id: string;
  kind: PlatformKind;
  x: number;
  y: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
  visible: boolean;
}

export interface IslandPlayer {
  x: number;
  y: number;
  checkpoint: number;
  score: number;
  fallen: number;
  finished: boolean;
  disconnected: boolean;
  left: boolean;
}

export interface IslandState {
  phase: IslandPhase;
  platforms: IslandPlatform[];
  players: Record<string, IslandPlayer>;
  checkpoints: Array<{ x: number; y: number }>;
  finish: { x: number; y: number };
  startedAt: number | null;
  endsAt: number | null;
  lastTick: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  nextAIRequestAt: Record<string, number>;
}

export const ISLAND_W = 32;
export const ISLAND_H = 22;
export const MOVE_STEP = 0.22;
export const FALL_PENALTY = 8;
export const CHECKPOINT_SCORE = 40;
export const FINISH_SCORE = 120;
export const MATCH_MS = 75_000;

export const START = { x: 2.5, y: 19.5 };
export const CHECKPOINTS = [
  { x: 8, y: 14 },
  { x: 16, y: 10 },
  { x: 24, y: 6 },
];
const FINISH = { x: 29.5, y: 3.5 };

export function makePlatforms(): IslandPlatform[] {
  return [
    { id: 'start', kind: 'static', x: 1, y: 18, w: 4, h: 3, ox: 1, oy: 18, visible: true },
    { id: 'h1', kind: 'horiz', x: 6, y: 16, w: 4, h: 1.4, ox: 6, oy: 16, visible: true },
    { id: 'v1', kind: 'vert', x: 11, y: 12, w: 2.2, h: 3, ox: 11, oy: 12, visible: true },
    { id: 'cp1', kind: 'static', x: 6.5, y: 13, w: 3.5, h: 2, ox: 6.5, oy: 13, visible: true },
    { id: 'blink1', kind: 'blink', x: 12, y: 10, w: 3, h: 1.6, ox: 12, oy: 10, visible: true },
    { id: 'spin1', kind: 'spin', x: 16, y: 9, w: 3.2, h: 1.4, ox: 16, oy: 9, visible: true },
    { id: 'cp2', kind: 'static', x: 14.5, y: 9, w: 3.5, h: 2, ox: 14.5, oy: 9, visible: true },
    { id: 'h2', kind: 'horiz', x: 20, y: 8, w: 3.5, h: 1.4, ox: 20, oy: 8, visible: true },
    { id: 'v2', kind: 'vert', x: 23, y: 5, w: 2, h: 3, ox: 23, oy: 5, visible: true },
    { id: 'cp3', kind: 'static', x: 22.5, y: 5, w: 3.5, h: 2, ox: 22.5, oy: 5, visible: true },
    { id: 'blink2', kind: 'blink', x: 26, y: 4, w: 2.6, h: 1.5, ox: 26, oy: 4, visible: true },
    { id: 'finish', kind: 'static', x: 28, y: 2.5, w: 3.5, h: 2.4, ox: 28, oy: 2.5, visible: true },
  ];
}

export function tickPlatforms(platforms: IslandPlatform[], elapsed: number): void {
  const t = elapsed / 1000;
  for (const platform of platforms) {
    if (platform.kind === 'horiz') {
      platform.x = platform.ox + Math.sin(t * 1.2) * 1.6;
    } else if (platform.kind === 'vert') {
      platform.y = platform.oy + Math.sin(t * 1.1) * 1.4;
    } else if (platform.kind === 'blink') {
      platform.visible = Math.floor(t / 1.6) % 2 === 0;
    } else if (platform.kind === 'spin') {
      const angle = t * 1.4;
      platform.w = 2.2 + Math.abs(Math.cos(angle)) * 1.4;
      platform.h = 2.2 + Math.abs(Math.sin(angle)) * 1.1;
      platform.x = platform.ox + Math.cos(angle) * 0.4;
      platform.y = platform.oy + Math.sin(angle) * 0.4;
    }
  }
}

export function onPlatform(x: number, y: number, platforms: IslandPlatform[]): boolean {
  return platforms.some(
    (platform) =>
      platform.visible &&
      x >= platform.x &&
      x <= platform.x + platform.w &&
      y >= platform.y &&
      y <= platform.y + platform.h,
  );
}

function spawnFor(checkpoint: number): { x: number; y: number } {
  if (checkpoint <= 0) return { ...START };
  const point = CHECKPOINTS[Math.min(checkpoint, CHECKPOINTS.length) - 1];
  return point ? { ...point } : { ...START };
}

function makePlayer(): IslandPlayer {
  return { ...START, checkpoint: 0, score: 0, fallen: 0, finished: false, disconnected: false, left: false };
}

export function finishIsland(state: IslandState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

export function applyFall(player: IslandPlayer, state: IslandState): void {
  player.fallen += 1;
  player.score = Math.max(0, player.score - FALL_PENALTY);
  const spawn = spawnFor(player.checkpoint);
  player.x = spawn.x;
  player.y = spawn.y;
  state.lastEvent = 'fall';
}

export function tryIslandMove(
  playerId: string,
  dx: number,
  dy: number,
  state: IslandState,
  ctx: GameContext,
): boolean {
  const player = state.players[playerId];
  if (!player || player.left || player.finished || state.phase !== 'playing') return false;
  const nx = Math.max(0.2, Math.min(ISLAND_W - 0.2, player.x + dx * MOVE_STEP));
  const ny = Math.max(0.2, Math.min(ISLAND_H - 0.2, player.y + dy * MOVE_STEP));
  player.x = nx;
  player.y = ny;
  if (!onPlatform(player.x, player.y, state.platforms)) {
    applyFall(player, state);
    ctx.markStateChanged();
    return true;
  }
  for (let i = player.checkpoint; i < CHECKPOINTS.length; i += 1) {
    const point = CHECKPOINTS[i]!;
    if (Math.hypot(player.x - point.x, player.y - point.y) < 1.2) {
      player.checkpoint = i + 1;
      player.score += CHECKPOINT_SCORE;
      state.lastEvent = `checkpoint:${playerId}`;
    }
  }
  if (!player.finished && Math.hypot(player.x - state.finish.x, player.y - state.finish.y) < 1.4) {
    player.finished = true;
    const remain = Math.max(0, (state.endsAt ?? ctx.now()) - ctx.now());
    player.score += FINISH_SCORE + Math.floor(remain / 250);
    state.lastEvent = `finish:${playerId}`;
    const active = Object.values(state.players).filter((entry) => !entry.left);
    if (active.length > 0 && active.every((entry) => entry.finished)) finishIsland(state, ctx, 'completed');
  }
  ctx.markStateChanged();
  return true;
}

export const movingIslandGame: GameModule<IslandState> = {
  metadata: MOVING_ISLAND_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players): IslandState {
    return {
      phase: 'idle',
      platforms: makePlatforms(),
      players: Object.fromEntries(players.map((player) => [player.id, makePlayer()])),
      checkpoints: CHECKPOINTS.map((point) => ({ ...point })),
      finish: { ...FINISH },
      startedAt: null,
      endsAt: null,
      lastTick: 0,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
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
    if (remaining.length <= 1) finishIsland(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    ctx.players.forEach((player) => {
      state.players[player.id] = makePlayer();
    });
    state.platforms = makePlatforms();
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.lastTick = ctx.now();
    state.endsAt = ctx.now() + MATCH_MS;
    state.lastEvent = 'start';
    ctx.markStateChanged();
    ctx.schedule(MATCH_MS, () => finishIsland(state, ctx, 'timeout'), 'gameDuration', 'match-timeout');
    for (const player of ctx.players) {
      if (player.isAI) ctx.requestAI(player.id, 280);
    }
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type === 'score' || action.type === 'finish' || action.type === 'teleport') {
      return { valid: false, reason: 'The server owns platforms and scoring.' };
    }
    if (action.type !== 'move') return { valid: false, reason: 'Unknown action.' };
    if (state.phase !== 'playing') return { valid: false, reason: 'The islands are not moving yet.' };
    const player = state.players[playerId];
    if (!player || player.left || player.finished) return { valid: false, reason: 'You cannot move.' };
    const dx = action.payload?.dx;
    const dy = action.payload?.dy;
    if (typeof dx !== 'number' || typeof dy !== 'number') return { valid: false, reason: 'Need a direction.' };
    if (Math.abs(dx) > 1.05 || Math.abs(dy) > 1.05) return { valid: false, reason: 'Move too large.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'move') return actionRejected('The server owns platforms and scoring.');
    const dx = typeof action.payload?.dx === 'number' ? action.payload.dx : 0;
    const dy = typeof action.payload?.dy === 'number' ? action.payload.dy : 0;
    if (!tryIslandMove(playerId, dx, dy, state, ctx)) return actionRejected('You cannot move.');
    return actionAccepted();
  },

  update(state, deltaMs, ctx): void {
    if (state.phase !== 'playing') return;
    tickPlatforms(state.platforms, ctx.now() - (state.startedAt ?? ctx.now()));
    for (const player of Object.values(state.players)) {
      if (player.left || player.finished) continue;
      if (!onPlatform(player.x, player.y, state.platforms)) applyFall(player, state);
    }
    state.lastTick = deltaMs;
    ctx.markStateChanged();
    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const runner = state.players[player.id];
      if (!runner || runner.finished || runner.left) continue;
      const now = ctx.now();
      if (now >= (state.nextAIRequestAt[player.id] ?? 0)) {
        ctx.requestAI(player.id, 80);
        state.nextAIRequestAt[player.id] = now + 220;
      }
    }
  },

  tick(): void {
    // Driven by update.
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
        stats: { checkpoint: entry?.checkpoint ?? 0, fallen: entry?.fallen ?? 0, finished: entry?.finished ? 1 : 0 },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): IslandState {
    const ids = Object.keys(state.players);
    return {
      ...state,
      phase: 'idle',
      platforms: makePlatforms(),
      players: Object.fromEntries(ids.map((id) => [id, makePlayer()])),
      startedAt: null,
      endsAt: null,
      lastTick: 0,
      finishReason: null,
      lastEvent: null,
    };
  },

  cleanup(state): void {
    state.players = {};
    state.platforms = [];
    state.phase = 'finished';
  },

  getPublicState(state, _viewerId, ctx) {
    return {
      phase: state.phase,
      platforms: state.platforms.map((platform) => ({ ...platform })),
      checkpoints: state.checkpoints,
      finish: state.finish,
      endsAt: state.endsAt,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      width: ISLAND_W,
      height: ISLAND_H,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, player]) => [
          id,
          {
            x: player.x,
            y: player.y,
            checkpoint: player.checkpoint,
            score: player.score,
            fallen: player.fallen,
            finished: player.finished,
            disconnected: player.disconnected,
          },
        ]),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const player = state.players[playerId];
    if (!player || player.finished || player.left) return null;
    const target =
      player.checkpoint < CHECKPOINTS.length ? CHECKPOINTS[player.checkpoint]! : state.finish;
    let dx = Math.sign(target.x - player.x);
    let dy = Math.sign(target.y - player.y);
    if (difficulty === 'easy' && ctx.random() < 0.3) {
      dx = Math.sign(ctx.random() - 0.5);
      dy = Math.sign(ctx.random() - 0.5);
    }
    return { type: 'move', payload: { dx, dy } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 6 * 60 * 1000,
};
