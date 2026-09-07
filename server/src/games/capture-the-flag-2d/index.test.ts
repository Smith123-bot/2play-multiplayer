import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  bfsDistances,
  captureTheFlagGame,
  createCTFRandom,
  finishCTFOnTimeout,
  generateArena,
  teamForSeat,
  type CTFDirection,
  type CaptureTheFlagState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Capture the Flag 2D', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'capture-the-flag-2d');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as CaptureTheFlagState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      walls: boolean[];
      bases: Record<string, { x: number; y: number }>;
      flags: Record<string, { x: number; y: number; carrier: string | null }>;
      scores: Record<string, number>;
      players: Record<string, { x: number; y: number; team: string; carrying: string | null; respawnAt: number | null } | null>;
    };

  /* ---------------------------------------------------------------- */
  /* Arena generation                                                  */
  /* ---------------------------------------------------------------- */

  it('generates symmetric arenas with solid borders and clear bases', () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const walls = generateArena(createCTFRandom(seed));
      // Borders solid.
      for (let x = 0; x < 15; x += 1) {
        expect(walls[x]).toBe(true);
        expect(walls[14 * 15 + x]).toBe(true);
      }
      for (let y = 0; y < 15; y += 1) {
        expect(walls[y * 15]).toBe(true);
        expect(walls[y * 15 + 14]).toBe(true);
      }
      // 180° symmetry (fair arena).
      for (let y = 0; y < 15; y += 1) {
        for (let x = 0; x < 15; x += 1) {
          expect(walls[y * 15 + x]).toBe(walls[(14 - y) * 15 + (14 - x)]);
        }
      }
      // Bases are open floor.
      expect(walls[13 * 15 + 1]).toBe(false); // base A (1,13)
      expect(walls[1 * 15 + 13]).toBe(false); // base B (13,1)
      // Both bases can reach each other.
      const distances = bfsDistances(walls, { x: 1, y: 13 });
      expect(distances[1 * 15 + 13]).toBeGreaterThan(0);
    }
  });

  it('assigns teams by seat parity', () => {
    expect(teamForSeat(0)).toBe('A');
    expect(teamForSeat(1)).toBe('B');
    expect(teamForSeat(2)).toBe('A');
    expect(teamForSeat(3)).toBe('B');
  });

  it('starts playing with players on their bases and flags home', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    expect(state().walls).toHaveLength(225);
    expect(state().scores).toEqual({ A: 0, B: 0 });
    const [a, b] = players.map((player) => state().players[player.id]!);
    expect(a.team).toBe('A');
    expect(b.team).toBe('B');
    expect(a.x).toBe(1);
    expect(a.y).toBe(13);
    expect(b.x).toBe(13);
    expect(b.y).toBe(1);
    expect(state().flags.A.carrier).toBeNull();
    expect(state().flags.B.carrier).toBeNull();
    expect(state().startedAt).toBeGreaterThan(0);
  });

  /* ---------------------------------------------------------------- */
  /* Movement validation                                               */
  /* ---------------------------------------------------------------- */

  it('accepts legal moves with cooldown pacing and rejects walls/teleports/spam', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const player = state().players[playerId]!; // at base A (1,13)

    expect(
      captureTheFlagGame.validateAction(playerId, { type: 'dash' }, state(), context()).valid,
    ).toBe(false);
    expect(
      captureTheFlagGame.validateAction(
        playerId,
        { type: 'move', payload: { direction: 'diag' } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
    expect(captureTheFlagGame.validateAction(playerId, { type: 'move' }, state(), context()).valid).toBe(
      false,
    );
    expect(
      captureTheFlagGame.validateAction('ghost', { type: 'move', payload: { direction: 'up' } }, state(), context())
        .valid,
    ).toBe(false);

    const up = platform.gameManager.handleAction(room, playerId, {
      type: 'move',
      payload: { direction: 'up' },
    });
    expect(up.accepted).toBe(true);
    expect(player.x).toBe(1);
    expect(player.y).toBe(12);
    expect(player.steps).toBe(1);

    // Move cooldown prevents instant teleport chains.
    const spam = platform.gameManager.handleAction(room, playerId, {
      type: 'move',
      payload: { direction: 'up' },
    });
    expect(spam.accepted).toBe(false);
    expect(spam.reason).toBe('Too fast — one cell at a time.');

    // Left border wall blocks movement out of the arena.
    player.lastMoveAt = 0;
    const wall = platform.gameManager.handleAction(room, playerId, {
      type: 'move',
      payload: { direction: 'left' },
    });
    expect(wall.accepted).toBe(false);
    expect(wall.reason).toBe('A wall blocks that way.');
  });

  /* ---------------------------------------------------------------- */
  /* Flag rules                                                        */
  /* ---------------------------------------------------------------- */

  it('picks up the enemy flag by stepping on it', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id; // team A
    const player = state().players[playerId]!;
    const enemyFlag = state().flags.B;

    player.x = enemyFlag.x;
    player.y = enemyFlag.y - 1;
    const result = platform.gameManager.handleAction(room, playerId, {
      type: 'move',
      payload: { direction: 'down' },
    });
    expect(result.accepted).toBe(true);
    expect(enemyFlag.carrier).toBe(playerId);
    expect(player.carrying).toBe('B');
    expect(state().lastEvent).toBe(`pickup:${playerId}`);
  });

  it('captures by carrying the enemy flag onto my base and finishes at 3', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id; // team A
    const player = state().players[playerId]!;

    // Simulate two earlier captures, then score the third.
    state().scores.A = 2;
    player.captures = 2;
    state().flags.B.carrier = playerId;
    state().flags.B.x = 5;
    state().flags.B.y = 5;
    player.carrying = 'B';
    player.x = 1;
    player.y = 12;

    const result = platform.gameManager.handleAction(room, playerId, {
      type: 'move',
      payload: { direction: 'down' }, // onto base A
    });
    expect(result.accepted).toBe(true);
    expect(state().scores.A).toBe(3);
    expect(player.carrying).toBeNull();
    expect(state().flags.B.carrier).toBeNull();
    expect(state().flags.B.x).toBe(13); // flag returned home
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('completed');

    const draft = captureTheFlagGame.getResult(state(), context());
    expect(draft.winners).toEqual([playerId]);
    expect(draft.isDraw).toBe(false);
    expect(draft.rankings[0]!.score).toBe(3);
    expect(draft.rankings[0]!.stats.captures).toBe(3);
  });

  it('tags: carrier drops the flag (it returns home) and respawns; bases are safe', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);
    const playerA = state().players[a]!;
    const playerB = state().players[b]!;

    // B carries the A flag in the open; A steps onto B.
    playerB.carrying = 'A';
    state().flags.A.carrier = b;
    state().flags.A.x = 7;
    state().flags.A.y = 7;
    playerB.x = 7;
    playerB.y = 7;
    playerA.x = 7;
    playerA.y = 6;
    playerA.lastMoveAt = 0;
    playerB.lastMoveAt = 0;

    const tag = platform.gameManager.handleAction(room, a, {
      type: 'move',
      payload: { direction: 'down' },
    });
    expect(tag.accepted).toBe(true);
    expect(playerB.respawnAt).not.toBeNull();
    expect(playerB.x).toBe(13); // respawned at own base
    expect(playerB.y).toBe(1);
    expect(playerB.carrying).toBeNull();
    expect(state().flags.A.carrier).toBeNull();
    expect(state().flags.A.x).toBe(1); // flag returned home
    expect(state().players[a]!.tags).toBe(1);

    // Respawn gate blocks movement.
    expect(
      captureTheFlagGame.validateAction(b, { type: 'move', payload: { direction: 'up' } }, state(), context())
        .valid,
    ).toBe(false);
    playerB.respawnAt = null;
    playerB.lastMoveAt = 0;

    // Own base is a safe zone — no tagging there (both share A's base cell).
    playerA.x = 1;
    playerA.y = 13;
    playerA.lastMoveAt = 0;
    playerB.x = 1;
    playerB.y = 13;
    const safe = platform.gameManager.handleAction(room, b, {
      type: 'move',
      payload: { direction: 'up' },
    });
    expect(safe.accepted).toBe(true);
    expect(playerA.respawnAt).toBeNull();
  });

  it('a leaver drops any carried flag; empty team ends the match', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);

    captureTheFlagGame.playerLeft(a, state(), context(), 'disconnect');
    expect(state().players[a]!.disconnected).toBe(true);
    expect(state().phase).toBe('playing');

    state().players[b]!.carrying = 'A';
    state().flags.A.carrier = b;
    captureTheFlagGame.playerLeft(b, state(), context(), 'leave');
    expect(state().flags.A.carrier).toBeNull();
    expect(state().flags.A.x).toBe(1);
    expect(state().phase).toBe('finished'); // team B empty → match over
  });

  /* ---------------------------------------------------------------- */
  /* Timeout / draw / reset                                            */
  /* ---------------------------------------------------------------- */

  it('timeout with equal scores is a draw', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    finishCTFOnTimeout(state(), context());
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('timeout');

    const draft = captureTheFlagGame.getResult(state(), context());
    expect(draft.isDraw).toBe(true);
    expect(draft.winners).toHaveLength(0);
    expect(draft.rankings.every((entry) => entry.isDraw)).toBe(true);
    expect(captureTheFlagGame.checkDrawCondition(state())).toBe(true);
  });

  it('timeout with unequal scores ranks the winning team first', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    state().scores.B = 2;
    finishCTFOnTimeout(state(), context());
    const draft = captureTheFlagGame.getResult(state(), context());
    expect(draft.winners).toEqual([players[1]!.id]);
    expect(draft.rankings[0]!.playerId).toBe(players[1]!.id);
    expect(draft.rankings[0]!.score).toBe(2);
  });

  it('reset keeps every seat, zeroes scores and returns flags home', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const seats = Object.keys(state().players);
    state().scores.A = 2;
    state().players[seats[0]!]!.captures = 2;

    const next = captureTheFlagGame.reset(state());
    expect(Object.keys(next.players)).toEqual(seats);
    expect(next.scores).toEqual({ A: 0, B: 0 });
    expect(next.phase).toBe('idle');
    expect(next.flags.A.carrier).toBeNull();
    expect(next.flags.B.carrier).toBeNull();
    for (const player of Object.values(next.players)) {
      expect(player.captures).toBe(0);
      expect(player.carrying).toBeNull();
      expect(player.steps).toBe(0);
    }
  });

  /* ---------------------------------------------------------------- */
  /* AI                                                                */
  /* ---------------------------------------------------------------- */

  it('AI moves legally and beelines for the enemy flag', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const playerId = players[0]!.id;

    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const move = captureTheFlagGame.getAIMove?.(playerId, difficulty, state(), context());
        expect(move?.type).toBe('move');
        const direction = move?.payload?.direction as CTFDirection;
        expect(['up', 'down', 'left', 'right']).toContain(direction);
        const player = state().players[playerId]!;
        const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction]!;
        expect(state().walls[(player.y + delta[1]!) * 15 + (player.x + delta[0]!)]).toBe(false);
        player.lastMoveAt = 0; // allow repeated test moves
        platform.gameManager.handleAction(room, playerId, { type: 'move', payload: { direction } });
      }
    }

    // On a normalised board (player hunting the idle enemy flag), hard AI
    // strictly decreases BFS distance to that flag.
    const player = state().players[playerId]!;
    player.carrying = null;
    player.x = 1;
    player.y = 13; // own base
    for (const flag of Object.values(state().flags)) {
      flag.carrier = null;
      flag.x = state().bases[flag.owner].x;
      flag.y = state().bases[flag.owner].y;
    }
    const flagB = state().flags.B;
    const before = bfsDistances(state().walls, { x: flagB.x, y: flagB.y })[player.y * 15 + player.x]!;
    const move = captureTheFlagGame.getAIMove?.(playerId, 'hard', state(), context());
    const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[
      move?.payload?.direction as CTFDirection
    ]!;
    const after = bfsDistances(state().walls, { x: flagB.x, y: flagB.y })[
      (player.y + delta[1]!) * 15 + (player.x + delta[0]!)
    ]!;
    expect(after).toBeLessThan(before);
  });

  /* ---------------------------------------------------------------- */
  /* Public state                                                      */
  /* ---------------------------------------------------------------- */

  it('exposes the arena, flags and players but never the seed', async () => {
    await waitFor(() => state().phase === 'playing', { timeoutMs: 5000 });
    const view = publicState(players[0]!.id);
    expect(view.phase).toBe('playing');
    expect(view.walls).toHaveLength(225);
    expect(view.bases.A).toEqual({ x: 1, y: 13 });
    expect(view.bases.B).toEqual({ x: 13, y: 1 });
    expect(Object.keys(view.players)).toHaveLength(2);
    expect(JSON.stringify(view)).not.toContain('"seed"');
    expect(state().seed).not.toBe(0);
  });
});
