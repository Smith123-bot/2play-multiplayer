import type { AIDifficulty, GameAction, GameFinishReason } from '@2play/shared';
import { CASTLE_SIEGE_METADATA } from '@2play/shared';
export { CASTLE_SIEGE_METADATA };
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
 * Castle Siege 2D — real-time keep defense.
 *
 * Clients send move / build / upgrade / fire / capture. The server owns
 * energy, HP, cooldowns, range, captures and the winner.
 */

export type SiegePhase = 'idle' | 'playing' | 'finished';
export type SiegeDirection = 'up' | 'down' | 'left' | 'right';
export type DefenseKind = 'wall' | 'tower';

export interface SiegeDefense {
  id: string;
  x: number;
  y: number;
  owner: string;
  kind: DefenseKind;
  hp: number;
}

export interface SiegeCommander {
  x: number;
  y: number;
  energy: number;
  castleHp: number;
  castleX: number;
  castleY: number;
  score: number;
  damageDealt: number;
  captures: number;
  lastFireAt: number;
  lastBuildAt: number;
  alive: boolean;
  disconnected: boolean;
  left: boolean;
}

export interface SiegeState {
  phase: SiegePhase;
  cols: number;
  rows: number;
  commanders: Record<string, SiegeCommander>;
  defenses: SiegeDefense[];
  nodes: Array<{ x: number; y: number; holder: string | null }>;
  stepMs: number;
  stepIndex: number;
  accumulatorMs: number;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  nextAIRequestAt: Record<string, number>;
  defenseSeq: number;
}

export const SIEGE_COLS = 14;
export const SIEGE_ROWS = 10;
export const CASTLE_HP = 100;
export const FIRE_RANGE = 4;
export const FIRE_COST = 2;
export const BUILD_COST = 3;
export const UPGRADE_COST = 4;
export const FIRE_COOLDOWN_MS = 700;
export const BUILD_COOLDOWN_MS = 500;
export const MAX_ENERGY = 10;
const STEP_MS = 250;
const MATCH_MS = 150_000;
const DELTA: Record<SiegeDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};
const ALL_DIRS: SiegeDirection[] = ['up', 'down', 'left', 'right'];
const AI_INTERVAL: Record<AIDifficulty, number> = { easy: 500, medium: 280, hard: 140 };

export function isSiegeDirection(value: unknown): value is SiegeDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

function inBounds(cols: number, rows: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < cols && y < rows;
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function castleAnchors(cols: number, rows: number): Array<{ x: number; y: number }> {
  return [
    { x: 1, y: 1 },
    { x: cols - 2, y: 1 },
    { x: 1, y: rows - 2 },
    { x: cols - 2, y: rows - 2 },
  ];
}

function occupiedCells(state: SiegeState): Set<string> {
  const set = new Set<string>();
  for (const commander of Object.values(state.commanders)) {
    if (commander.left) continue;
    set.add(`${commander.x},${commander.y}`);
    set.add(`${commander.castleX},${commander.castleY}`);
  }
  for (const defense of state.defenses) set.add(`${defense.x},${defense.y}`);
  for (const node of state.nodes) set.add(`${node.x},${node.y}`);
  return set;
}

function blocked(state: SiegeState, x: number, y: number, ignoreId?: string): boolean {
  if (!inBounds(state.cols, state.rows, x, y)) return true;
  for (const [id, commander] of Object.entries(state.commanders)) {
    if (commander.left) continue;
    if (commander.castleX === x && commander.castleY === y && id !== ignoreId) return true;
    if (commander.x === x && commander.y === y && id !== ignoreId) return true;
  }
  return state.defenses.some((defense) => defense.x === x && defense.y === y);
}

export function siegeScore(commander: SiegeCommander): number {
  return commander.score + Math.max(0, commander.castleHp);
}

export function finishSiege(state: SiegeState, ctx: GameContext, reason: GameFinishReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.finishReason = reason;
  state.lastEvent = reason === 'timeout' ? 'timeout' : 'finished';
  ctx.markStateChanged();
  ctx.finish(reason);
}

function living(state: SiegeState): Array<[string, SiegeCommander]> {
  return Object.entries(state.commanders).filter(([, commander]) => commander.alive && !commander.left);
}

function maybeLastCastle(state: SiegeState, ctx: GameContext): boolean {
  const alive = living(state);
  if (alive.length <= 1 && Object.keys(state.commanders).length > 0) {
    finishSiege(state, ctx, 'completed');
    return true;
  }
  return false;
}

export function applyFire(
  state: SiegeState,
  attackerId: string,
  col: number,
  row: number,
  now: number,
  damage: number,
): number {
  const attacker = state.commanders[attackerId];
  if (!attacker) return 0;
  for (const defense of state.defenses) {
    if (defense.x === col && defense.y === row) {
      defense.hp -= 1;
      if (defense.hp <= 0) state.defenses = state.defenses.filter((entry) => entry.id !== defense.id);
      attacker.damageDealt += 1;
      attacker.score += 5;
      attacker.lastFireAt = now;
      attacker.energy -= FIRE_COST;
      state.lastEvent = `fire:${attackerId}:defense`;
      return 1;
    }
  }
  for (const [id, commander] of Object.entries(state.commanders)) {
    if (id === attackerId || commander.left) continue;
    if (commander.x === col && commander.y === row && commander.alive) {
      commander.castleHp = Math.max(0, commander.castleHp - Math.floor(damage / 2));
      attacker.damageDealt += damage;
      attacker.score += damage;
      attacker.lastFireAt = now;
      attacker.energy -= FIRE_COST;
      state.lastEvent = `fire:${attackerId}:commander`;
      if (commander.castleHp <= 0) {
        commander.alive = false;
        state.lastEvent = `fall:${id}`;
      }
      return damage;
    }
    if (commander.castleX === col && commander.castleY === row && commander.alive) {
      commander.castleHp = Math.max(0, commander.castleHp - damage);
      attacker.damageDealt += damage;
      attacker.score += damage;
      attacker.lastFireAt = now;
      attacker.energy -= FIRE_COST;
      state.lastEvent = `fire:${attackerId}:castle`;
      if (commander.castleHp <= 0) {
        commander.alive = false;
        state.lastEvent = `fall:${id}`;
      }
      return damage;
    }
  }
  return 0;
}

export function stepSiege(state: SiegeState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  for (const [id, commander] of Object.entries(state.commanders)) {
    if (!commander.alive || commander.left) continue;
    if (state.stepIndex % 2 === 0) commander.energy = Math.min(MAX_ENERGY, commander.energy + 1);
    const node = state.nodes.find((entry) => entry.x === commander.x && entry.y === commander.y);
    if (node) {
      node.holder = id;
      commander.captures += 1;
      commander.score += 2;
    }
  }
  for (const defense of state.defenses) {
    if (defense.kind !== 'tower' || state.stepIndex % 4 !== 0) continue;
    let best: { id: string; dist: number } | null = null;
    for (const [id, commander] of living(state)) {
      if (id === defense.owner) continue;
      const dist = manhattan(defense.x, defense.y, commander.x, commander.y);
      if (dist <= 3 && (!best || dist < best.dist)) best = { id, dist };
    }
    if (best) {
      const target = state.commanders[best.id]!;
      target.castleHp = Math.max(0, target.castleHp - 4);
      const owner = state.commanders[defense.owner];
      if (owner) {
        owner.damageDealt += 4;
        owner.score += 4;
      }
      if (target.castleHp <= 0) {
        target.alive = false;
        state.lastEvent = `fall:${best.id}`;
      }
    }
  }
  state.stepIndex += 1;
  maybeLastCastle(state, ctx);
}

function makeCommander(seat: number, cols: number, rows: number): SiegeCommander {
  const castle = castleAnchors(cols, rows)[seat % 4]!;
  const offset = seat % 2 === 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
  return {
    x: castle.x + offset.x,
    y: castle.y,
    energy: 6,
    castleHp: CASTLE_HP,
    castleX: castle.x,
    castleY: castle.y,
    score: 0,
    damageDealt: 0,
    captures: 0,
    lastFireAt: 0,
    lastBuildAt: 0,
    alive: true,
    disconnected: false,
    left: false,
  };
}

export const castleSiegeGame: GameModule<SiegeState> = {
  metadata: CASTLE_SIEGE_METADATA,

  initialize(): void {
    // Stateless module.
  },

  createInitialState(players): SiegeState {
    const commanders: Record<string, SiegeCommander> = {};
    players.forEach((player, index) => {
      commanders[player.id] = makeCommander(index, SIEGE_COLS, SIEGE_ROWS);
    });
    return {
      phase: 'idle',
      cols: SIEGE_COLS,
      rows: SIEGE_ROWS,
      commanders,
      defenses: [],
      nodes: [
        { x: 6, y: 4, holder: null },
        { x: 7, y: 5, holder: null },
      ],
      stepMs: STEP_MS,
      stepIndex: 0,
      accumulatorMs: 0,
      startedAt: null,
      endsAt: null,
      durationMs: MATCH_MS,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
      defenseSeq: 0,
    };
  },

  playerJoined(player, state): void {
    const existing = state.commanders[player.id];
    if (existing) {
      existing.disconnected = false;
      return;
    }
    state.commanders[player.id] = makeCommander(Object.keys(state.commanders).length, state.cols, state.rows);
  },

  playerReady(): void {
    // Lobby concern.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const commander = state.commanders[playerId];
    if (!commander) return;
    if (reason === 'disconnect') {
      commander.disconnected = true;
      return;
    }
    commander.left = true;
    commander.alive = false;
    if (living(state).length <= 1) finishSiege(state, ctx, 'abandoned');
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    const commanders: Record<string, SiegeCommander> = {};
    ctx.players.forEach((player, index) => {
      commanders[player.id] = makeCommander(index, SIEGE_COLS, SIEGE_ROWS);
    });
    state.commanders = commanders;
    state.defenses = [];
    state.nodes = [
      { x: 6, y: 4, holder: null },
      { x: 7, y: 5, holder: null },
    ];
    state.stepIndex = 0;
    state.accumulatorMs = 0;
    state.defenseSeq = 0;
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = state.startedAt + state.durationMs;
    state.finishReason = null;
    state.lastEvent = 'start';
    ctx.markStateChanged();
    ctx.schedule(state.durationMs, () => finishSiege(state, ctx, 'timeout'), 'gameDuration', 'match-timeout');
  },

  validateAction(playerId, action, state, ctx): ValidationResult {
    if (state.phase !== 'playing') return { valid: false, reason: 'The siege is not running.' };
    const commander = state.commanders[playerId];
    if (!commander || commander.left) return { valid: false, reason: 'You are not in this siege.' };
    if (!commander.alive) return { valid: false, reason: 'Your castle has fallen.' };
    if (action.type === 'move') {
      if (!isSiegeDirection(action.payload?.direction)) return { valid: false, reason: 'Use up, down, left or right.' };
      const d = DELTA[action.payload.direction as SiegeDirection];
      const nx = commander.x + d.dx;
      const ny = commander.y + d.dy;
      if (blocked(state, nx, ny, playerId)) return { valid: false, reason: 'That cell is blocked.' };
      return { valid: true };
    }
    if (action.type === 'build') {
      if (commander.energy < BUILD_COST) return { valid: false, reason: 'Not enough energy.' };
      if (ctx.now() - commander.lastBuildAt < BUILD_COOLDOWN_MS) return { valid: false, reason: 'Build is cooling down.' };
      const col = action.payload?.col;
      const row = action.payload?.row;
      if (typeof col !== 'number' || typeof row !== 'number') return { valid: false, reason: 'Pick a cell.' };
      if (manhattan(commander.x, commander.y, col, row) !== 1) return { valid: false, reason: 'Build on an adjacent cell.' };
      if (blocked(state, col, row) || occupiedCells(state).has(`${col},${row}`)) {
        return { valid: false, reason: 'That cell is occupied.' };
      }
      return { valid: true };
    }
    if (action.type === 'upgrade') {
      if (commander.energy < UPGRADE_COST) return { valid: false, reason: 'Not enough energy.' };
      const wall = state.defenses.find(
        (defense) => defense.owner === playerId && defense.kind === 'wall' && manhattan(commander.x, commander.y, defense.x, defense.y) <= 1,
      );
      if (!wall) return { valid: false, reason: 'Stand next to a wall you own.' };
      return { valid: true };
    }
    if (action.type === 'fire') {
      if (commander.energy < FIRE_COST) return { valid: false, reason: 'Not enough energy.' };
      if (ctx.now() - commander.lastFireAt < FIRE_COOLDOWN_MS) return { valid: false, reason: 'The cannon is cooling down.' };
      const col = action.payload?.col;
      const row = action.payload?.row;
      if (typeof col !== 'number' || typeof row !== 'number') return { valid: false, reason: 'Pick a target cell.' };
      if (col === commander.castleX && row === commander.castleY) return { valid: false, reason: 'Do not fire on your own keep.' };
      if (manhattan(commander.x, commander.y, col, row) > FIRE_RANGE) return { valid: false, reason: 'Out of range.' };
      return { valid: true };
    }
    if (action.type === 'capture') {
      const node = state.nodes.find((entry) => entry.x === commander.x && entry.y === commander.y);
      if (!node) return { valid: false, reason: 'Stand on a capture node.' };
      return { valid: true };
    }
    return { valid: false, reason: 'Unknown action.' };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    const commander = state.commanders[playerId];
    if (!commander || state.phase !== 'playing' || !commander.alive) return actionRejected('You cannot act.');
    const now = ctx.now();
    if (action.type === 'move') {
      const direction = action.payload?.direction;
      if (!isSiegeDirection(direction)) return actionRejected('Invalid direction.');
      const d = DELTA[direction];
      const nx = commander.x + d.dx;
      const ny = commander.y + d.dy;
      if (blocked(state, nx, ny, playerId)) return actionRejected('Blocked.');
      commander.x = nx;
      commander.y = ny;
      state.lastEvent = `move:${playerId}`;
      ctx.markStateChanged();
      return actionAccepted();
    }
    if (action.type === 'build') {
      const col = Number(action.payload?.col);
      const row = Number(action.payload?.row);
      commander.energy -= BUILD_COST;
      commander.lastBuildAt = now;
      state.defenseSeq += 1;
      state.defenses.push({ id: `d${state.defenseSeq}`, x: col, y: row, owner: playerId, kind: 'wall', hp: 3 });
      state.lastEvent = `build:${playerId}`;
      ctx.markStateChanged();
      return actionAccepted();
    }
    if (action.type === 'upgrade') {
      const wall = state.defenses.find(
        (defense) => defense.owner === playerId && defense.kind === 'wall' && manhattan(commander.x, commander.y, defense.x, defense.y) <= 1,
      );
      if (!wall) return actionRejected('No wall to upgrade.');
      commander.energy -= UPGRADE_COST;
      wall.kind = 'tower';
      wall.hp = 4;
      state.lastEvent = `upgrade:${playerId}`;
      ctx.markStateChanged();
      return actionAccepted();
    }
    if (action.type === 'fire') {
      const col = Number(action.payload?.col);
      const row = Number(action.payload?.row);
      const dealt = applyFire(state, playerId, col, row, now, 12);
      if (dealt === 0) {
        commander.energy -= FIRE_COST;
        commander.lastFireAt = now;
        state.lastEvent = `miss:${playerId}`;
      }
      ctx.markStateChanged();
      maybeLastCastle(state, ctx);
      return actionAccepted();
    }
    if (action.type === 'capture') {
      const node = state.nodes.find((entry) => entry.x === commander.x && entry.y === commander.y);
      if (!node) return actionRejected('Not on a node.');
      if (node.holder === playerId) return actionAccepted(false);
      node.holder = playerId;
      commander.captures += 1;
      commander.score += 15;
      state.lastEvent = `capture:${playerId}`;
      ctx.markStateChanged();
      return actionAccepted();
    }
    return actionRejected('Unknown action.');
  },

  update(state, deltaTimeMs, ctx): void {
    if (state.phase !== 'playing') return;
    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const commander = state.commanders[player.id];
      if (!commander?.alive || commander.left) continue;
      const now = ctx.now();
      const difficulty = player.aiDifficulty ?? 'medium';
      if (now >= (state.nextAIRequestAt[player.id] ?? 0)) {
        ctx.requestAI(player.id, 50);
        state.nextAIRequestAt[player.id] = now + AI_INTERVAL[difficulty];
      }
    }
    state.accumulatorMs += deltaTimeMs;
    let guard = 0;
    while (state.accumulatorMs >= state.stepMs && state.phase === 'playing' && guard < 4) {
      state.accumulatorMs -= state.stepMs;
      guard += 1;
      stepSiege(state, ctx);
    }
  },

  tick(): void {
    // Handled by update().
  },

  calculateScore(playerId, state): number {
    const commander = state.commanders[playerId];
    return commander ? siegeScore(commander) : 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const alive = living(state);
    if (alive.length === 1) return [alive[0]![0]];
    const entries = Object.entries(state.commanders).map(([id, commander]) => [id, siegeScore(commander)] as const);
    if (entries.length === 0) return [];
    const best = Math.max(...entries.map(([, n]) => n));
    return entries.filter(([, n]) => n === best).map(([id]) => id);
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
    const ranked = [...ctx.players].sort((a, b) => siegeScore(state.commanders[b.id]!) - siegeScore(state.commanders[a.id]!));
    const alive = living(state);
    const winners =
      alive.length === 1
        ? [alive[0]![0]]
        : ranked.filter((player) => siegeScore(state.commanders[player.id]!) === siegeScore(state.commanders[ranked[0]!.id]!)).map((player) => player.id);
    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const commander = state.commanders[player.id];
      return {
        playerId: player.id,
        rank: index + 1,
        score: commander ? siegeScore(commander) : 0,
        isWinner: winners.includes(player.id),
        isDraw: winners.length > 1,
        stats: {
          castleHp: commander?.castleHp ?? 0,
          damage: commander?.damageDealt ?? 0,
          captures: commander?.captures ?? 0,
        },
      };
    });
    return { winners, isDraw: winners.length > 1, rankings, reason: state.finishReason ?? 'completed' };
  },

  reset(state): SiegeState {
    const seats = Object.keys(state.commanders);
    const commanders: Record<string, SiegeCommander> = {};
    seats.forEach((id, index) => {
      commanders[id] = makeCommander(index, state.cols, state.rows);
    });
    return {
      ...state,
      phase: 'idle',
      commanders,
      defenses: [],
      nodes: state.nodes.map((node) => ({ ...node, holder: null })),
      stepIndex: 0,
      accumulatorMs: 0,
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
      defenseSeq: 0,
    };
  },

  cleanup(state): void {
    state.commanders = {};
    state.defenses = [];
    state.phase = 'finished';
  },

  getPublicState(state, _viewerId, ctx) {
    return {
      phase: state.phase,
      cols: state.cols,
      rows: state.rows,
      stepMs: state.stepMs,
      stepIndex: state.stepIndex,
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      durationMs: state.durationMs,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      nodes: state.nodes.map((node) => ({ ...node })),
      defenses: state.defenses.map((defense) => ({ ...defense })),
      commanders: Object.fromEntries(
        Object.entries(state.commanders).map(([id, commander]) => [
          id,
          {
            x: commander.x,
            y: commander.y,
            energy: commander.energy,
            castleHp: commander.castleHp,
            castleX: commander.castleX,
            castleY: commander.castleY,
            score: siegeScore(commander),
            captures: commander.captures,
            alive: commander.alive,
            disconnected: commander.disconnected,
          },
        ]),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, _ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const commander = state.commanders[playerId];
    if (!commander?.alive || commander.left) return null;
    const enemies = living(state).filter(([id]) => id !== playerId);
    if (difficulty !== 'easy' && commander.energy >= FIRE_COST && enemies.length > 0) {
      const enemy = enemies[0]![1];
      if (manhattan(commander.x, commander.y, enemy.castleX, enemy.castleY) <= FIRE_RANGE) {
        return { type: 'fire', payload: { col: enemy.castleX, row: enemy.castleY } };
      }
      if (manhattan(commander.x, commander.y, enemy.x, enemy.y) <= FIRE_RANGE) {
        return { type: 'fire', payload: { col: enemy.x, row: enemy.y } };
      }
    }
    const node = state.nodes.find((entry) => entry.holder !== playerId) ?? state.nodes[0];
    if (node && commander.x === node.x && commander.y === node.y) {
      return { type: 'capture' };
    }
    const target = node ?? { x: commander.castleX, y: commander.castleY };
    const options = ALL_DIRS.filter((dir) => {
      const n = { x: commander.x + DELTA[dir].dx, y: commander.y + DELTA[dir].dy };
      return !blocked(state, n.x, n.y, playerId);
    });
    if (options.length === 0) return null;
    const scored = options.map((dir) => {
      const n = { x: commander.x + DELTA[dir].dx, y: commander.y + DELTA[dir].dy };
      return { dir, dist: manhattan(n.x, n.y, target.x, target.y) };
    });
    scored.sort((a, b) => a.dist - b.dist);
    return { type: 'move', payload: { direction: scored[0]!.dir } };
  },

  needsUpdateLoop: true,
  maxDurationMs: 6 * 60 * 1000,
};
