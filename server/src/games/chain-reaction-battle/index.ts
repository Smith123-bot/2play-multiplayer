import type { GameAction, GameFinishReason } from '@2play/shared';
import { CHAIN_REACTION_METADATA } from '@2play/shared';
export { CHAIN_REACTION_METADATA };
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
 * Chain Reaction Battle — clients send a node id. The server owns the cascade,
 * the chain length, multipliers and the score.
 */

export type ChainPhase = 'idle' | 'playing' | 'between' | 'finished';
export type NodeKind = 'normal' | 'bonus' | 'multiplier' | 'blocker' | 'arrow';
export type ArrowDir = 'up' | 'down' | 'left' | 'right';

export interface ChainNode {
  id: string;
  x: number;
  y: number;
  color: number;
  kind: NodeKind;
  arrow?: ArrowDir;
  alive: boolean;
}

export interface ChainPlayer {
  score: number;
  roundScore: number;
  triggersLeft: number;
  lastChain: number;
  disconnected: boolean;
  left: boolean;
}

export interface ChainState {
  phase: ChainPhase;
  round: number;
  totalRounds: number;
  cols: number;
  rows: number;
  nodes: ChainNode[];
  players: Record<string, ChainPlayer>;
  lastChain: { playerId: string; length: number; score: number } | null;
  startedAt: number | null;
  endsAt: number | null;
  roundMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
}

export const CHAIN_COLS = 6;
export const CHAIN_ROWS = 5;
export const ROUND_MS = 22_000;
export const BETWEEN_MS = 1_500;
export const TRIGGERS_PER_ROUND = 2;
export const PALETTE = 4;

const ARROW_DELTA: Record<ArrowDir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export function nodeIdAt(x: number, y: number): string {
  return `${x},${y}`;
}

export function dealBoard(seed: number, cols = CHAIN_COLS, rows = CHAIN_ROWS): ChainNode[] {
  const nodes: ChainNode[] = [];
  let n = seed >>> 0;
  const next = () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n;
  };
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const roll = next() % 20;
      let kind: NodeKind = 'normal';
      let arrow: ArrowDir | undefined;
      if (roll === 0) kind = 'blocker';
      else if (roll === 1 || roll === 2) kind = 'bonus';
      else if (roll === 3) kind = 'multiplier';
      else if (roll === 4) {
        kind = 'arrow';
        arrow = (['up', 'down', 'left', 'right'] as ArrowDir[])[next() % 4];
      }
      nodes.push({
        id: nodeIdAt(x, y),
        x,
        y,
        color: next() % PALETTE,
        kind,
        arrow,
        alive: true,
      });
    }
  }
  return nodes;
}

export function evaluateChain(nodes: ChainNode[], startId: string): ChainNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const start = byId.get(startId);
  if (!start || !start.alive || start.kind === 'blocker') return [];
  const seen = new Set<string>();
  const out: ChainNode[] = [];
  const queue: ChainNode[] = [start];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current.id) || !current.alive) continue;
    seen.add(current.id);
    out.push(current);
    if (current.kind === 'arrow' && current.arrow) {
      const delta = ARROW_DELTA[current.arrow];
      const next = byId.get(nodeIdAt(current.x + delta.dx, current.y + delta.dy));
      if (next && next.alive && !seen.has(next.id) && next.kind !== 'blocker') queue.push(next);
      continue;
    }
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ] as Array<[number, number]>) {
      const next = byId.get(nodeIdAt(current.x + dx, current.y + dy));
      if (!next || !next.alive || seen.has(next.id) || next.kind === 'blocker') continue;
      if (next.color === start.color || next.kind === 'arrow') queue.push(next);
    }
  }
  return out;
}

export function scoreChain(chain: ChainNode[]): number {
  if (chain.length === 0) return 0;
  const multipliers = chain.filter((node) => node.kind === 'multiplier').length;
  const bonus = chain.filter((node) => node.kind === 'bonus').length;
  const factor = multipliers > 0 ? 2 * multipliers : 1;
  return chain.length * 10 * factor + bonus * 15;
}

function makePlayer(): ChainPlayer {
  return {
    score: 0,
    roundScore: 0,
    triggersLeft: TRIGGERS_PER_ROUND,
    lastChain: 0,
    disconnected: false,
    left: false,
  };
}

export function finishChain(state: ChainState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

export function beginChainRound(state: ChainState, ctx: GameContext, round: number): void {
  state.round = round;
  state.nodes = dealBoard(ctx.seed + round * 9176 + ctx.players.length * 13);
  for (const player of Object.values(state.players)) {
    player.triggersLeft = TRIGGERS_PER_ROUND;
    player.roundScore = 0;
    player.lastChain = 0;
  }
  state.lastChain = null;
  state.phase = 'playing';
  state.endsAt = ctx.now() + ROUND_MS;
  state.roundMs = ROUND_MS;
  state.lastEvent = 'round-start';
  ctx.markStateChanged();
  ctx.schedule(ROUND_MS, () => closeChainRound(state, ctx), 'turn', 'round-timeout');
  for (const player of ctx.players) {
    if (player.isAI) ctx.requestAI(player.id, 180 + Math.floor(ctx.random() * 240));
  }
}

export function closeChainRound(state: ChainState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  if (state.round + 1 >= state.totalRounds) {
    finishChain(state, ctx, 'completed');
    return;
  }
  state.phase = 'between';
  state.lastEvent = 'round-end';
  ctx.markStateChanged();
  ctx.schedule(BETWEEN_MS, () => beginChainRound(state, ctx, state.round + 1), 'turn', 'next-round');
}

function maybeAdvance(state: ChainState, ctx: GameContext): void {
  const active = Object.values(state.players).filter((player) => !player.left);
  if (active.length > 0 && active.every((player) => player.triggersLeft <= 0)) closeChainRound(state, ctx);
}

function triggerPayload(action: GameAction): string | null {
  if (action.type !== 'trigger' && action.type !== 'TRIGGER_NODE') return null;
  const nodeId = action.payload?.nodeId;
  return typeof nodeId === 'string' ? nodeId : null;
}

export const chainReactionGame: GameModule<ChainState> = {
  metadata: CHAIN_REACTION_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players, config): ChainState {
    return {
      phase: 'idle',
      round: 0,
      totalRounds: typeof config.rounds === 'number' ? Math.min(6, Math.max(2, config.rounds)) : 4,
      cols: CHAIN_COLS,
      rows: CHAIN_ROWS,
      nodes: dealBoard(42),
      players: Object.fromEntries(players.map((player) => [player.id, makePlayer()])),
      lastChain: null,
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
    if (remaining.length <= 1) finishChain(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    ctx.players.forEach((player) => {
      state.players[player.id] = makePlayer();
    });
    state.totalRounds = typeof ctx.config.rounds === 'number' ? Math.min(6, Math.max(2, ctx.config.rounds)) : 4;
    state.startedAt = ctx.now();
    beginChainRound(state, ctx, 0);
    ctx.schedule(
      state.totalRounds * (ROUND_MS + BETWEEN_MS) + 4_000,
      () => finishChain(state, ctx, 'timeout'),
      'gameDuration',
      'match-timeout',
    );
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type === 'score' || action.type === 'chain' || action.type === 'length') {
      return { valid: false, reason: 'The server owns the chain length and the score.' };
    }
    const nodeId = triggerPayload(action);
    if (nodeId === null) return { valid: false, reason: 'Trigger a node id.' };
    if (state.phase !== 'playing') return { valid: false, reason: 'Wait for the next board.' };
    const player = state.players[playerId];
    if (!player || player.left) return { valid: false, reason: 'You are not in this match.' };
    if (player.triggersLeft <= 0) return { valid: false, reason: 'No triggers left this round.' };
    const node = state.nodes.find((entry) => entry.id === nodeId);
    if (!node || !node.alive || node.kind === 'blocker') return { valid: false, reason: 'That node cannot spark.' };
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type === 'score' || action.type === 'chain' || action.type === 'length') {
      return actionRejected('The server owns the chain length and the score.');
    }
    const nodeId = triggerPayload(action);
    if (nodeId === null) return actionRejected('Trigger a node id.');
    const player = state.players[playerId];
    if (!player || state.phase !== 'playing' || player.left || player.triggersLeft <= 0) {
      return actionRejected('You cannot trigger.');
    }
    const chain = evaluateChain(state.nodes, nodeId);
    if (chain.length === 0) return actionRejected('That node cannot spark.');
    player.triggersLeft -= 1;
    const gained = scoreChain(chain);
    player.roundScore += gained;
    player.score += gained;
    player.lastChain = chain.length;
    for (const node of chain) node.alive = false;
    state.lastChain = { playerId, length: chain.length, score: gained };
    state.lastEvent = `chain:${playerId}`;
    ctx.markStateChanged();
    maybeAdvance(state, ctx);
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
    const ranked = [...ctx.players].sort(
      (a, b) => (state.players[b.id]?.score ?? 0) - (state.players[a.id]?.score ?? 0),
    );
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
        stats: { lastChain: entry?.lastChain ?? 0 },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): ChainState {
    const ids = Object.keys(state.players);
    return {
      ...state,
      phase: 'idle',
      round: 0,
      nodes: dealBoard(42),
      players: Object.fromEntries(ids.map((id) => [id, makePlayer()])),
      lastChain: null,
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
    };
  },

  cleanup(state): void {
    state.players = {};
    state.nodes = [];
    state.phase = 'finished';
  },

  getPublicState(state, _viewerId, ctx) {
    return {
      phase: state.phase,
      round: state.round,
      totalRounds: state.totalRounds,
      cols: state.cols,
      rows: state.rows,
      nodes: state.nodes.map((node) => ({ ...node })),
      lastChain: state.lastChain ? { ...state.lastChain } : null,
      endsAt: state.endsAt,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, player]) => [
          id,
          {
            score: player.score,
            roundScore: player.roundScore,
            triggersLeft: player.triggersLeft,
            lastChain: player.lastChain,
            disconnected: player.disconnected,
          },
        ]),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const player = state.players[playerId];
    if (!player || player.left || player.triggersLeft <= 0) return null;
    let best: { id: string; len: number } | null = null;
    for (const node of state.nodes) {
      if (!node.alive || node.kind === 'blocker') continue;
      const length = evaluateChain(state.nodes, node.id).length;
      if (!best || length > best.len) best = { id: node.id, len: length };
    }
    if (!best) return null;
    if (difficulty === 'easy' && ctx.random() < 0.4) {
      const alive = state.nodes.filter((node) => node.alive && node.kind !== 'blocker');
      const pick = alive[Math.floor(ctx.random() * alive.length)];
      if (pick) return { type: 'trigger', payload: { nodeId: pick.id } };
    }
    return { type: 'trigger', payload: { nodeId: best.id } };
  },

  maxDurationMs: 8 * 60 * 1000,
};
