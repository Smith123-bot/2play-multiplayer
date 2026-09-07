import type { GameAction, GameConfig, GameFinishReason } from '@2play/shared';
import { CAPTURE_THE_FLAG_METADATA } from '@2play/shared';
export { CAPTURE_THE_FLAG_METADATA };
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
 * Capture the Flag 2D — team arena duel on a server-built grid.
 *
 * The arena (symmetric walls from the match seed), bases, flags, carriers,
 * tags and captures are ALL server state. Clients send one-cell move intents;
 * the server validates bounds, walls, cooldowns, pickups, tags and captures.
 * Teams are derived from seat parity (no separate room system needed):
 * 2 players → 1v1, 4 players → seats 1&3 vs 2&4.
 */

export type CTFPhase = 'idle' | 'playing' | 'finished';
export type CTFTeam = 'A' | 'B';
export type CTFDirection = 'up' | 'down' | 'left' | 'right';

export interface CTFPlayerState {
  x: number;
  y: number;
  team: CTFTeam;
  /** Which team's flag this player is carrying (null = none). */
  carrying: CTFTeam | null;
  /** Epoch ms until the respawn gate opens (null = on the field). */
  respawnAt: number | null;
  steps: number;
  captures: number;
  tags: number;
  disconnected: boolean;
  left: boolean;
  lastMoveAt: number;
}

export interface CTFFlag {
  owner: CTFTeam;
  x: number;
  y: number;
  carrier: string | null;
}

export interface CaptureTheFlagState {
  phase: CTFPhase;
  cols: number;
  rows: number;
  walls: boolean[];
  bases: Record<CTFTeam, { x: number; y: number }>;
  flags: Record<CTFTeam, CTFFlag>;
  players: Record<string, CTFPlayerState>;
  scores: Record<CTFTeam, number>;
  capturesToWin: number;
  moveCooldownMs: number;
  respawnMs: number;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: GameFinishReason | null;
  lastEvent: string | null;
  seed: number;
  nextAIRequestAt: Record<string, number>;
}

const COLS = 15;
const ROWS = 15;
const BASE_A = { x: 1, y: ROWS - 2 };
const BASE_B = { x: COLS - 2, y: 1 };
const CAPTURES_TO_WIN = 3;
const MOVE_COOLDOWN_MS = 130;
const RESPAWN_MS = 2500;
const MATCH_MS = 3 * 60 * 1000;
const AI_REQUEST_INTERVAL_MS = 320;

const DIRECTIONS: Record<CTFDirection, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export function isCTFDirection(value: unknown): value is CTFDirection {
  return value === 'up' || value === 'down' || value === 'left' || value === 'right';
}

/** Seeded PRNG (mulberry32). */
export function createCTFRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function teamForSeat(seatIndex: number): CTFTeam {
  // 2 players: seat 0 vs seat 1. 4 players: seats 0,2 vs 1,3.
  return seatIndex % 2 === 0 ? 'A' : 'B';
}

/**
 * Builds the symmetric arena: border walls + mirrored interior obstacles.
 * Deterministic from the rng. Exported for tests.
 */
export function generateArena(rng: () => number): boolean[] {
  const walls = Array<boolean>(COLS * ROWS).fill(false);
  const at = (x: number, y: number) => y * COLS + x;

  for (let x = 0; x < COLS; x += 1) {
    walls[at(x, 0)] = true;
    walls[at(x, ROWS - 1)] = true;
  }
  for (let y = 0; y < ROWS; y += 1) {
    walls[at(0, y)] = true;
    walls[at(COLS - 1, y)] = true;
  }

  // Random obstacle blocks in the top-left quadrant, mirrored 180° so the
  // arena is perfectly fair for both teams.
  const mirror = (x: number, y: number) => ({ x: COLS - 1 - x, y: ROWS - 1 - y });
  for (let attempt = 0; attempt < 14; attempt += 1) {
    const x = 2 + Math.floor(rng() * (COLS / 2 - 3));
    const y = 2 + Math.floor(rng() * (ROWS / 2 - 3));
    const w = 1 + Math.floor(rng() * 2);
    const h = 1 + Math.floor(rng() * 2);
    for (let dx = 0; dx < w; dx += 1) {
      for (let dy = 0; dy < h; dy += 1) {
        const cell = { x: x + dx, y: y + dy };
        const flipped = mirror(cell.x, cell.y);
        // Never wall off the bases or their direct neighbourhood.
        const nearBase = (cx: number, cy: number) =>
          (Math.abs(cx - BASE_A.x) <= 1 && Math.abs(cy - BASE_A.y) <= 1) ||
          (Math.abs(cx - BASE_B.x) <= 1 && Math.abs(cy - BASE_B.y) <= 1);
        if (nearBase(cell.x, cell.y) || nearBase(flipped.x, flipped.y)) continue;
        walls[at(cell.x, cell.y)] = true;
        walls[at(flipped.x, flipped.y)] = true;
      }
    }
  }
  return walls;
}

/** Breadth-first distances from a cell across floor cells. -1 = walled/unreachable. */
export function bfsDistances(
  walls: boolean[],
  from: { x: number; y: number },
): number[] {
  const distance = Array<number>(COLS * ROWS).fill(-1);
  const at = (x: number, y: number) => y * COLS + x;
  if (walls[at(from.x, from.y)]) return distance;
  const queue: Array<{ x: number; y: number }> = [from];
  distance[at(from.x, from.y)] = 0;
  while (queue.length > 0) {
    const cell = queue.shift()!;
    for (const delta of Object.values(DIRECTIONS)) {
      const nx = cell.x + delta.dx;
      const ny = cell.y + delta.dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const index = at(nx, ny);
      if (walls[index] || distance[index] !== -1) continue;
      distance[index] = distance[at(cell.x, cell.y)]! + 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return distance;
}

/** Timer callback: the round clock expired. Exported for tests. */
export function finishCTFOnTimeout(state: CaptureTheFlagState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  state.phase = 'finished';
  state.finishReason = 'timeout';
  state.lastEvent = 'timeout';
  ctx.markStateChanged();
  ctx.finish('timeout');
}

function canMoveTo(state: CaptureTheFlagState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return false;
  return !state.walls[y * state.cols + x];
}

function teamBase(team: CTFTeam): { x: number; y: number } {
  return team === 'A' ? BASE_A : BASE_B;
}

function onBase(team: CTFTeam, x: number, y: number): boolean {
  const base = teamBase(team);
  return base.x === x && base.y === y;
}

/** Applies tag rules: the mover tags opponents standing on their new cell. */
function applyTags(state: CaptureTheFlagState, moverId: string, ctx: GameContext): number {
  const mover = state.players[moverId]!;
  let tags = 0;
  for (const [playerId, player] of Object.entries(state.players)) {
    if (playerId === moverId) continue;
    if (player.team === mover.team || player.left) continue;
    if (player.x !== mover.x || player.y !== mover.y) continue;
    if (onBase(player.team, player.x, player.y)) continue; // base = safe zone
    // Tagged: respawn at own base, carried flag returns home.
    if (player.carrying !== null) {
      const flag = state.flags[player.carrying];
      if (flag) {
        flag.carrier = null;
        flag.x = teamBase(flag.owner).x;
        flag.y = teamBase(flag.owner).y;
      }
      player.carrying = null;
    }
    player.respawnAt = ctx.now() + state.respawnMs;
    player.x = teamBase(player.team).x;
    player.y = teamBase(player.team).y;
    player.lastMoveAt = ctx.now();
    tags += 1;
  }
  if (tags > 0) mover.tags += tags;
  return tags;
}

/** Checks pickup + capture for a player's new cell. Returns 'capture' | 'pickup' | null. */
function applyFlagRules(state: CaptureTheFlagState, playerId: string, ctx: GameContext): 'capture' | 'pickup' | null {
  const player = state.players[playerId]!;
  const enemyFlag = state.flags[player.team === 'A' ? 'B' : 'A'];

  // Capture: carrying the enemy flag onto my own base.
  if (
    player.carrying !== null &&
    onBase(player.team, player.x, player.y)
  ) {
    const flag = state.flags[player.carrying];
    if (flag) {
      flag.carrier = null;
      flag.x = teamBase(flag.owner).x;
      flag.y = teamBase(flag.owner).y;
    }
    state.scores[player.team] += 1;
    player.captures += 1;
    player.carrying = null;
    state.lastEvent = `capture:${playerId}`;
    ctx.markStateChanged();
    return 'capture';
  }

  // Pickup: stepping onto the idle enemy flag.
  if (
    player.carrying === null &&
    enemyFlag.carrier === null &&
    enemyFlag.x === player.x &&
    enemyFlag.y === player.y
  ) {
    enemyFlag.carrier = playerId;
    player.carrying = enemyFlag.owner;
    state.lastEvent = `pickup:${playerId}`;
    ctx.markStateChanged();
    return 'pickup';
  }
  return null;
}

function endIfOver(state: CaptureTheFlagState, ctx: GameContext): void {
  if (state.phase !== 'playing') return;
  if (state.scores.A >= state.capturesToWin || state.scores.B >= state.capturesToWin) {
    state.phase = 'finished';
    state.finishReason = 'completed';
    state.lastEvent = 'won';
    ctx.markStateChanged();
    ctx.finish('completed');
  }
}

function activeTeamPlayers(state: CaptureTheFlagState, team: CTFTeam): number {
  return Object.values(state.players).filter((player) => player.team === team && !player.left).length;
}

/* ------------------------------------------------------------------ */
/* Module                                                              */
/* ------------------------------------------------------------------ */

export const captureTheFlagGame: GameModule<CaptureTheFlagState> = {
  metadata: CAPTURE_THE_FLAG_METADATA,

  initialize(_config: GameConfig): void {
    // Stateless module.
  },

  createInitialState(players, _config): CaptureTheFlagState {
    return {
      phase: 'idle',
      cols: COLS,
      rows: ROWS,
      walls: Array<boolean>(COLS * ROWS).fill(false),
      bases: { A: { ...BASE_A }, B: { ...BASE_B } },
      flags: {
        A: { owner: 'A', x: BASE_A.x, y: BASE_A.y, carrier: null },
        B: { owner: 'B', x: BASE_B.x, y: BASE_B.y, carrier: null },
      },
      players: Object.fromEntries(
        players.map((player) => {
          const team = teamForSeat(player.seatIndex);
          const base = team === 'A' ? BASE_A : BASE_B;
          return [
            player.id,
            {
              x: base.x,
              y: base.y,
              team,
              carrying: null,
              respawnAt: null,
              steps: 0,
              captures: 0,
              tags: 0,
              disconnected: false,
              left: false,
              lastMoveAt: 0,
            } satisfies CTFPlayerState,
          ];
        }),
      ),
      scores: { A: 0, B: 0 },
      capturesToWin: CAPTURES_TO_WIN,
      moveCooldownMs: MOVE_COOLDOWN_MS,
      respawnMs: RESPAWN_MS,
      startedAt: null,
      endsAt: null,
      durationMs: MATCH_MS,
      finishReason: null,
      lastEvent: null,
      seed: 0,
      nextAIRequestAt: {},
    };
  },

  playerJoined(player, state): void {
    if (!state.players[player.id]) {
      const team = teamForSeat(player.seatIndex);
      const base = state.bases[team];
      state.players[player.id] = {
        x: base.x,
        y: base.y,
        team,
        carrying: null,
        respawnAt: null,
        steps: 0,
        captures: 0,
        tags: 0,
        disconnected: false,
        left: false,
        lastMoveAt: 0,
      };
    }
  },

  playerReady(): void {
    // No per-player readiness behaviour.
  },

  playerLeft(playerId, state, ctx, reason): void {
    const player = state.players[playerId];
    if (!player) return;
    if (reason === 'disconnect') {
      player.disconnected = true;
      return;
    }
    player.left = true;
    player.disconnected = false;
    if (player.carrying !== null) {
      const flag = state.flags[player.carrying];
      if (flag) {
        flag.carrier = null;
        flag.x = state.bases[flag.owner].x;
        flag.y = state.bases[flag.owner].y;
      }
      player.carrying = null;
    }
    state.lastEvent = `left:${playerId}`;
    if (
      state.phase === 'playing' &&
      (activeTeamPlayers(state, 'A') === 0 || activeTeamPlayers(state, 'B') === 0)
    ) {
      state.phase = 'finished';
      state.finishReason = 'completed';
      ctx.markStateChanged();
      ctx.finish('completed');
    }
  },

  start(state, ctx): void {
    if (state.phase === 'playing') return;
    const seed = ctx.seed;
    const rng = createCTFRandom(seed);
    state.walls = generateArena(rng);
    state.seed = seed;

    state.players = {};
    ctx.players.forEach((player) => {
      const team = teamForSeat(player.seatIndex);
      const base = state.bases[team];
      state.players[player.id] = {
        x: base.x,
        y: base.y,
        team,
        carrying: null,
        respawnAt: null,
        steps: 0,
        captures: 0,
        tags: 0,
        disconnected: false,
        left: false,
        lastMoveAt: 0,
      };
    });

    state.flags = {
      A: { owner: 'A', x: state.bases.A.x, y: state.bases.A.y, carrier: null },
      B: { owner: 'B', x: state.bases.B.x, y: state.bases.B.y, carrier: null },
    };
    state.scores = { A: 0, B: 0 };
    state.phase = 'playing';
    state.startedAt = ctx.now();
    state.endsAt = state.startedAt + state.durationMs;
    state.finishReason = null;
    state.lastEvent = 'start';
    state.nextAIRequestAt = {};
    ctx.markStateChanged();

    ctx.schedule(
      state.durationMs,
      () => finishCTFOnTimeout(state, ctx),
      'gameDuration',
      'match-timeout',
    );
  },

  validateAction(playerId, action, state): ValidationResult {
    if (action.type !== 'move') return { valid: false, reason: 'Unknown action.' };
    const direction = action.payload?.direction;
    if (!isCTFDirection(direction)) {
      return { valid: false, reason: 'Invalid direction — use up, down, left or right.' };
    }
    if (state.phase !== 'playing') return { valid: false, reason: 'The match is not running.' };
    const player = state.players[playerId];
    if (!player) return { valid: false, reason: 'You are not part of this match.' };
    if (player.left) return { valid: false, reason: 'You left this match.' };
    if (player.respawnAt !== null) return { valid: false, reason: 'Respawning…' };
    const { dx, dy } = DIRECTIONS[direction];
    if (!canMoveTo(state, player.x + dx, player.y + dy)) {
      return { valid: false, reason: 'A wall blocks that way.' };
    }
    return { valid: true };
  },

  handlePlayerAction(playerId, action, state, ctx): ActionResult {
    if (action.type !== 'move') return actionRejected('Unknown action.');
    const direction = action.payload?.direction;
    if (!isCTFDirection(direction)) return actionRejected('Invalid direction.');
    const player = state.players[playerId];
    if (!player) return actionRejected('You are not part of this match.');
    if (player.respawnAt !== null) return actionRejected('Respawning…');
    const { dx, dy } = DIRECTIONS[direction];
    if (!canMoveTo(state, player.x + dx, player.y + dy)) {
      return actionRejected('A wall blocks that way.');
    }
    const now = ctx.now();
    if (now - player.lastMoveAt < state.moveCooldownMs) {
      return actionRejected('Too fast — one cell at a time.');
    }

    player.x += dx;
    player.y += dy;
    player.steps += 1;
    player.lastMoveAt = now;
    state.lastEvent = `move:${playerId}`;

    const flagEvent = applyFlagRules(state, playerId, ctx);
    const tags = applyTags(state, playerId, ctx);
    if (flagEvent || tags > 0) ctx.markStateChanged();
    endIfOver(state, ctx);
    return actionAccepted();
  },

  update(): void {
    // Event-driven movement. (AI pacing handled in tick below.)
  },

  tick(state, ctx): void {
    // Ask AI seats to move periodically through the standard pipeline.
    if (state.phase !== 'playing') return;
    for (const player of ctx.players) {
      if (!player.isAI) continue;
      const ctfPlayer = state.players[player.id];
      if (!ctfPlayer || ctfPlayer.left) continue;
      const now = ctx.now();
      if (now >= (state.nextAIRequestAt[player.id] ?? 0)) {
        ctx.requestAI(player.id, 60);
        state.nextAIRequestAt[player.id] = now + AI_REQUEST_INTERVAL_MS;
      }
    }
  },

  calculateScore(playerId, state): number {
    const player = state.players[playerId];
    return player ? state.scores[player.team] : 0;
  },

  checkWinCondition(state): string[] | null {
    if (state.phase !== 'finished') return null;
    const winners: string[] = [];
    for (const [playerId, player] of Object.entries(state.players)) {
      if (player.left) continue;
      if (
        (state.scores.A > state.scores.B && player.team === 'A') ||
        (state.scores.B > state.scores.A && player.team === 'B')
      ) {
        winners.push(playerId);
      }
    }
    return winners.length > 0 ? winners : null;
  },

  checkDrawCondition(state): boolean {
    if (state.phase !== 'finished') return false;
    return state.scores.A === state.scores.B;
  },

  isGameFinished(state): boolean {
    return state.phase === 'finished';
  },

  finish(state): void {
    state.phase = 'finished';
  },

  getResult(state, ctx): GameResultDraft {
    const aWon = state.scores.A > state.scores.B;
    const bWon = state.scores.B > state.scores.A;
    const draw = !aWon && !bWon;

    const ranked = [...ctx.players].sort((a, b) => {
      const aPlayer = state.players[a.id];
      const bPlayer = state.players[b.id];
      const aTeam = aPlayer ? (aWon && aPlayer.team === 'A') || (bWon && aPlayer.team === 'B') : false;
      const bTeam = bPlayer ? (aWon && bPlayer.team === 'A') || (bWon && bPlayer.team === 'B') : false;
      if (aTeam !== bTeam) return aTeam ? -1 : 1;
      const capturesDiff = (bPlayer?.captures ?? 0) - (aPlayer?.captures ?? 0);
      if (capturesDiff !== 0) return capturesDiff;
      const tagsDiff = (bPlayer?.tags ?? 0) - (aPlayer?.tags ?? 0);
      if (tagsDiff !== 0) return tagsDiff;
      return a.seatIndex - b.seatIndex;
    });

    const winners = draw
      ? []
      : ranked
          .filter((player) => {
            const ctfPlayer = state.players[player.id];
            if (!ctfPlayer) return false;
            return (aWon && ctfPlayer.team === 'A') || (bWon && ctfPlayer.team === 'B');
          })
          .map((player) => player.id);

    const rankings: RankingDraft[] = ranked.map((player, index) => {
      const ctfPlayer = state.players[player.id];
      return {
        playerId: player.id,
        rank: index + 1,
        score: ctfPlayer ? state.scores[ctfPlayer.team] : 0,
        isWinner: winners.includes(player.id),
        isDraw: draw,
        stats: {
          captures: ctfPlayer?.captures ?? 0,
          tags: ctfPlayer?.tags ?? 0,
          steps: ctfPlayer?.steps ?? 0,
        },
      };
    });

    return {
      winners,
      isDraw: draw,
      rankings,
      reason: state.finishReason ?? 'completed',
    };
  },

  reset(state): CaptureTheFlagState {
    const seats = Object.keys(state.players);
    return {
      ...state,
      phase: 'idle',
      players: Object.fromEntries(
        seats.map((playerId) => {
          const player = state.players[playerId]!;
          const base = state.bases[player.team];
          return [
            playerId,
            {
              ...player,
              x: base.x,
              y: base.y,
              carrying: null,
              respawnAt: null,
              steps: 0,
              captures: 0,
              tags: 0,
              disconnected: false,
              left: false,
              lastMoveAt: 0,
            } satisfies CTFPlayerState,
          ];
        }),
      ),
      flags: {
        A: { owner: 'A', x: state.bases.A.x, y: state.bases.A.y, carrier: null },
        B: { owner: 'B', x: state.bases.B.x, y: state.bases.B.y, carrier: null },
      },
      scores: { A: 0, B: 0 },
      startedAt: null,
      endsAt: null,
      finishReason: null,
      lastEvent: null,
      nextAIRequestAt: {},
    };
  },

  cleanup(state): void {
    state.players = {};
    state.phase = 'finished';
  },

  /** The arena is public (everyone fights in it); the seed stays private. */
  getPublicState(state, _viewerId, ctx) {
    return {
      phase: state.phase,
      cols: state.cols,
      rows: state.rows,
      walls: [...state.walls],
      bases: { A: { ...state.bases.A }, B: { ...state.bases.B } },
      flags: {
        A: { ...state.flags.A },
        B: { ...state.flags.B },
      },
      scores: { ...state.scores },
      capturesToWin: state.capturesToWin,
      respawnMs: state.respawnMs,
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      finishReason: state.finishReason,
      lastEvent: state.lastEvent,
      serverTime: ctx.now(),
      players: Object.fromEntries(
        ctx.players.map((player) => {
          const ctfPlayer = state.players[player.id];
          return [
            player.id,
            ctfPlayer
              ? {
                  x: ctfPlayer.x,
                  y: ctfPlayer.y,
                  team: ctfPlayer.team,
                  carrying: ctfPlayer.carrying,
                  respawnAt: ctfPlayer.respawnAt,
                  steps: ctfPlayer.steps,
                  captures: ctfPlayer.captures,
                  tags: ctfPlayer.tags,
                  disconnected: ctfPlayer.disconnected,
                }
              : null,
          ];
        }),
      ),
    };
  },

  getAIMove(playerId, difficulty, state, ctx): GameAction | null {
    if (state.phase !== 'playing') return null;
    const player = state.players[playerId];
    if (!player || player.left) return null;
    if (player.respawnAt !== null) return null;

    // Objective: carrying → my base; else → enemy flag (idle or carried).
    let target: { x: number; y: number };
    if (player.carrying !== null) {
      target = state.bases[player.team];
    } else {
      const enemyFlag = state.flags[player.team === 'A' ? 'B' : 'A'];
      if (enemyFlag.carrier !== null && enemyFlag.carrier !== playerId) {
        // Our flag is stolen → chase the thief.
        const thief = state.players[enemyFlag.carrier];
        target = thief ? { x: thief.x, y: thief.y } : state.bases[enemyFlag.owner];
      } else {
        target = { x: enemyFlag.x, y: enemyFlag.y };
      }
    }

    const distances = bfsDistances(state.walls, target);
    const here = distances[player.y * state.cols + player.x] ?? -1;
    let best: CTFDirection | null = null;
    let bestDistance = here;
    for (const direction of Object.keys(DIRECTIONS) as CTFDirection[]) {
      const { dx, dy } = DIRECTIONS[direction];
      const nx = player.x + dx;
      const ny = player.y + dy;
      if (!canMoveTo(state, nx, ny)) continue;
      const distance = distances[ny * state.cols + nx] ?? -1;
      if (distance >= 0 && distance < bestDistance) {
        bestDistance = distance;
        best = direction;
      }
    }
    // Easy AI sometimes ignores the objective and wanders.
    const legal = (Object.keys(DIRECTIONS) as CTFDirection[]).filter((direction) => {
      const { dx, dy } = DIRECTIONS[direction];
      return canMoveTo(state, player.x + dx, player.y + dy);
    });
    if (legal.length === 0) return null;
    if (best && difficulty !== 'easy') return { type: 'move', payload: { direction: best } };
    if (best && difficulty === 'easy' && ctx.random() > 0.25) {
      return { type: 'move', payload: { direction: best } };
    }
    return { type: 'move', payload: { direction: legal[Math.floor(ctx.random() * legal.length)]! } };
  },

  maxDurationMs: 8 * 60 * 1000,
};
