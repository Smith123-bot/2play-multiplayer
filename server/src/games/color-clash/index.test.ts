import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  beginNextClashRound,
  buildClashRound,
  completeClashRound,
  finishClash,
  colorClashGame,
  type ColorClashState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Color Clash', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'color-clash', {
      settings: { rounds: 4 },
    });
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as ColorClashState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      options: Array<{ id: string; color: { label: string } }>;
      correctOptionId: string | null;
      instruction: string | null;
      scores: Record<string, number>;
    };

  it('builds rounds with a hidden correct option and labelled colours', () => {
    for (let n = 1; n <= 8; n += 1) {
      const round = buildClashRound(() => 0.37, n);
      expect(round.options.length).toBeGreaterThanOrEqual(4);
      expect(round.options.some((option) => option.id === round.correctOptionId)).toBe(true);
      expect(round.options.every((option) => option.color.label.length > 0)).toBe(true);
    }
  });

  it('stroop correct option is the ink, not the written word', () => {
    const round = buildClashRound(() => 0.2, 2);
    expect(round.kind).toBe('stroop');
    expect(round.word).toBeTruthy();
    expect(round.wordInk).toBeTruthy();
    const correct = round.options.find((option) => option.id === round.correctOptionId)!;
    expect(correct.color.hex).toBe(round.wordInk);
  });

  it('hides the correct id during a round and reveals it after', async () => {
    await waitFor(() => state().phase === 'round' || state().phase === 'preview', { timeoutMs: 5000 });
    if (state().phase === 'preview') {
      state().phase = 'round';
    }
    await waitFor(() => state().current !== null, { timeoutMs: 2000 });
    const view = publicState(players[0]!.id);
    expect(view.correctOptionId).toBeNull();
    completeClashRound(state(), context());
    expect(publicState(players[0]!.id).correctOptionId).toBe(state().current!.correctOptionId);
  });

  it('scores the fastest correct pick 100 and later 75', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    if (state().phase !== 'round') state().phase = 'round';
    const a = players[0]!.id;
    const b = players[1]!.id;
    const correct = state().current!.correctOptionId;
    expect(
      platform.gameManager.handleAction(room, a, { type: 'pick', payload: { optionId: correct } }).accepted,
    ).toBe(true);
    expect(state().scores[a]).toBe(100);
    expect(
      platform.gameManager.handleAction(room, b, { type: 'pick', payload: { optionId: correct } }).accepted,
    ).toBe(true);
    expect(state().scores[b]).toBe(75);
  });

  it('wrong answers score 0 and lock the player out', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    if (state().phase !== 'round') state().phase = 'round';
    const playerId = players[0]!.id;
    const wrong = state().current!.options.find((option) => option.id !== state().current!.correctOptionId)!;
    expect(
      platform.gameManager.handleAction(room, playerId, { type: 'pick', payload: { optionId: wrong.id } }).accepted,
    ).toBe(true);
    expect(state().scores[playerId]).toBe(0);
    expect(state().wrongs[playerId]).toBe(1);
    expect(
      colorClashGame.validateAction(
        playerId,
        { type: 'pick', payload: { optionId: state().current!.correctOptionId } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
  });

  it('rejects unknown actions and picks outside a round', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    expect(colorClashGame.validateAction(playerId, { type: 'smash' }, state(), context()).valid).toBe(false);
    state().phase = 'reveal';
    expect(
      colorClashGame.validateAction(playerId, { type: 'pick', payload: { optionId: 'opt-0' } }, state(), context())
        .valid,
    ).toBe(false);
  });

  it('progresses all rounds and draws on equal scores', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    expect(state().totalRounds).toBe(4);
    state().scores[players[0]!.id] = 200;
    state().scores[players[1]!.id] = 200;
    const forceComplete = () => {
      if (state().phase === 'preview') state().phase = 'round';
      if (state().phase === 'round') completeClashRound(state(), context());
      beginNextClashRound(state(), context());
    };
    forceComplete();
    forceComplete();
    forceComplete();
    forceComplete();
    expect(state().phase).toBe('finished');
    const draft = colorClashGame.getResult(state(), context());
    expect(draft.isDraw).toBe(true);
  });

  it('timeout finishes the match', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    finishClash(state(), context(), 'timeout');
    expect(state().phase).toBe('finished');
  });

  it('reset keeps seats', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    const seats = Object.keys(state().scores);
    const next = colorClashGame.reset(state());
    expect(Object.keys(next.scores)).toEqual(seats);
    expect(next.phase).toBe('idle');
  });

  it('AI picks a valid option', async () => {
    await waitFor(() => state().current !== null, { timeoutMs: 5000 });
    if (state().phase !== 'round') state().phase = 'round';
    const ids = state().current!.options.map((option) => option.id);
    const move = colorClashGame.getAIMove?.(players[0]!.id, 'hard', state(), context());
    expect(move?.type).toBe('pick');
    expect(ids).toContain(move?.payload?.optionId);
  });
});
