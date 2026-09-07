import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  beginNextShapeRound,
  buildRoundOptions,
  completeShapeRound,
  finishShapeOnTimeout,
  shapeMatchGame,
  type ShapeMatchState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Shape Match Battle', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'shape-match-battle', {
      settings: { rounds: 3 },
    });
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as ShapeMatchState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      target: { form: string; color: string } | null;
      options: Array<{ id: string; shape: { form: string; color: string } }>;
      correctOptionId: string | null;
      picked: Record<string, string>;
      mySelection: { optionId: string; correct: boolean; points: number } | null;
      round: number;
      totalRounds: number;
      endsAt: number | null;
      scores: Record<string, number>;
      history: Array<{ correctOptionId: string }>;
    };

  /* ---------------------------------------------------------------- */
  /* Round construction                                                */
  /* ---------------------------------------------------------------- */

  it('builds rounds with 4 distinct options and exactly one correct', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const { target, options, correctOptionId } = buildRoundOptions(() => seed / 31);
      expect(options).toHaveLength(4);
      const keys = new Set(options.map((option) => `${option.shape.form}:${option.shape.color}`));
      expect(keys.size).toBe(4); // all distinct
      const correct = options.find((option) => option.id === correctOptionId)!;
      expect(correct.shape).toEqual(target);
      expect(new Set(options.map((option) => option.id)).size).toBe(4);
    }
  });

  it('starts round 1 with a visible target and hidden answer', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    expect(state().round).toBe(1);
    expect(state().totalRounds).toBe(3);
    expect(state().current!.options).toHaveLength(4);
    expect(state().current!.endsAt).toBeGreaterThan(0);

    const view = publicState(players[0]!.id);
    expect(view.target).toEqual(state().current!.target);
    expect(view.options).toHaveLength(4);
    expect(view.correctOptionId).toBeNull();
    expect(view.endsAt).toBeGreaterThan(0);
  });

  /* ---------------------------------------------------------------- */
  /* Selections                                                        */
  /* ---------------------------------------------------------------- */

  it('scores correct picks (with speed bonus) and wrong picks nothing', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);
    const round = state().current!;

    const correctPick = platform.gameManager.handleAction(room, a, {
      type: 'select',
      payload: { optionId: round.correctOptionId },
    });
    expect(correctPick.accepted).toBe(true);
    expect(state().scores[a]).toBe(2); // 1 base + 1 fast bonus
    expect(state().current!.selections[a]!.correct).toBe(true);

    const wrongOption = round.options.find((option) => option.id !== round.correctOptionId)!;
    const wrongPick = platform.gameManager.handleAction(room, b, {
      type: 'select',
      payload: { optionId: wrongOption.id },
    });
    expect(wrongPick.accepted).toBe(true);
    expect(state().scores[b]).toBe(0);
    expect(state().current!.selections[b]!.correct).toBe(false);
  });

  it('rejects duplicate picks, invalid option ids and unknown actions', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const round = state().current!;

    expect(
      shapeMatchGame.validateAction(playerId, { type: 'guess' }, state(), context()).valid,
    ).toBe(false);
    expect(
      shapeMatchGame.validateAction(
        playerId,
        { type: 'select', payload: { optionId: 'shape-99' } },
        state(),
        context(),
      ),
    ).toEqual({ valid: false, reason: 'That option does not exist.' });
    expect(
      shapeMatchGame.validateAction(playerId, { type: 'select', payload: { optionId: 7 } }, state(), context())
        .valid,
    ).toBe(false);
    expect(
      shapeMatchGame.validateAction(playerId, { type: 'select' }, state(), context()).valid,
    ).toBe(false);

    platform.gameManager.handleAction(room, playerId, {
      type: 'select',
      payload: { optionId: round.options[0]!.id },
    });
    expect(
      shapeMatchGame.validateAction(
        playerId,
        { type: 'select', payload: { optionId: round.options[1]!.id } },
        state(),
        context(),
      ),
    ).toEqual({ valid: false, reason: 'You already picked this round.' });
  });

  /* ---------------------------------------------------------------- */
  /* Privacy                                                           */
  /* ---------------------------------------------------------------- */

  it('never leaks the correct option or correctness of picks during a round', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);
    const round = state().current!;

    // Only player a picks (correctly) — the round must stay in phase 'round'.
    platform.gameManager.handleAction(room, a, { type: 'select', payload: { optionId: round.correctOptionId } });
    expect(state().phase).toBe('round');

    const viewA = publicState(a);
    expect(viewA.correctOptionId).toBeNull();
    expect(viewA.picked).toEqual({ [a]: round.correctOptionId });
    expect(viewA.mySelection?.correct).toBe(true); // own pick is fine to know
    expect(JSON.stringify(viewA)).not.toContain('"correctOptionId":"shape-');

    // The opponent's pick is visible as an id, but its correctness must not
    // leak through another viewer's projection.
    const viewB = publicState(b);
    expect(viewB.correctOptionId).toBeNull();
    expect(viewB.mySelection).toBeNull();
    expect(JSON.stringify(viewB)).not.toContain('"correct":true');
    expect(JSON.stringify(viewB)).not.toContain('"correctOptionId":"shape-');

    // b picks wrong → everyone has picked → the round reveals the answer.
    const wrongOption = round.options.find((option) => option.id !== round.correctOptionId)!;
    platform.gameManager.handleAction(room, b, { type: 'select', payload: { optionId: wrongOption.id } });
    expect(state().phase).toBe('reveal');

    const revealed = publicState(a);
    expect(revealed.correctOptionId).toBe(round.correctOptionId);
    expect(revealed.history[0]!.correctOptionId).toBe(round.correctOptionId);
  });

  /* ---------------------------------------------------------------- */
  /* Round progression                                                 */
  /* ---------------------------------------------------------------- */

  it('ends the round early when every player has picked', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const round = state().current!;
    for (const player of players) {
      platform.gameManager.handleAction(room, player.id, {
        type: 'select',
        payload: { optionId: round.options[0]!.id },
      });
    }
    expect(state().phase).toBe('reveal');
  });

  it('progresses rounds and finishes after the final round', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    expect(state().totalRounds).toBe(3);

    completeShapeRound(state(), context());
    beginNextShapeRound(state(), context());
    expect(state().phase).toBe('round');
    expect(state().round).toBe(2);

    completeShapeRound(state(), context());
    beginNextShapeRound(state(), context());
    expect(state().round).toBe(3);

    completeShapeRound(state(), context());
    beginNextShapeRound(state(), context());
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('completed');
    expect(shapeMatchGame.isGameFinished(state())).toBe(true);
  });

  /* ---------------------------------------------------------------- */
  /* Timeout / result / draw / reset                                   */
  /* ---------------------------------------------------------------- */

  it('finishes with reason timeout when the match cap fires', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    finishShapeOnTimeout(state(), context());
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('timeout');
  });

  it('ranks by score and detects draws', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    state().phase = 'finished';
    state().scores[players[0]!.id] = 8;
    state().scores[players[1]!.id] = 5;
    state().correctCount[players[0]!.id] = 6;
    state().correctCount[players[1]!.id] = 4;

    const draft = shapeMatchGame.getResult(state(), context());
    expect(draft.winners).toEqual([players[0]!.id]);
    expect(draft.rankings[0]!.score).toBe(8);
    expect(draft.rankings[0]!.stats.correct).toBe(6);

    state().scores[players[1]!.id] = 8;
    const drawn = shapeMatchGame.getResult(state(), context());
    expect(drawn.isDraw).toBe(true);
    expect(drawn.winners).toHaveLength(2);
  });

  it('reset keeps every seat and zeroes the battle', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const seats = Object.keys(state().scores);
    state().scores[seats[0]!] = 6;

    const next = shapeMatchGame.reset(state());
    expect(Object.keys(next.scores)).toEqual(seats);
    expect(next.scores[seats[0]!]).toBe(0);
    expect(next.phase).toBe('idle');
    expect(next.current).toBeNull();
    expect(next.history).toEqual([]);
    expect(next.round).toBe(0);
    expect(shapeMatchGame.isGameFinished(next)).toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /* AI                                                                */
  /* ---------------------------------------------------------------- */

  it('AI picks valid options, respects one pick per round and scales with difficulty', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const round = state().current!;
    const optionIds = round.options.map((option) => option.id);

    let hardCorrect = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const move = shapeMatchGame.getAIMove?.(playerId, 'hard', state(), context());
      expect(move?.type).toBe('select');
      expect(optionIds).toContain(move?.payload?.optionId);
      if (move?.payload?.optionId === round.correctOptionId) hardCorrect += 1;
    }
    expect(hardCorrect).toBeGreaterThan(30); // hard ≈ 97%

    let easyCorrect = 0;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const move = shapeMatchGame.getAIMove?.(playerId, 'easy', state(), context());
      if (move?.payload?.optionId === round.correctOptionId) easyCorrect += 1;
    }
    // Compare accuracy rates — hard (≈97%) must clearly beat easy (≈60%).
    expect(hardCorrect / 40).toBeGreaterThan(easyCorrect / 60 + 0.2);

    state().current!.selections[playerId] = {
      optionId: round.options[0]!.id,
      correct: true,
      elapsedMs: 100,
      points: 1,
    };
    expect(shapeMatchGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();

    state().phase = 'reveal';
    expect(shapeMatchGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
  });

  /* ---------------------------------------------------------------- */
  /* Disconnect behaviour                                              */
  /* ---------------------------------------------------------------- */

  it('a disconnected player keeps their seat; a leaver stops blocking round ends', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);

    shapeMatchGame.playerLeft(a, state(), context(), 'disconnect');
    expect(state().phase).toBe('round');

    // a picks; b still pending → round continues.
    platform.gameManager.handleAction(room, a, {
      type: 'select',
      payload: { optionId: state()!.current!.options[0]!.id },
    });
    expect(state().phase).toBe('round');

    // b leaves → nobody unpicked remains → round completes early.
    shapeMatchGame.playerLeft(b, state(), context(), 'leave');
    expect(state().phase).toBe('reveal');
  });
});
