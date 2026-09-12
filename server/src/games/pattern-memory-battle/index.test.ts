import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createGameFixture,
  createTestPlatform,
  waitFor,
  type TestPlatform,
} from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  advanceShow,
  beginInput,
  beginNextRound,
  buildPattern,
  completeRound,
  expireInput,
  patternLengthFor,
  patternMemoryGame,
  roundsFor,
  showStepFor,
  tileCountFor,
  type PatternMemoryState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Pattern Memory Battle', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'pattern-memory-battle');
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as PatternMemoryState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      round: number;
      totalRounds: number;
      patternLength: number;
      shown: number;
      flash: number | null;
      revealPattern: number[] | null;
      inputEndsAt: number | null;
      players: Record<
        string,
        { progress: number; locked: boolean; score: number; streak: number; mistakes: number }
      >;
    };

  /* ---------------------------------------------------------------- */
  /* Pattern generation + configuration                                */
  /* ---------------------------------------------------------------- */

  it('builds bounded patterns without immediate repeats', () => {
    let counter = 0;
    const rng = () => {
      counter = (counter * 1103515245 + 12345) % 2147483648;
      return (counter >>> 8) / 16777216;
    };
    for (let run = 0; run < 50; run += 1) {
      const pattern = buildPattern(5, rng);
      expect(pattern).toHaveLength(5);
      for (const tile of pattern) {
        expect(tile).toBeGreaterThanOrEqual(0);
        expect(tile).toBeLessThan(9);
      }
      for (let i = 1; i < pattern.length; i += 1) {
        expect(pattern[i]).not.toBe(pattern[i - 1]);
      }
    }
  });

  it('scales the pattern length and show speed with the round', () => {
    expect(patternLengthFor(1)).toBe(3);
    expect(patternLengthFor(2)).toBe(3);
    expect(patternLengthFor(3)).toBe(4);
    expect(patternLengthFor(9)).toBe(7); // capped
    expect(showStepFor(1)).toBeGreaterThan(showStepFor(8));
    expect(roundsFor(undefined)).toBe(8);
    expect(roundsFor(2)).toBe(3);
    expect(roundsFor(99)).toBe(15);
  });

  it('starts with round 1 in the show phase and a hidden pattern', async () => {
    await waitFor(() => state().phase === 'show', { timeoutMs: 5000 });
    expect(state().round).toBe(1);
    expect(state().pattern).toHaveLength(3);
    expect(state().shown).toBe(0);
    expect(state().players[players[0]!.id]!.score).toBe(0);
    // Flash appears only after the first advance.
    expect(publicState().flash).toBeNull();
  });

  /* ---------------------------------------------------------------- */
  /* Show → input transitions                                          */
  /* ---------------------------------------------------------------- */

  it('flashes every tile then opens the input phase', async () => {
    await waitFor(() => state().phase === 'show', { timeoutMs: 5000 });
    for (let i = 1; i <= 3; i += 1) {
      advanceShow(state(), context());
      expect(state().shown).toBe(i);
      expect(publicState().flash).toBe(state().pattern[i - 1]);
    }
    beginInput(state(), context());
    expect(state().phase).toBe('input');
    expect(state().inputEndsAt).toBeGreaterThan(context().now());
    // The pattern is hidden again during input.
    expect(publicState().flash).toBeNull();
    expect(publicState().revealPattern).toBeNull();
  });

  /* ---------------------------------------------------------------- */
  /* Input validation + scoring                                        */
  /* ---------------------------------------------------------------- */

  it('accepts correct taps, rejects invalid actions and locks wrong taps', async () => {
    await waitFor(() => state().phase === 'show', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);
    for (let i = 0; i < 3; i += 1) advanceShow(state(), context());
    beginInput(state(), context());

    // Invalid before anything: unknown action, bad tile, ghost, show phase.
    expect(patternMemoryGame.validateAction(a, { type: 'swipe' }, state(), context()).valid).toBe(
      false,
    );
    expect(
      patternMemoryGame.validateAction(a, { type: 'tap', payload: { tile: 9 } }, state(), context())
        .valid,
    ).toBe(false);
    expect(patternMemoryGame.validateAction(a, { type: 'tap' }, state(), context()).valid).toBe(
      false,
    );
    expect(
      patternMemoryGame.validateAction(
        'ghost',
        { type: 'tap', payload: { tile: 0 } },
        state(),
        context(),
      ).valid,
    ).toBe(false);

    // Correct first tile.
    const tap1 = platform.gameManager.handleAction(room, a, {
      type: 'tap',
      payload: { tile: state().pattern[0] },
    });
    expect(tap1.accepted).toBe(true);
    expect(state().players[a]!.progress).toBe(1);

    // Wrong second tile → locked, mistake recorded, streak reset.
    const correct1 = state().pattern[1]!;
    const wrong = correct1 === 0 ? 1 : correct1 - 1;
    const tap2 = platform.gameManager.handleAction(room, a, {
      type: 'tap',
      payload: { tile: wrong },
    });
    expect(tap2.accepted).toBe(true);
    expect(state().players[a]!.locked).toBe(true);
    expect(state().players[a]!.mistakes).toBe(1);
    expect(
      patternMemoryGame.validateAction(a, { type: 'tap', payload: { tile: 0 } }, state(), context())
        .valid,
    ).toBe(false); // locked

    // Rival replays perfectly.
    for (let i = 0; i < 3; i += 1) {
      platform.gameManager.handleAction(room, b, {
        type: 'tap',
        payload: { tile: state().pattern[i] },
      });
    }
    expect(state().players[b]!.succeeded).toBe(true);
    expect(state().players[b]!.score).toBeGreaterThanOrEqual(30);
    expect(state().players[b]!.score).toBeLessThanOrEqual(30 + 15 + 0); // 30 + max speed bonus

    // Both locked → reveal exposes the pattern.
    expect(state().phase).toBe('reveal');
    expect(publicState().revealPattern).toEqual(state().pattern);
  });

  it('scores streak bonuses on consecutive perfect rounds', async () => {
    await waitFor(() => state().phase === 'show', { timeoutMs: 5000 });
    const a = players[0]!.id;
    state().players[a]!.streak = 3; // pretend three straight perfects

    for (let i = 0; i < 3; i += 1) advanceShow(state(), context());
    beginInput(state(), context());
    state().inputStartedAt = context().now() - 2000; // burn some clock → small speed bonus
    for (let i = 0; i < 3; i += 1) {
      platform.gameManager.handleAction(room, a, {
        type: 'tap',
        payload: { tile: state().pattern[i] },
      });
    }
    // 30 base + speed(≥0) + streak bonus 6 (capped at 2×3).
    expect(state().players[a]!.score).toBeGreaterThanOrEqual(36);
    expect(state().players[a]!.streak).toBe(4);
    expect(state().players[a]!.completedRounds).toBe(1);
  });

  it('input timeout fails everyone unfinished', async () => {
    await waitFor(() => state().phase === 'show', { timeoutMs: 5000 });
    for (let i = 0; i < 3; i += 1) advanceShow(state(), context());
    beginInput(state(), context());
    expireInput(state(), context());
    for (const player of Object.values(state().players)) {
      expect(player.locked).toBe(true);
      expect(player.succeeded).toBe(false);
    }
    expect(state().phase).toBe('reveal');
  });

  /* ---------------------------------------------------------------- */
  /* Round progression + finish                                        */
  /* ---------------------------------------------------------------- */

  it('progresses rounds with longer patterns and finishes after the last', async () => {
    await waitFor(() => state().phase === 'show', { timeoutMs: 5000 });
    state().totalRounds = 2;
    for (let i = 0; i < 3; i += 1) advanceShow(state(), context());
    beginInput(state(), context());
    completeRound(state(), context()); // both fail
    expect(state().phase).toBe('reveal');
    expect(state().history).toHaveLength(1);

    beginNextRound(state(), context());
    expect(state().phase).toBe('show');
    expect(state().round).toBe(2);
    expect(state().patternLength).toBe(3); // round 2 still length 3

    for (let i = 0; i < 3; i += 1) advanceShow(state(), context());
    beginInput(state(), context());
    completeRound(state(), context());
    beginNextRound(state(), context());
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('completed');
    expect(patternMemoryGame.checkWinCondition(state())).toHaveLength(2); // 0:0 draw
    expect(patternMemoryGame.checkDrawCondition(state())).toBe(true);
  });

  it('ranks by score and declares a single winner', async () => {
    await waitFor(() => state().phase === 'show', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);
    state().phase = 'finished';
    state().players[a]!.score = 120;
    state().players[b]!.score = 90;

    const draft = patternMemoryGame.getResult(state(), context());
    expect(draft.winners).toEqual([a]);
    expect(draft.isDraw).toBe(false);
    expect(draft.rankings[0]!.playerId).toBe(a);
  });

  /* ---------------------------------------------------------------- */
  /* Leaves / reset                                                    */
  /* ---------------------------------------------------------------- */

  it('a leaver is excluded; the last active player still finishes rounds', async () => {
    await waitFor(() => state().phase === 'show', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);

    patternMemoryGame.playerLeft(b, state(), context(), 'leave');
    expect(state().departed[b]).toBe(true);
    expect(state().phase).toBe('show'); // match continues

    // Round runs with one active player; their mistake ends the round.
    for (let i = 0; i < 3; i += 1) advanceShow(state(), context());
    beginInput(state(), context());
    const correct = state().pattern[0]!;
    platform.gameManager.handleAction(room, a, {
      type: 'tap',
      payload: { tile: correct === 0 ? 1 : 0 },
    });
    expect(state().phase).toBe('reveal'); // sole active player locked → round done

    // Disconnect just flags (reconnection window).
    patternMemoryGame.playerLeft(a, state(), context(), 'disconnect');
    expect(state().players[a]!.disconnected).toBe(true);
  });

  it('reset clears scores and history for a rematch', async () => {
    await waitFor(() => state().phase === 'show', { timeoutMs: 5000 });
    const seats = Object.keys(state().players);
    state().players[seats[0]!]!.score = 90;
    state().history.push({ round: 1, length: 3, pattern: [1, 2, 3], outcomes: {} });

    const next = patternMemoryGame.reset(state());
    expect(Object.keys(next.players)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.round).toBe(0);
    expect(next.history).toHaveLength(0);
    expect(next.players[seats[0]!]!.score).toBe(0);
  });

  /* ---------------------------------------------------------------- */
  /* AI + privacy                                                      */
  /* ---------------------------------------------------------------- */

  it('AI replays the hidden pattern with difficulty-scaled accuracy', async () => {
    await waitFor(() => state().phase === 'show', { timeoutMs: 5000 });
    const a = players[0]!.id;
    for (let i = 0; i < 3; i += 1) advanceShow(state(), context());
    beginInput(state(), context());

    let correct = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const move = patternMemoryGame.getAIMove?.(a, 'hard', state(), context());
      expect(move?.type).toBe('tap');
      if (move?.payload?.tile === state().pattern[0]) correct += 1;
    }
    expect(correct).toBeGreaterThan(30); // ~97% accuracy

    // Outside the input phase the AI stays quiet.
    state().phase = 'reveal';
    expect(patternMemoryGame.getAIMove?.(a, 'hard', state(), context())).toBeNull();
  });

  it('the hidden pattern never appears in the public state before reveal', async () => {
    await waitFor(() => state().phase === 'show', { timeoutMs: 5000 });
    advanceShow(state(), context());
    const json = JSON.stringify(publicState(players[0]!.id));
    expect(json).not.toContain('"revealPattern":[^n]'); // literal sanity
    expect(publicState().revealPattern).toBeNull();
    for (const viewer of players) {
      expect(publicState(viewer.id).revealPattern).toBeNull();
    }
    // One tile flashing at a time only.
    expect(publicState().flash).toBe(state().pattern[0]);
    advanceShow(state(), context());
    expect(publicState().flash).toBe(state().pattern[1]);
  });

  it('progresses through authoritative 2x2, 3x2 and 3x3 layouts', () => {
    expect([1, 3, 6].map(tileCountFor)).toEqual([4, 6, 9]);
    const compact = buildPattern(6, () => 0.74, 4);
    expect(compact.every((tile) => tile >= 0 && tile < 4)).toBe(true);
  });

  it('rejects duplicate input sequences and records historical best streak', async () => {
    await waitFor(() => state().phase === 'show', { timeoutMs: 5000 });
    state().phase = 'input';
    state().pattern = [0, 1];
    state().patternLength = 2;
    state().tileCount = 4;
    const id = players[0]!.id;
    expect(
      platform.gameManager.handleAction(room, id, {
        type: 'tap',
        payload: { tile: 0, sequence: 5 },
      }).accepted,
    ).toBe(true);
    expect(
      platform.gameManager.handleAction(room, id, {
        type: 'tap',
        payload: { tile: 1, sequence: 5 },
      }).accepted,
    ).toBe(false);
    state().players[id]!.streak = 3;
    state().players[id]!.bestStreak = 4;
    const result = patternMemoryGame.getResult(state(), context());
    expect(result.rankings.find((entry) => entry.playerId === id)?.stats.bestStreak).toBe(4);
  });
});
