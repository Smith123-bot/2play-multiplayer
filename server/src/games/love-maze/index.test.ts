import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  buildMaze,
  CHECKPOINT_SCORE,
  completeLevel,
  exitSatisfied,
  finishMaze,
  HAZARD_PENALTY,
  isWalkable,
  KEY_SCORE,
  levelAt,
  loadLevel,
  loveMazeGame,
  MAZE_LEVELS,
  MAZE_TOTAL_LEVELS,
  refreshCoop,
  tileAt,
  type MazeState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Love Maze', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'love-maze');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as MazeState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const act = (playerId: string, direction: string) =>
    platform.gameManager.handleAction(room, playerId, { type: 'move', payload: { direction } });

  /** Teleports an actor (test-only) then refreshes the derived co-op state. */
  const put = (playerId: string, x: number, y: number) => {
    const actor = state().players[playerId]!;
    actor.x = x;
    actor.y = y;
    refreshCoop(state());
  };

  const findTile = (tile: string) => {
    for (let y = 0; y < state().rows; y += 1) {
      for (let x = 0; x < state().cols; x += 1) {
        if (state().tiles[y]?.[x] === tile) return { x, y };
      }
    }
    return null;
  };

  const goToLevel = (index: number) => {
    state().level = index;
    loadLevel(state(), context());
  };

  /* ---------------- levels ---------------- */

  it('ships ten well formed levels with two spawns and a shared exit', () => {
    expect(MAZE_TOTAL_LEVELS).toBe(10);
    expect(MAZE_LEVELS).toHaveLength(10);
    expect(new Set(MAZE_LEVELS.map((level) => level.id)).size).toBe(10);

    for (const level of MAZE_LEVELS) {
      const built = buildMaze(level);
      const width = built.tiles[0]!.length;
      expect(built.tiles.every((row) => row.length === width)).toBe(true);
      // Two distinct spawns and at least two exit cells (one per partner).
      expect(built.spawnA).not.toEqual(built.spawnB);
      const exits = built.tiles.flat().filter((tile) => tile === 'exit').length;
      expect(exits).toBeGreaterThanOrEqual(2);
      // Enough keys exist to satisfy the requirement.
      expect(built.keyCells.length).toBeGreaterThanOrEqual(level.keysRequired);
      expect(level.timeLimit).toBeGreaterThan(0);
    }
  });

  it('difficulty escalates: later levels are bigger or busier', () => {
    const first = buildMaze(levelAt(0));
    const last = buildMaze(levelAt(9));
    expect(last.cols * last.rows).toBeGreaterThan(first.cols * first.rows);
    expect(levelAt(9).keysRequired).toBeGreaterThan(levelAt(0).keysRequired);
  });

  it('initialises level one with both partners on their own spawn', () => {
    expect(state().phase).toBe('playing');
    expect(state().level).toBe(0);
    expect(state().totalLevels).toBe(MAZE_TOTAL_LEVELS);
    expect(state().levelEndsAt).toBeGreaterThan(context().now());

    const roles = Object.values(state().players).map((actor) => actor.role);
    expect(roles).toContain('a');
    expect(roles).toContain('b');
    const positions = Object.values(state().players).map((actor) => `${actor.x}:${actor.y}`);
    expect(new Set(positions).size).toBe(2);
  });

  /* ---------------- movement & collision ---------------- */

  it('accepts a legal step and rejects walking into a wall', () => {
    const playerId = players[0]!.id;
    const actor = state().players[playerId]!;
    // Spawns sit against the outer wall, so up/left are blocked.
    expect(isWalkable(state(), actor.x, actor.y - 1)).toBe(false);
    expect(act(playerId, 'up').accepted).toBe(false);
    expect(act(playerId, 'right').accepted).toBe(true);
  });

  it('rejects malformed directions and outcome-asserting actions', () => {
    const playerId = players[0]!.id;
    const ctx = context();
    for (const type of ['score', 'win', 'complete', 'finish', 'open', 'teleport']) {
      expect(loveMazeGame.validateAction(playerId, { type, payload: { score: 9999 } }, state(), ctx).valid).toBe(false);
      expect(loveMazeGame.handlePlayerAction(playerId, { type }, state(), ctx).accepted).toBe(false);
    }
    for (const direction of [undefined, null, 'diagonal', 5, {}]) {
      expect(loveMazeGame.validateAction(playerId, { type: 'move', payload: { direction } }, state(), ctx).valid).toBe(
        false,
      );
    }
    const before = state().teamScore;
    loveMazeGame.handlePlayerAction(playerId, { type: 'score', payload: { score: 9999 } }, state(), ctx);
    expect(state().teamScore).toBe(before);
  });

  /* ---------------- cooperative mechanics ---------------- */

  it('role locked switches: only the matching partner opens the door', () => {
    goToLevel(1); // "Hold the Way" — has switch a and switch b
    const [aId, bId] = players.map((player) => player.id);
    const switchA = findTile('switch-a')!;
    const switchB = findTile('switch-b')!;
    expect(switchA).toBeTruthy();

    // Partner B standing on switch A does NOT hold it.
    put(bId, switchA.x, switchA.y);
    expect(state().switchesHeld.a).toBe(false);

    // Partner A does.
    put(aId, switchA.x, switchA.y);
    expect(state().switchesHeld.a).toBe(true);
    // Both switches held opens the door.
    put(bId, switchB.x, switchB.y);
    expect(state().switchesHeld.b).toBe(true);
    expect(state().doorsOpen).toBe(true);
  });

  it('a closed door blocks movement and an open one does not', () => {
    goToLevel(1);
    const [aId, bId] = players.map((player) => player.id);
    const door = findTile('door')!;
    expect(state().doorsOpen).toBe(false);
    expect(isWalkable(state(), door.x, door.y)).toBe(false);

    const switchA = findTile('switch-a')!;
    const switchB = findTile('switch-b')!;
    put(aId, switchA.x, switchA.y);
    put(bId, switchB.x, switchB.y);
    expect(state().doorsOpen).toBe(true);
    expect(isWalkable(state(), door.x, door.y)).toBe(true);
  });

  it('pressure plates need BOTH partners standing at once', () => {
    goToLevel(2); // "Two Hands" — two shared plates
    const [aId, bId] = players.map((player) => player.id);
    expect(state().platesTotal).toBe(2);

    const plates: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < state().rows; y += 1) {
      for (let x = 0; x < state().cols; x += 1) {
        if (state().tiles[y]?.[x] === 'plate') plates.push({ x, y });
      }
    }
    put(aId, plates[0]!.x, plates[0]!.y);
    expect(state().platesHeld).toBe(1);
    expect(state().doorsOpen).toBe(false); // one is not enough

    put(bId, plates[1]!.x, plates[1]!.y);
    expect(state().platesHeld).toBe(2);
    expect(state().coopSatisfied).toBe(true);
    expect(state().doorsOpen).toBe(true);

    // The gate LATCHES: the pair had to coordinate to trigger it, but once
    // open they can both step off and actually walk through. (Without this a
    // two player level would be unsolvable — someone would be stuck holding.)
    put(aId, 1, 1);
    expect(state().coopSatisfied).toBe(false);
    expect(state().doorsOpen).toBe(true);
  });

  it('collects a key once and never scores it twice', () => {
    goToLevel(3); // "Key Exchange"
    const playerId = players[0]!.id;
    const key = findTile('key')!;
    const actor = state().players[playerId]!;
    actor.x = key.x - 1;
    actor.y = key.y;

    expect(act(playerId, 'right').accepted).toBe(true);
    expect(state().keysCollected).toBe(1);
    expect(state().teamScore).toBe(KEY_SCORE);

    // Step off and back: no second reward.
    act(playerId, 'left');
    act(playerId, 'right');
    expect(state().keysCollected).toBe(1);
    expect(state().teamScore).toBe(KEY_SCORE);
  });

  it('a hazard returns the player to their checkpoint and costs points', () => {
    goToLevel(4); // "Mind the Sparks" — has hazards and checkpoints
    const playerId = players[0]!.id;
    const hazard = findTile('hazard')!;
    const actor = state().players[playerId]!;
    state().teamScore = 100;
    actor.checkpointX = 1;
    actor.checkpointY = 1;
    actor.x = hazard.x - 1;
    actor.y = hazard.y;

    expect(act(playerId, 'right').accepted).toBe(true);
    // Bounced back to the checkpoint, not left standing on the hazard.
    expect({ x: actor.x, y: actor.y }).toEqual({ x: 1, y: 1 });
    expect(actor.hazardHits).toBe(1);
    expect(state().teamScore).toBe(100 - HAZARD_PENALTY);
    expect(state().mistakes).toBe(1);
  });

  it('a checkpoint banks progress and scores once', () => {
    goToLevel(4);
    const playerId = players[0]!.id;
    const checkpoint = findTile('checkpoint')!;
    const actor = state().players[playerId]!;
    actor.x = checkpoint.x - 1;
    actor.y = checkpoint.y;

    expect(act(playerId, 'right').accepted).toBe(true);
    expect(actor.checkpointX).toBe(checkpoint.x);
    expect(state().teamScore).toBe(CHECKPOINT_SCORE);
    const after = state().teamScore;
    act(playerId, 'left');
    act(playerId, 'right');
    expect(state().teamScore).toBe(after); // no double award
  });

  /* ---------------- the both-players exit rule ---------------- */

  it('one partner on the exit is NOT enough to clear the level', () => {
    const [aId, bId] = players.map((player) => player.id);
    const exit = findTile('exit')!;
    put(aId, exit.x, exit.y);
    expect(exitSatisfied(state())).toBe(false);
    expect(state().levelsCleared).toBe(0);

    // Both on exit cells clears it.
    const exits: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < state().rows; y += 1) {
      for (let x = 0; x < state().cols; x += 1) {
        if (state().tiles[y]?.[x] === 'exit') exits.push({ x, y });
      }
    }
    put(bId, exits[1]!.x, exits[1]!.y);
    expect(exitSatisfied(state())).toBe(true);
  });

  it('the exit refuses the team while keys are still missing', () => {
    goToLevel(3); // needs 2 keys
    const [aId, bId] = players.map((player) => player.id);
    const exits: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < state().rows; y += 1) {
      for (let x = 0; x < state().cols; x += 1) {
        if (state().tiles[y]?.[x] === 'exit') exits.push({ x, y });
      }
    }
    put(aId, exits[0]!.x, exits[0]!.y);
    put(bId, exits[1]!.x, exits[1]!.y);
    expect(state().keysCollected).toBeLessThan(state().keysRequired);
    expect(exitSatisfied(state())).toBe(false);

    // Satisfy the keys and it opens.
    state().keysCollected = state().keysRequired;
    expect(exitSatisfied(state())).toBe(true);
  });

  /* ---------------- progression ---------------- */

  it('completing a level awards the bonus and advances', () => {
    const before = state().teamScore;
    completeLevel(state(), context());
    expect(state().levelsCleared).toBe(1);
    expect(state().teamScore).toBeGreaterThan(before);
    expect(state().level).toBe(1);
    expect(state().phase).toBe('level-clear');
  });

  it('clearing the final level finishes the run', () => {
    state().level = MAZE_TOTAL_LEVELS - 1;
    state().phase = 'playing';
    completeLevel(state(), context());
    expect(state().phase).toBe('finished');
    expect(loveMazeGame.isGameFinished(state())).toBe(true);
  });

  it('rejects actions once the run is over', () => {
    const playerId = players[0]!.id;
    finishMaze(state(), context(), 'timeout');
    expect(state().finishReason).toBe('timeout');
    expect(act(playerId, 'right').accepted).toBe(false);
  });

  /* ---------------- co-op result ---------------- */

  it('is cooperative: both partners share the score, rank and outcome', () => {
    state().teamScore = 850;
    state().levelsCleared = 4;
    finishMaze(state(), context(), 'completed');

    const [aId, bId] = players.map((player) => player.id);
    expect(loveMazeGame.calculateScore(aId, state())).toBe(850);
    expect(loveMazeGame.calculateScore(bId, state())).toBe(850);
    expect(loveMazeGame.checkWinCondition(state())).toHaveLength(2);

    const result = loveMazeGame.getResult(state(), context());
    expect(result.winners).toHaveLength(2);
    expect(result.rankings.every((entry) => entry.rank === 1)).toBe(true);
    expect(result.rankings.every((entry) => entry.score === 850)).toBe(true);
    expect(result.rankings.every((entry) => entry.isWinner)).toBe(true);
    expect(result.rankings[0]!.stats).toHaveProperty('levelsCleared');
  });

  it('a run that clears nothing is not a win', () => {
    state().levelsCleared = 0;
    finishMaze(state(), context(), 'timeout');
    expect(loveMazeGame.checkWinCondition(state())).toEqual([]);
    expect(loveMazeGame.getResult(state(), context()).isDraw).toBe(true);
  });

  /* ---------------- lifecycle ---------------- */

  it('a disconnected partner releases their plate but keeps their seat', () => {
    goToLevel(2);
    const [aId, bId] = players.map((player) => player.id);
    const plates: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < state().rows; y += 1) {
      for (let x = 0; x < state().cols; x += 1) {
        if (state().tiles[y]?.[x] === 'plate') plates.push({ x, y });
      }
    }
    put(aId, plates[0]!.x, plates[0]!.y);
    put(bId, plates[1]!.x, plates[1]!.y);
    expect(state().doorsOpen).toBe(true);

    loveMazeGame.playerLeft(aId, state(), context(), 'disconnect');
    expect(state().players[aId]!.disconnected).toBe(true);
    // The disconnected body stops counting toward the coordinated condition.
    expect(state().platesHeld).toBe(1);
    expect(state().coopSatisfied).toBe(false);
    expect(act(aId, 'right').accepted).toBe(false);

    loveMazeGame.playerJoined({ ...players[0]! }, state(), context());
    expect(state().players[aId]!.disconnected).toBe(false);
    expect(state().players[aId]!.role).toBe('a'); // role preserved
  });

  it('an intentional leave ends the run (the maze needs two)', () => {
    const [aId] = players.map((player) => player.id);
    loveMazeGame.playerLeft(aId, state(), context(), 'leave');
    expect(state().players[aId]!.left).toBe(true);
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('abandoned');
  });

  it('reset restores a fresh run for a rematch and cleanup releases it', () => {
    state().teamScore = 500;
    state().levelsCleared = 3;
    state().level = 5;
    finishMaze(state(), context(), 'completed');

    const next = loveMazeGame.reset(state());
    expect(next.phase).toBe('idle');
    expect(next.level).toBe(0);
    expect(next.teamScore).toBe(0);
    expect(next.levelsCleared).toBe(0);
    expect(Object.keys(next.players)).toEqual(Object.keys(state().players));
    // Roles are stable across a rematch.
    expect(Object.values(next.players).map((actor) => actor.role).sort()).toEqual(['a', 'b']);

    loveMazeGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
    expect(next.tiles).toHaveLength(0);
  });

  /* ---------------- AI ---------------- */

  it('the AI partner only makes legal moves on every level', () => {
    for (let level = 0; level < MAZE_TOTAL_LEVELS; level += 1) {
      goToLevel(level);
      for (const difficulty of ['easy', 'medium', 'hard'] as const) {
        for (let step = 0; step < 6; step += 1) {
          const action = loveMazeGame.getAIMove?.(players[0]!.id, difficulty, state(), context());
          if (!action) continue;
          expect(action.type).toBe('move');
          expect(loveMazeGame.validateAction(players[0]!.id, action, state(), context()).valid).toBe(true);
        }
      }
    }
  });

  it('the AI partner walks toward the objective, not at random', () => {
    goToLevel(0);
    const playerId = players[0]!.id;
    const exit = findTile('exit')!;
    const actor = state().players[playerId]!;
    const startDistance = Math.abs(actor.x - exit.x) + Math.abs(actor.y - exit.y);

    for (let step = 0; step < 40; step += 1) {
      const action = loveMazeGame.getAIMove?.(playerId, 'hard', state(), context());
      if (!action) break;
      act(playerId, action.payload?.direction as string);
    }
    const current = state().players[playerId]!;
    const endDistance = Math.abs(current.x - exit.x) + Math.abs(current.y - exit.y);
    expect(endDistance).toBeLessThan(startDistance);
  });

  it('the AI stops once the run is over', () => {
    finishMaze(state(), context(), 'completed');
    expect(loveMazeGame.getAIMove?.(players[0]!.id, 'hard', state(), context())).toBeNull();
  });

  /* ---------------- public state ---------------- */

  it('publishes the shared maze to both partners', () => {
    const [aId, bId] = players.map((player) => player.id);
    const viewA = platform.gameManager.getPublicState(room, aId) as Record<string, unknown> & { myRole: string };
    const viewB = platform.gameManager.getPublicState(room, bId) as Record<string, unknown> & { myRole: string };
    // Co-op: the board is shared, but each partner learns their own role.
    expect(JSON.stringify(viewA.tiles)).toBe(JSON.stringify(viewB.tiles));
    expect(viewA.myRole).toBe('a');
    expect(viewB.myRole).toBe('b');
    expect(tileAt(state(), 0, 0)).toBe('wall');
  });
});
