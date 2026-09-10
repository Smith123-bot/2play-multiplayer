import type { AIDifficulty, GameAction, GameFinishReason } from '@2play/shared';
import { BLACK_BLAST_METADATA } from '@2play/shared';
export { BLACK_BLAST_METADATA };
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

/**
 * Black Blast — abstract 2D chain-reaction arena.
 *
 * Players move a marker around a grid arena and drop "black energy" pulses.
 * A pulse charges briefly, then expands into a circular zone. Energy nodes
 * caught in the zone detonate too, cascading into chains. Everything — the
 * pulse timing, the radius, which nodes are hit, the chain depth, the combo
 * multiplier and the score — is computed here on the server.
 *
 * Purely geometric/abstract: no weapons, no real-world explosives.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type BlastPhase = 'idle' | 'playing' | 'finished';
export type NodeKind = 'energy' | 'rich' | 'obstacle';

export interface ArenaNode {
  id: string;
  x: number;
  y: number;
  kind: NodeKind;
  /** Consumed nodes stay in the array so ids remain stable. */
  consumed: boolean;
  /** Respawn timestamp for collectible energy (0 = active). */
  respawnAt: number;
}

export interface Pulse {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  /** Server time the pulse detonates. */
  detonateAt: number;
  radius: number;
  /** 0 for a player-placed pulse, 1+ for chain-triggered pulses. */
  depth: number;
  detonated: boolean;
}

export interface BlastPlayer {
  x: number;
  y: number;
  score: number;
  combo: number;
  bestCombo: number;
  hits: number;
  chains: number;
  /** Server time the player may place another pulse. */
  cooldownUntil: number;
  /** Server time the current combo window expires. */
  comboUntil: number;
  disconnected: boolean;
  left: boolean;
}

export interface BlastState {
  phase: BlastPhase;
  cols: number;
  rows: number;
  nodes: ArenaNode[];
  pulses: Pulse[];
  players: Record<string, BlastPlayer>;
  startedAt: number | null;
  endsAt: number | null;
  matchMs: number;
  lastEvent: string | null;
  finishReason: GameFinishReason | null;
  pulseCounter: number;
  nextAIRequestAt: Record<string, number>;
  /** Rolling log the client animates (trimmed every tick). */
  effects: Array<{ id: string; x: number; y: number; radius: number; ownerId: string; depth: number; at: number }>;
}

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

export const ARENA_COLS = 16;
export const ARENA_ROWS = 12;
export const MATCH_MS = 180_000;
/** Charge time before a player pulse detonates. */
export const FUSE_MS = 900;
/** Charge time for a chain-triggered pulse (snappier, so chains feel fast). */
export const CHAIN_FUSE_MS = 260;
export const PULSE_RADIUS = 2.6;
export const PULSE_COOLDOWN_MS = 1_400;
export const COMBO_WINDOW_MS = 2_500;
export const MAX_CHAIN_DEPTH = 6;
export const NODE_RESPAWN_MS = 6_000;
export const EFFECT_TTL_MS = 1_200;

export const ENERGY_SCORE = 20;
export const RICH_SCORE = 60;
/** Multiplier applied per chain level (depth 2 = x2, depth 3 = x3...). */
export const CHAIN_BONUS = 15;
export const COMBO_STEP = 0.25;
export const MAX_COMBO_MULTIPLIER = 4;

const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 1500, medium: 900, hard: 520 };

const MOVES: Record<string, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export function isDirection(value: unknown): value is 'up' | 'down' | 'left' | 'right' {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

/* ------------------------------------------------------------------ */
/* Arena                                                               */
/* ------------------------------------------------------------------ */

const SPAWNS = [
  { x: 1, y: 1 },
  { x: ARENA_COLS - 2, y: ARENA_ROWS - 2 },
  { x: ARENA_COLS - 2, y: 1 },
  { x: 1, y: ARENA_ROWS - 2 },
];

/** Deterministic arena from the seeded platform PRNG. */
export function buildArena(random: () => number): ArenaNode[] {
  const nodes: ArenaNode[] = [];
  const taken = new Set<string>(SPAWNS.map((spawn) => `${spawn.x}:${spawn.y}`));
  const place = (kind: NodeKind, count: number) => {
    let placed = 0;
    let guard = 0;
    while (placed < count && guard < count * 60) {
      guard += 1;
      const x = 1 + Math.floor(random() * (ARENA_COLS - 2));
      const y = 1 + Math.floor(random() * (ARENA_ROWS - 2));
      const key = `${x}:${y}`;
      if (taken.has(key)) continue;
      taken.add(key);
      nodes.push({ id: `n${nodes.length}`, x, y, kind, consumed: false, respawnAt: 0 });
      placed += 1;
    }
  };
  place('energy', 34);
  place('rich', 8);
  place('obstacle', 14);
  return nodes;
}

function makePlayer(index: number): BlastPlayer {
  const spawn = SPAWNS[index % SPAWNS.length] ?? { x: 1, y: 1 };
  return {
    x: spawn.x,
    y: spawn.y,
    score: 0,
    combo: 0,
    bestCombo: 0,
    hits: 0,
    chains: 0,
    cooldownUntil: 0,
    comboUntil: 0,
    disconnected: false,
    left: false,
  };
}

export function inArena(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < ARENA_COLS && y < ARENA_ROWS;
}

/** Obstacles block movement; energy nodes do not. */
export function isBlocked(state: BlastState, x: number, y: number): boolean {
  if (!inArena(x, y)) return true;
  return state.nodes.some(
    (node) => node.kind === 'obstacle' && !node.consumed && node.x === x && node.y === y,
  );
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/* ------------------------------------------------------------------ */
/* Blast resolution (server authoritative)                             */
/* ------------------------------------------------------------------ */

/**
 * Detonates a pulse: awards its owner for every node inside the radius and
 * queues chain pulses on the energy nodes it consumed.
 */
export function detonate(state: BlastState, pulse: Pulse, ctx: GameContext): void {
  if (pulse.detonated) return;
  pulse.detonated = true;

  const owner = state.players[pulse.ownerId];
  const now = ctx.now();
  let gained = 0;
  let hits = 0;
  const chained: ArenaNode[] = [];

  for (const node of state.nodes) {
    if (node.consumed || node.kind === 'obstacle') continue;
    if (distance(node.x, node.y, pulse.x, pulse.y) > pulse.radius) continue;

    node.consumed = true;
    node.respawnAt = now + NODE_RESPAWN_MS;
    hits += 1;
    gained += node.kind === 'rich' ? RICH_SCORE : ENERGY_SCORE;
    // Rich nodes propagate the chain.
    if (node.kind === 'rich' && pulse.depth < MAX_CHAIN_DEPTH) chained.push(node);
  }

  if (owner && hits > 0) {
    // Chain depth bonus.
    gained += pulse.depth * CHAIN_BONUS * hits;

    // Combo builds while the player keeps landing pulses in the window.
    owner.combo = now <= owner.comboUntil ? owner.combo + 1 : 1;
    owner.comboUntil = now + COMBO_WINDOW_MS;
    owner.bestCombo = Math.max(owner.bestCombo, owner.combo);
    const multiplier = Math.min(MAX_COMBO_MULTIPLIER, 1 + (owner.combo - 1) * COMBO_STEP);

    owner.score += Math.round(gained * multiplier);
    owner.hits += hits;
    if (pulse.depth > 0) owner.chains += 1;
    state.lastEvent = pulse.depth > 0 ? `chain:${pulse.ownerId}:${pulse.depth}` : `blast:${pulse.ownerId}`;
  } else if (owner) {
    // A pulse that hits nothing breaks the combo.
    owner.combo = 0;
    owner.comboUntil = 0;
    state.lastEvent = `miss:${pulse.ownerId}`;
  }

  state.effects.push({
    id: pulse.id,
    x: pulse.x,
    y: pulse.y,
    radius: pulse.radius,
    ownerId: pulse.ownerId,
    depth: pulse.depth,
    at: now,
  });

  // Queue the chain reactions.
  for (const node of chained) {
    state.pulseCounter += 1;
    state.pulses.push({
      id: `p${state.pulseCounter}`,
      ownerId: pulse.ownerId,
      x: node.x,
      y: node.y,
      detonateAt: now + CHAIN_FUSE_MS,
      radius: pulse.radius * 0.9,
      depth: pulse.depth + 1,
      detonated: false,
    });
  }
}

export function finishBlast(state: BlastState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.endsAt = null;
  state.pulses = [];
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

/* ------------------------------------------------------------------ */
/* Module                                                              */
/* ------------------------------------------------------------------ */

export const blackBlastGame: GameModule<BlastState> = {
  metadata: BLACK_BLAST_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players: readonly GamePlayerView[]): BlastState {
    const state: BlastState = {
      phase: 'idle',
      cols: ARENA_COLS,
      rows: ARENA_ROWS,
      nodes: [],
      pulses: [],
      players: {},
      startedAt: null,
      endsAt: null,
      matchMs: MATCH_MS,
      lastEvent: null,
      finishReason: null,
      pulseCounter: 0,
      nextAIRequestAt: {},
      effects: [],
    };
    players.forEach((player, index) => {
      state.players[player.id] = makePlayer(
        typeof player.seatIndex === 'number' ? player.seatIndex : index,
      );
    });
    return state;
  },

  playerJoined(player, state): void {
    const existing = state.players[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    state.players[player.id] = makePlayer(
      typeof player.seatIndex === 'number' ? player.seatIndex : Object.keys(state.players).length,
    );
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
    if (remaining.length <= 1) finishBlast(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    state.nodes = buildArena(ctx.random);
    state.pulses = [];
    state.effects = [];
    state.pulseCounter = 0;
    state.players = {};
    ctx.players.forEach((player, index) => {
      state.players[player.id] = makePlayer(
        typeof player.seatIndex === 'number' ? player.seatIndex : index,
      );
    });
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = ctx.now() + state.matchMs;
    state.finishReason = null;
    state.lastEvent = 'start';
    state.nextAIRequestAt = {};
    ctx.markStateChanged();
    ctx.schedule(state.matchMs, () => finishBlast(state, ctx, 'timeout'), 'gameDuration', 'match');
    for (const player of ctx.players) {
      if (player.isAI) ctx.requestAI(player.id, 500);
    }
  },

  validateAction(playerId, action, state, ctx): ValidationResult {
    if (['score', 'hit', 'win', 'finish', 'detonate', 'chain'].includes(action.type)) {
      return { valid: false, reason: 'The server resolves every blast.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'The arena is not live.' };

    const player = state.players[playerId];
    if (!player || player.left) return { valid: false, reason: 'You are not in this arena.' };
    if (player.disconnected) return { valid: false, reason: 'Reconnect to keep playing.' };

    if (action.type === 'move') {
      const direction = action.payload?.direction;
      if (!isDirection(direction)) return { valid: false, reason: 'Use up, down, left or right.' };
      const delta = MOVES[direction]!;
      if (isBlocked(state, player.x + delta.dx, player.y + delta.dy)) {
        return { valid: false, reason: 'Blocked.' };
      }
      return { valid: true };
    }

    if (action.type === 'pulse') {
      // Cooldown is enforced server-side: spamming the button changes nothing.
      if (ctx.now() < player.cooldownUntil) return { valid: false, reason: 'Still recharging.' };
      return { valid: true };
    }

    return { valid: false, reason: 'Unknown action.' };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (state.phase !== 'playing') return actionRejected('The arena is not live.');
    const player = state.players[playerId];
    if (!player || player.left || player.disconnected) return actionRejected('You cannot act.');

    if (action.type === 'move') {
      const direction = action.payload?.direction;
      if (!isDirection(direction)) return actionRejected('Invalid direction.');
      const delta = MOVES[direction]!;
      const nx = player.x + delta.dx;
      const ny = player.y + delta.dy;
      if (isBlocked(state, nx, ny)) return actionRejected('Blocked.');
      player.x = nx;
      player.y = ny;
      state.lastEvent = `move:${playerId}`;
      ctx.markStateChanged();
      return actionAccepted();
    }

    if (action.type !== 'pulse') return actionRejected('Unknown action.');
    const now = ctx.now();
    if (now < player.cooldownUntil) return actionRejected('Still recharging.');

    player.cooldownUntil = now + PULSE_COOLDOWN_MS;
    state.pulseCounter += 1;
    state.pulses.push({
      id: `p${state.pulseCounter}`,
      ownerId: playerId,
      x: player.x,
      y: player.y,
      detonateAt: now + FUSE_MS,
      radius: PULSE_RADIUS,
      depth: 0,
      detonated: false,
    });
    state.lastEvent = `charge:${playerId}`;
    ctx.markStateChanged();
    return actionAccepted();
  },

  /** The simulation heartbeat: detonations, respawns, AI and combo decay. */
  update(state, _deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;
    const now = ctx.now();
    let changed = false;

    // Detonate every pulse whose fuse has run out.
    const due = state.pulses.filter((pulse) => !pulse.detonated && pulse.detonateAt <= now);
    for (const pulse of due) {
      detonate(state, pulse, ctx);
      changed = true;
    }
    if (state.pulses.some((pulse) => pulse.detonated)) {
      state.pulses = state.pulses.filter((pulse) => !pulse.detonated);
    }

    // Respawn consumed energy so the arena never runs dry.
    for (const node of state.nodes) {
      if (node.consumed && node.kind !== 'obstacle' && node.respawnAt > 0 && now >= node.respawnAt) {
        node.consumed = false;
        node.respawnAt = 0;
        changed = true;
      }
    }

    // Expire stale combos.
    for (const player of Object.values(state.players)) {
      if (player.combo > 0 && now > player.comboUntil) {
        player.combo = 0;
        changed = true;
      }
    }

    // Trim the client-side effect log.
    if (state.effects.length > 0) {
      const kept = state.effects.filter((effect) => now - effect.at < EFFECT_TTL_MS);
      if (kept.length !== state.effects.length) {
        state.effects = kept;
        changed = true;
      }
    }

    for (const view of ctx.players) {
      if (!view.isAI) continue;
      const bot = state.players[view.id];
      if (!bot || bot.left) continue;
      const difficulty = view.aiDifficulty ?? 'medium';
      if (now >= (state.nextAIRequestAt[view.id] ?? 0)) {
        ctx.requestAI(view.id, 40);
        state.nextAIRequestAt[view.id] = now + AI_INTERVAL[difficulty];
      }
    }

    if (changed) ctx.markStateChanged();
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
    state.pulses = [];
  },

  getResult(state, ctx): GameResultDraft {
    const ranked = [...ctx.players].sort((a, b) => {
      const left = state.players[a.id];
      const right = state.players[b.id];
      const byScore = (right?.score ?? 0) - (left?.score ?? 0);
      if (byScore !== 0) return byScore;
      return (right?.bestCombo ?? 0) - (left?.bestCombo ?? 0);
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
          hits: entry?.hits ?? 0,
          chains: entry?.chains ?? 0,
          bestCombo: entry?.bestCombo ?? 0,
        },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): BlastState {
    const seats = Object.keys(state.players);
    return {
      ...state,
      phase: 'idle',
      nodes: [],
      pulses: [],
      effects: [],
      pulseCounter: 0,
      players: Object.fromEntries(seats.map((id, index) => [id, makePlayer(index)])),
      startedAt: null,
      endsAt: null,
      lastEvent: null,
      finishReason: null,
      nextAIRequestAt: {},
    };
  },

  cleanup(state): void {
    state.players = {};
    state.nodes = [];
    state.pulses = [];
    state.effects = [];
    state.phase = 'finished';
  },

  /**
   * The arena is a shared, public space — but pending pulses are only shown as
   * a charging marker (position + detonation time), never with the resolved
   * outcome, which the server computes at detonation time.
   */
  getPublicState(state, viewerId, ctx) {
    const me = viewerId ? state.players[viewerId] : undefined;
    const now = ctx.now();
    return {
      phase: state.phase,
      cols: state.cols,
      rows: state.rows,
      endsAt: state.endsAt,
      serverTime: now,
      lastEvent: state.lastEvent,
      finishReason: state.finishReason,
      nodes: state.nodes
        .filter((node) => !node.consumed)
        .map((node) => ({ id: node.id, x: node.x, y: node.y, kind: node.kind })),
      pulses: state.pulses
        .filter((pulse) => !pulse.detonated)
        .map((pulse) => ({
          id: pulse.id,
          x: pulse.x,
          y: pulse.y,
          ownerId: pulse.ownerId,
          detonateAt: pulse.detonateAt,
          radius: pulse.radius,
          depth: pulse.depth,
        })),
      effects: state.effects.map((effect) => ({ ...effect })),
      me: me
        ? {
            cooldownUntil: me.cooldownUntil,
            combo: me.combo,
            comboUntil: me.comboUntil,
            score: me.score,
          }
        : null,
      players: Object.fromEntries(
        Object.entries(state.players).map(([id, player]) => [
          id,
          {
            x: player.x,
            y: player.y,
            score: player.score,
            combo: player.combo,
            bestCombo: player.bestCombo,
            hits: player.hits,
            chains: player.chains,
            disconnected: player.disconnected,
          },
        ]),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const bot = state.players[playerId];
    if (!bot || bot.left) return null;
    const now = ctx.now();

    // Count what a pulse here would catch right now.
    const wouldHit = state.nodes.filter(
      (node) =>
        !node.consumed &&
        node.kind !== 'obstacle' &&
        distance(node.x, node.y, bot.x, bot.y) <= PULSE_RADIUS,
    );
    const richHere = wouldHit.some((node) => node.kind === 'rich');
    const threshold = difficulty === 'hard' ? 2 : difficulty === 'medium' ? 2 : 1;

    if (now >= bot.cooldownUntil && (wouldHit.length >= threshold || (richHere && difficulty !== 'easy'))) {
      return { type: 'pulse' };
    }

    // Otherwise walk toward the most valuable nearby cluster.
    const targets = state.nodes.filter((node) => !node.consumed && node.kind !== 'obstacle');
    if (targets.length === 0) return null;

    let best = targets[0]!;
    let bestValue = -Infinity;
    for (const node of targets) {
      const dist = Math.abs(node.x - bot.x) + Math.abs(node.y - bot.y);
      const worth = node.kind === 'rich' ? 3 : 1;
      const value = worth * 4 - dist;
      if (value > bestValue) {
        bestValue = value;
        best = node;
      }
    }

    const candidates: Array<'up' | 'down' | 'left' | 'right'> = [];
    if (best.x > bot.x) candidates.push('right');
    if (best.x < bot.x) candidates.push('left');
    if (best.y > bot.y) candidates.push('down');
    if (best.y < bot.y) candidates.push('up');

    // Easy bots wander a bit.
    if (difficulty === 'easy' && ctx.random() < 0.4) {
      const all: Array<'up' | 'down' | 'left' | 'right'> = ['up', 'down', 'left', 'right'];
      const legal = all.filter((dir) => !isBlocked(state, bot.x + MOVES[dir]!.dx, bot.y + MOVES[dir]!.dy));
      const pick = legal[Math.floor(ctx.random() * legal.length)];
      return pick ? { type: 'move', payload: { direction: pick } } : null;
    }

    const legal = candidates.filter(
      (dir) => !isBlocked(state, bot.x + MOVES[dir]!.dx, bot.y + MOVES[dir]!.dy),
    );
    if (legal.length > 0) {
      const pick = legal[Math.floor(ctx.random() * legal.length)]!;
      return { type: 'move', payload: { direction: pick } };
    }

    const all: Array<'up' | 'down' | 'left' | 'right'> = ['up', 'down', 'left', 'right'];
    const fallback = all.filter((dir) => !isBlocked(state, bot.x + MOVES[dir]!.dx, bot.y + MOVES[dir]!.dy));
    const pick = fallback[Math.floor(ctx.random() * fallback.length)];
    return pick ? { type: 'move', payload: { direction: pick } } : null;
  },

  needsUpdateLoop: true,
  maxDurationMs: 12 * 60 * 1000,
};
