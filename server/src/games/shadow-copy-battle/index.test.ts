import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createPlayer, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  advanceTick,
  ARENA_IDS,
  ARENA_LAYOUTS,
  beginRound,
  canMovePlayer,
  endRound,
  finishShadow,
  parseArena,
  PARSED_ARENAS,
  SCORE_CRYSTAL,
  SCORE_EFFICIENT,
  SCORE_EXIT,
  SCORE_SHADOW,
  shadowCopyGame,
  STEP_MS,
  tryMovePlayer,
  type ShadowState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Shadow Copy Battle', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'shadow-copy-battle', {
      settings: { gridSize: 'twin-plates', rounds: 3 },
    });
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as ShadowState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      round: number;
      arenaId: string;
      tiles: string[];
      pickups: Array<{ x: number; y: number; kind: string }>;
      gatesOpen: boolean;
      runners: Record<string, { x: number; y: number; score: number; frozen: boolean }>;
      shadows: Array<{ ownerId: string; x: number; y: number; skipped: number; history?: unknown }>;
      history?: unknown;
    };

  async function startWithPlayers(count: 3 | 4): Promise<{ room: Room; players: GamePlayerView[] }> {
    const local = createTestPlatform();
    const ids = [];
    for (let i = 0; i < count; i += 1) {
      ids.push(await createPlayer(local.platform, `Sh${count}${i}`));
    }
    const extra = local.platform.roomManager.createRoom({
      gameId: 'shadow-copy-battle',
      maxPlayers: count,
      isPrivate: false,
      settings: { gridSize: 'twin-plates' },
      host: ids[0]!,
    });
    for (let i = 1; i < count; i += 1) {
      local.platform.roomManager.joinRoom({ roomId: extra.id, player: ids[i]! });
    }
    extra.status = 'PLAYING';
    extra.gameStartedAt = Date.now();
    local.platform.gameManager.createState(extra);
    local.platform.gameManager.start(extra);
    harness.destroy();
    harness = local;
    platform = local.platform;
    room = extra;
    players = platform.gameManager.playerViews(room);
    return { room, players };
  }

  it('ships five distinct handcrafted arenas with four spawns each', () => {
    expect(ARENA_LAYOUTS).toHaveLength(5);
    expect(new Set(ARENA_IDS).size).toBe(5);
    for (const layout of ARENA_LAYOUTS) {
      const arena = parseArena(layout);
      expect(arena.cols).toBe(13);
      expect(arena.rows).toBe(11);
      expect(arena.spawns).toHaveLength(4);
      const keys = new Set(arena.spawns.map((spawn) => `${spawn.x},${spawn.y}`));
      expect(keys.size).toBe(4);
      expect(arena.plates.length).toBeGreaterThan(0);
    }
    expect(PARSED_ARENAS.map((arena) => arena.id)).toEqual(ARENA_IDS);
  });

  it('starts playing on the requested arena with a live round clock', () => {
    expect(state().phase).toBe('playing');
    expect(state().arenaId).toBe('twin-plates');
    expect(state().round).toBe(0);
    expect(state().totalRounds).toBe(3);
    expect(state().shadows).toHaveLength(0);
    expect(Object.keys(state().runners)).toHaveLength(2);
    const keys = new Set(Object.values(state().runners).map((runner) => `${runner.x},${runner.y}`));
    expect(keys.size).toBe(2);
    expect(state().endsAt).toBeGreaterThan(context().now());
  });

  it('accepts a legal step, records the tick, and rejects walls / unknown / client-owned results', () => {
    const playerId = players[0]!.id;
    const runner = state().runners[playerId]!;
    const moved = platform.gameManager.handleAction(room, playerId, {
      type: 'move',
      payload: { direction: 'right' },
    });
    expect(moved.accepted).toBe(true);
    expect(runner.history).toEqual([{ tick: 0, direction: 'right' }]);

    expect(shadowCopyGame.validateAction(playerId, { type: 'finish' }, state(), context()).valid).toBe(false);
    expect(shadowCopyGame.validateAction(playerId, { type: 'shadow', payload: { path: 'nope' } }, state(), context()).valid).toBe(
      false,
    );
    expect(shadowCopyGame.validateAction(playerId, { type: 'path', payload: { steps: 9 } }, state(), context()).valid).toBe(
      false,
    );
    expect(shadowCopyGame.validateAction(playerId, { type: 'score', payload: { score: 999 } }, state(), context()).valid).toBe(
      false,
    );
    expect(shadowCopyGame.validateAction(playerId, { type: 'collect' }, state(), context()).valid).toBe(false);
    expect(
      shadowCopyGame.validateAction(playerId, { type: 'move', payload: { direction: 'north' } }, state(), context()).valid,
    ).toBe(false);
    expect(shadowCopyGame.handlePlayerAction(playerId, { type: 'replay' }, state(), context()).accepted).toBe(false);

    const wall = canMovePlayer(state(), playerId, 'up');
    expect(wall.ok).toBe(false);
  });

  it('replays the previous validated path as a Shadow Copy and hides history from clients', () => {
    const playerId = players[0]!.id;
    const runner = state().runners[playerId]!;
    const startX = runner.x;
    const startY = runner.y;
    expect(tryMovePlayer(state(), playerId, 'right').ok).toBe(true);
    advanceTick(state(), context());
    expect(tryMovePlayer(state(), playerId, 'right').ok).toBe(true);
    runner.previousHistory = runner.history.map((step) => ({ ...step }));
    runner.history = [];
    beginRound(state(), context(), 1);

    expect(state().round).toBe(1);
    expect(state().runners[playerId]!.x).toBe(startX);
    const ghost = state().shadows.find((entry) => entry.ownerId === playerId);
    expect(ghost).toBeTruthy();
    expect(ghost!.x).toBe(startX + 1);
    expect(ghost!.y).toBe(startY);
    advanceTick(state(), context());
    expect(ghost!.x).toBe(startX + 2);

    const view = publicState(playerId);
    expect(view.shadows[0]!.history).toBeUndefined();
    expect(view.history).toBeUndefined();
    expect(JSON.stringify(view)).not.toMatch(/"history"/);
    expect(JSON.stringify(view)).not.toMatch(/previousHistory/);
  });

  it('skips a blocked shadow step and still fires later ticks', () => {
    const playerId = players[0]!.id;
    const runner = state().runners[playerId]!;
    runner.previousHistory = [
      { tick: 1, direction: 'right' },
      { tick: 2, direction: 'right' },
    ];
    beginRound(state(), context(), 1);
    const ghost = state().shadows.find((entry) => entry.ownerId === playerId)!;
    const spawnX = ghost.x;
    const spawnY = ghost.y;
    const first = (spawnY * state().cols + spawnX + 1);
    state().tiles[first] = 'wall';
    advanceTick(state(), context());
    expect(ghost.x).toBe(spawnX);
    expect(ghost.skipped).toBe(1);
    state().tiles[first] = 'floor';
    advanceTick(state(), context());
    expect(ghost.x).toBe(spawnX + 1);
  });

  it('opens gates only when every plate is held by a live player or a shadow', () => {
    expect(state().gatesOpen).toBe(false);
    const [first, second] = players.map((player) => player.id);
    const plates = state().plates;
    expect(plates.length).toBeGreaterThanOrEqual(2);
    state().runners[first]!.x = plates[0]!.x;
    state().runners[first]!.y = plates[0]!.y;
    expect(shadowCopyGame.getPublicState(state(), first, context()) as { gatesOpen: boolean }).toEqual(
      expect.objectContaining({ gatesOpen: false }),
    );
    state().runners[second]!.x = plates[1]!.x;
    state().runners[second]!.y = plates[1]!.y;
    const view = publicState(first);
    expect(view.gatesOpen).toBe(true);
  });

  it('lets only living players collect gold crystals; shadows collect violet ones', () => {
    const playerId = players[0]!.id;
    const crystal = state().pickups.find((pickup) => pickup.kind === 'crystal')!;
    const runner = state().runners[playerId]!;
    runner.x = crystal.x - 1;
    runner.y = crystal.y;
    expect(tryMovePlayer(state(), playerId, 'right').ok).toBe(true);
    expect(runner.score).toBe(SCORE_CRYSTAL);
    expect(state().pickups.some((pickup) => pickup.x === crystal.x && pickup.y === crystal.y)).toBe(false);

    const shadowCell = { x: runner.x + 1, y: runner.y };
    state().tiles[shadowCell.y * state().cols + shadowCell.x] = 'floor';
    state().pickups.push({ ...shadowCell, kind: 'shadow' });
    advanceTick(state(), context());
    expect(tryMovePlayer(state(), playerId, 'right').ok).toBe(true);
    expect(runner.shadowCrystals).toBe(0);
    expect(state().pickups.some((pickup) => pickup.kind === 'shadow' && pickup.x === shadowCell.x)).toBe(true);

    const other = players[1]!.id;
    state().runners[other]!.x = 11;
    state().runners[other]!.y = 9;
    runner.x = 1;
    runner.y = 2;
    const ghostX = shadowCell.x - 1;
    const ghostY = shadowCell.y;
    state().tiles[ghostY * state().cols + ghostX] = 'floor';
    state().pickups = [{ ...shadowCell, kind: 'shadow' }];
    const nextTick = state().roundTick + 1;
    state().shadows = [
      {
        ownerId: playerId,
        x: ghostX,
        y: ghostY,
        history: [{ tick: nextTick, direction: 'right' }],
        skipped: 0,
        active: true,
        freezeUntilTick: -1,
      },
    ];
    advanceTick(state(), context());
    expect(state().runners[playerId]!.shadowCrystals).toBe(1);
    expect(state().runners[playerId]!.score).toBe(SCORE_CRYSTAL + SCORE_SHADOW);
    expect(state().pickups).toHaveLength(0);
  });

  it('awards an exit once, freezes on hazards, and pays the efficient-route bonus', () => {
    const playerId = players[0]!.id;
    const runner = state().runners[playerId]!;
    const idx = runner.y * state().cols + runner.x + 1;
    state().tiles[idx] = 'exit';
    expect(tryMovePlayer(state(), playerId, 'right').ok).toBe(true);
    expect(runner.score).toBe(SCORE_EXIT);
    expect(runner.exits).toBe(1);
    advanceTick(state(), context());
    runner.x -= 1;
    expect(tryMovePlayer(state(), playerId, 'right').ok).toBe(true);
    expect(runner.exits).toBe(1);
    expect(runner.score).toBe(SCORE_EXIT);

    runner.history = [];
    state().roundTick = 1;
    state().tiles[idx] = 'hazard';
    runner.x -= 1;
    runner.exitedThisRound = true;
    expect(tryMovePlayer(state(), playerId, 'right').ok).toBe(true);
    expect(runner.freezeUntilTick).toBe(state().roundTick + 3);
    expect(canMovePlayer(state(), playerId, 'left').ok).toBe(false);

    runner.history = [{ tick: 0, direction: 'right' }];
    runner.crystalsThisRound = 1;
    const before = runner.score;
    state().round = 0;
    state().totalRounds = 3;
    endRound(state(), context());
    expect(state().runners[playerId]!.score).toBe(before + SCORE_EFFICIENT);
    expect(state().phase).toBe('between');
  });

  it('finishes after the last round and draws on equal scores', () => {
    const [a, b] = players.map((player) => player.id);
    state().runners[a]!.score = 150;
    state().runners[b]!.score = 150;
    state().round = 2;
    state().totalRounds = 3;
    endRound(state(), context());
    expect(state().phase).toBe('finished');
    const draw = shadowCopyGame.getResult(state(), context());
    expect(draw.isDraw).toBe(true);
    state().runners[a]!.score = 200;
    const win = shadowCopyGame.getResult(state(), context());
    expect(win.winners).toEqual([a]);
    expect(win.rankings).toHaveLength(2);
  });

  it('timeout ranks by score; reset keeps seats; cleanup empties runners', () => {
    const seats = Object.keys(state().runners);
    state().runners[seats[0]!]!.score = 40;
    finishShadow(state(), context(), 'timeout');
    expect(state().finishReason).toBe('timeout');
    const next = shadowCopyGame.reset(state());
    expect(Object.keys(next.runners)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.runners[seats[0]!]!.score).toBe(0);
    expect(next.shadows).toHaveLength(0);
    shadowCopyGame.cleanup(next);
    expect(Object.keys(next.runners)).toHaveLength(0);
  });

  it('disconnect, reconnect and leave', () => {
    const [first, second] = players.map((player) => player.id);
    shadowCopyGame.playerLeft(first, state(), context(), 'disconnect');
    expect(state().runners[first]!.disconnected).toBe(true);
    expect(canMovePlayer(state(), first, 'right').ok).toBe(false);
    shadowCopyGame.playerJoined({ ...players[0]!, id: first }, state(), context());
    expect(state().runners[first]!.disconnected).toBe(false);
    shadowCopyGame.playerLeft(first, state(), context(), 'leave');
    shadowCopyGame.playerLeft(second, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
  });

  it('AI returns a legal one-cell move that validateAction accepts', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const move = shadowCopyGame.getAIMove?.(players[0]!.id, difficulty, state(), context());
      expect(move?.type).toBe('move');
      expect(shadowCopyGame.validateAction(players[0]!.id, move!, state(), context()).valid).toBe(true);
    }
  });

  it('the update loop advances the shadow clock', () => {
    const before = state().roundTick;
    shadowCopyGame.update(state(), STEP_MS * 3, context());
    expect(state().roundTick).toBe(before + 3);
  });

  it('initialises 3 and 4 player matches with distinct spawns', async () => {
    for (const count of [3, 4] as const) {
      await startWithPlayers(count);
      expect(Object.keys(state().runners)).toHaveLength(count);
      const keys = new Set(Object.values(state().runners).map((runner) => `${runner.x},${runner.y}`));
      expect(keys.size).toBe(count);
      expect(state().phase).toBe('playing');
    }
  });
});
