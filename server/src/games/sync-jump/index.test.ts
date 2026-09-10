import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  bothFinished,
  buildCourse,
  cellAt,
  completeLevel,
  computeSync,
  CHECKPOINT_SCORE,
  FALL_PENALTY,
  finishSync,
  JUMP_TICKS,
  levelAt,
  loadLevel,
  SYNC_LEVELS,
  SYNC_TOTAL_LEVELS,
  SYNC_WINDOW,
  syncJumpGame,
  syncMultiplier,
  type SyncState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Sync Jump', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'sync-jump');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as SyncState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const step = (playerId: string, direction: 'left' | 'right' = 'right') =>
    platform.gameManager.handleAction(room, playerId, { type: 'move', payload: { direction } });
  const jump = (playerId: string) => platform.gameManager.handleAction(room, playerId, { type: 'jump' });

  const goToLevel = (index: number) => {
    state().level = index;
    loadLevel(state(), context());
  };

  /** Runs one partner to the finish the legal way (jumping every hazard). */
  const runToFinish = (playerId: string) => {
    let guard = 0;
    while (!state().players[playerId]!.finished && guard < 400) {
      guard += 1;
      const runner = state().players[playerId]!;
      const next = cellAt(state(), runner.x + 1);
      if ((next === 'gap' || next === 'obstacle') && runner.airborne === 0) {
        jump(playerId);
        continue;
      }
      if (runner.x + 1 >= state().length) break;
      step(playerId);
    }
  };

  /* ---------------- courses ---------------- */

  it('ships ten courses that all start on solid ground and end at a finish', () => {
    expect(SYNC_TOTAL_LEVELS).toBe(10);
    for (const level of SYNC_LEVELS) {
      const course = buildCourse(level);
      expect(course[0]).toBe('ground');
      expect(course[course.length - 1]).toBe('finish');
      expect(level.timeLimit).toBeGreaterThan(0);
    }
  });

  it('every course is completable by jumping each hazard', () => {
    for (let index = 0; index < SYNC_TOTAL_LEVELS; index += 1) {
      goToLevel(index);
      const playerId = players[0]!.id;
      runToFinish(playerId);
      expect(state().players[playerId]!.finished, `level ${index + 1} was not completable`).toBe(true);
      expect(state().players[playerId]!.falls).toBe(0);
    }
  });

  it('courses grow in length and hazard count', () => {
    const first = buildCourse(levelAt(0));
    const last = buildCourse(levelAt(9));
    expect(last.length).toBeGreaterThan(first.length);
    const hazards = (cells: string[]) => cells.filter((cell) => cell === 'gap' || cell === 'obstacle').length;
    expect(hazards(last)).toBeGreaterThan(hazards(first));
  });

  it('starts both runners at the beginning of course one', () => {
    expect(state().phase).toBe('playing');
    expect(state().level).toBe(0);
    expect(Object.values(state().players).every((runner) => runner.x === 0)).toBe(true);
    expect(state().levelEndsAt).toBeGreaterThan(context().now());
  });

  /* ---------------- movement & jumping ---------------- */

  it('moves right and refuses to run off either end', () => {
    const playerId = players[0]!.id;
    expect(step(playerId).accepted).toBe(true);
    expect(state().players[playerId]!.x).toBe(1);
    // Cannot go left past the start.
    state().players[playerId]!.x = 0;
    expect(step(playerId, 'left').accepted).toBe(false);
    // Cannot step past the finish.
    state().players[playerId]!.x = state().length - 1;
    expect(step(playerId, 'right').accepted).toBe(false);
  });

  it('running into a gap while grounded costs a fall and returns to the checkpoint', () => {
    goToLevel(1); // has a gap
    const playerId = players[0]!.id;
    const runner = state().players[playerId]!;
    const gapIndex = state().course.findIndex((cell) => cell === 'gap');
    expect(gapIndex).toBeGreaterThan(0);

    state().teamScore = 100;
    runner.x = gapIndex - 1;
    runner.checkpoint = 0;
    expect(step(playerId).accepted).toBe(true);
    expect(runner.falls).toBe(1);
    expect(runner.x).toBe(0); // back to the checkpoint
    expect(state().teamScore).toBe(100 - FALL_PENALTY);
    expect(state().mistakes).toBe(1);
  });

  it('jumping clears a gap without falling', () => {
    goToLevel(1);
    const playerId = players[0]!.id;
    const runner = state().players[playerId]!;
    const gapIndex = state().course.findIndex((cell) => cell === 'gap');
    runner.x = gapIndex - 1;

    expect(jump(playerId).accepted).toBe(true);
    expect(runner.airborne).toBe(JUMP_TICKS);
    expect(step(playerId).accepted).toBe(true);
    expect(runner.falls).toBe(0);
    expect(runner.x).toBe(gapIndex);
  });

  it('cannot double jump while already airborne', () => {
    const playerId = players[0]!.id;
    expect(jump(playerId).accepted).toBe(true);
    expect(jump(playerId).accepted).toBe(false);
  });

  it('a checkpoint banks progress and scores once', () => {
    const playerId = players[0]!.id;
    const runner = state().players[playerId]!;
    const checkpoint = state().course.findIndex((cell) => cell === 'checkpoint');
    runner.x = checkpoint - 1;
    const before = state().teamScore;
    expect(step(playerId).accepted).toBe(true);
    expect(runner.checkpoint).toBe(checkpoint);
    expect(state().teamScore).toBeGreaterThanOrEqual(before + CHECKPOINT_SCORE);
  });

  /* ---------------- synchronisation ---------------- */

  it('the sync meter is 100 when together and drops as partners drift apart', () => {
    const [aId, bId] = players.map((player) => player.id);
    const a = state().players[aId]!;
    const b = state().players[bId]!;

    a.x = 5;
    b.x = 5;
    expect(computeSync(state())).toBe(100);

    b.x = 5 + SYNC_WINDOW;
    const close = computeSync(state());
    expect(close).toBeLessThan(100);
    expect(close).toBeGreaterThan(0);

    b.x = 5 + SYNC_WINDOW * 3;
    expect(computeSync(state())).toBe(0);
  });

  it('the sync multiplier scales scoring and is applied to forward steps', () => {
    expect(syncMultiplier(100)).toBe(2);
    expect(syncMultiplier(70)).toBe(1.5);
    expect(syncMultiplier(45)).toBe(1);
    expect(syncMultiplier(10)).toBe(0.5);

    const [aId, bId] = players.map((player) => player.id);
    // Perfectly in sync: a step is worth double.
    state().players[aId]!.x = 2;
    state().players[bId]!.x = 2;
    state().syncMeter = 100;
    const before = state().teamScore;
    step(aId);
    const inSyncGain = state().teamScore - before;

    // Far apart: the same step is worth much less.
    state().players[aId]!.x = 2;
    state().players[bId]!.x = 2 + SYNC_WINDOW * 3;
    state().syncMeter = 0;
    const mid = state().teamScore;
    step(aId);
    const outOfSyncGain = state().teamScore - mid;
    expect(inSyncGain).toBeGreaterThan(outOfSyncGain);
  });

  it('records sync samples so the average can be scored at the end', () => {
    const playerId = players[0]!.id;
    expect(state().syncSamples).toBe(0);
    step(playerId);
    step(playerId);
    expect(state().syncSamples).toBe(2);
    expect(state().syncTotal).toBeGreaterThanOrEqual(0);
  });

  /* ---------------- finishing ---------------- */

  it('one runner finishing does NOT clear the course', () => {
    const [aId] = players.map((player) => player.id);
    runToFinish(aId);
    expect(state().players[aId]!.finished).toBe(true);
    expect(bothFinished(state())).toBe(false);
    expect(state().levelsCleared).toBe(0);
    // A finished runner cannot keep acting.
    expect(step(aId).accepted).toBe(false);
  });

  it('both runners finishing clears the course and advances', () => {
    const [aId, bId] = players.map((player) => player.id);
    runToFinish(aId);
    runToFinish(bId);
    expect(bothFinished(state())).toBe(true);
    expect(state().levelsCleared).toBe(1);
    expect(state().level).toBe(1);
  });

  it('clearing the final course finishes the run', () => {
    state().level = SYNC_TOTAL_LEVELS - 1;
    state().phase = 'playing';
    completeLevel(state(), context());
    expect(state().phase).toBe('finished');
    expect(syncJumpGame.isGameFinished(state())).toBe(true);
  });

  /* ---------------- anti-cheat ---------------- */

  it('rejects outcome-asserting actions and malformed input', () => {
    const playerId = players[0]!.id;
    const ctx = context();
    for (const type of ['score', 'win', 'complete', 'finish', 'sync', 'teleport']) {
      expect(syncJumpGame.validateAction(playerId, { type, payload: { score: 9999 } }, state(), ctx).valid).toBe(false);
      expect(syncJumpGame.handlePlayerAction(playerId, { type }, state(), ctx).accepted).toBe(false);
    }
    for (const direction of [undefined, null, 'up', 7, {}]) {
      expect(syncJumpGame.validateAction(playerId, { type: 'move', payload: { direction } }, state(), ctx).valid).toBe(
        false,
      );
    }
    const before = state().teamScore;
    syncJumpGame.handlePlayerAction(playerId, { type: 'score', payload: { score: 9999 } }, state(), ctx);
    expect(state().teamScore).toBe(before);
  });

  it('rejects everything once the run is finished', () => {
    const playerId = players[0]!.id;
    finishSync(state(), context(), 'timeout');
    expect(step(playerId).accepted).toBe(false);
    expect(jump(playerId).accepted).toBe(false);
  });

  /* ---------------- co-op result ---------------- */

  it('shares the score and result across both partners', () => {
    state().teamScore = 1200;
    state().levelsCleared = 3;
    state().syncSamples = 10;
    state().syncTotal = 850;
    finishSync(state(), context(), 'completed');

    const [aId, bId] = players.map((player) => player.id);
    expect(syncJumpGame.calculateScore(aId, state())).toBe(1200);
    expect(syncJumpGame.calculateScore(bId, state())).toBe(1200);

    const result = syncJumpGame.getResult(state(), context());
    expect(result.winners).toHaveLength(2);
    expect(result.rankings.every((entry) => entry.rank === 1 && entry.score === 1200)).toBe(true);
    expect(result.rankings[0]!.stats).toHaveProperty('syncScore');
    expect(result.rankings[0]!.stats!.syncScore).toBe(85);
  });

  /* ---------------- lifecycle ---------------- */

  it('keeps a disconnected runner and restores them on reconnect', () => {
    const playerId = players[0]!.id;
    state().players[playerId]!.x = 4;
    syncJumpGame.playerLeft(playerId, state(), context(), 'disconnect');
    expect(state().players[playerId]!.disconnected).toBe(true);
    expect(step(playerId).accepted).toBe(false);

    syncJumpGame.playerJoined({ ...players[0]! }, state(), context());
    expect(state().players[playerId]!.disconnected).toBe(false);
    expect(state().players[playerId]!.x).toBe(4); // progress preserved
  });

  it('an intentional leave ends the run', () => {
    const playerId = players[0]!.id;
    syncJumpGame.playerLeft(playerId, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('abandoned');
  });

  it('reset and cleanup prepare a rematch', () => {
    state().teamScore = 700;
    finishSync(state(), context(), 'completed');
    const next = syncJumpGame.reset(state());
    expect(next.phase).toBe('idle');
    expect(next.level).toBe(0);
    expect(next.teamScore).toBe(0);
    expect(next.syncMeter).toBe(100);
    expect(Object.values(next.players).every((runner) => runner.x === 0)).toBe(true);

    syncJumpGame.cleanup(next);
    expect(Object.keys(next.players)).toHaveLength(0);
    expect(next.course).toHaveLength(0);
  });

  /* ---------------- AI ---------------- */

  it('two AI partners jump hazards and finish a course together, in sync', () => {
    const ids = players.map((player) => player.id);
    let guard = 0;
    // Both seats driven by the AI, as in a Play-With-AI match.
    while (!bothFinished(state()) && guard < 600) {
      guard += 1;
      let moved = false;
      for (const id of ids) {
        if (state().players[id]!.finished) continue;
        const action = syncJumpGame.getAIMove?.(id, 'hard', state(), context());
        if (!action) continue;
        platform.gameManager.handleAction(room, id, action);
        moved = true;
      }
      if (!moved) break;
    }
    for (const id of ids) {
      expect(state().players[id]!.falls).toBe(0);
    }
    // The pair cleared the course, which only happens when BOTH finish.
    expect(state().levelsCleared).toBe(1);
  });

  it('the AI holds position when it gets too far ahead of its partner', () => {
    const [aId, bId] = players.map((player) => player.id);
    state().players[aId]!.x = 10;
    state().players[bId]!.x = 10 - SYNC_WINDOW; // partner lagging
    // A cooperative partner waits instead of running away.
    expect(syncJumpGame.getAIMove?.(aId, 'hard', state(), context())).toBeNull();
    // Once the partner catches up it moves again.
    state().players[bId]!.x = 10;
    expect(syncJumpGame.getAIMove?.(aId, 'hard', state(), context())).not.toBeNull();
  });

  it('the AI stops once finished or after the run ends', () => {
    const playerId = players[0]!.id;
    state().players[playerId]!.finished = true;
    expect(syncJumpGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
    state().players[playerId]!.finished = false;
    finishSync(state(), context(), 'timeout');
    expect(syncJumpGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
  });

  /* ---------------- public state ---------------- */

  it('publishes the course, the sync meter and both runners', () => {
    const view = platform.gameManager.getPublicState(room, players[0]!.id) as {
      course: string[];
      syncMeter: number;
      multiplier: number;
      players: Record<string, { x: number }>;
    };
    expect(view.course.length).toBe(state().length);
    expect(view.syncMeter).toBe(state().syncMeter);
    expect(view.multiplier).toBe(syncMultiplier(state().syncMeter));
    expect(Object.keys(view.players)).toHaveLength(2);
  });
});
