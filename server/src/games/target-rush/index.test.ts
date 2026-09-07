import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import {
  beginNextRushRound,
  buildRound,
  completeRushRound,
  finishRushOnTimeout,
  targetRushGame,
  type TargetRushState,
} from './index';
import type { Room } from '../../rooms/Room';

describe('Target Rush', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'target-rush', {
      settings: { rounds: 3 },
    });
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as TargetRushState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      phase: string;
      prompt: string | null;
      targets: Array<{ id: string; symbol: string; x: number; y: number }>;
      correctId: string | null;
      tapped: Record<string, boolean>;
      scores: Record<string, number>;
      streaks: Record<string, number>;
      endsAt: number | null;
      history: Array<{ correctId: string; winner: string | null }>;
    };

  /* ---------------------------------------------------------------- */
  /* Round construction                                                */
  /* ---------------------------------------------------------------- */

  it('builds rounds with 3 distinct targets, one matching the prompt', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const round = buildRound(() => seed / 41, seed + 1);
      expect(round.targets).toHaveLength(3);
      // Distinct cells → no overlapping touch targets.
      const cells = new Set(round.targets.map((t) => `${t.x},${t.y}`));
      expect(cells.size).toBe(3);
      // Distinct symbols and exactly one matching the prompt.
      const symbols = new Set(round.targets.map((t) => t.symbol));
      expect(symbols.size).toBe(3);
      const matching = round.targets.filter((t) => t.symbol === round.prompt);
      expect(matching).toHaveLength(1);
      expect(matching[0]!.id).toBe(round.correctId);
    }
  });

  it('starts round 1 with a prompt and a hidden correct id', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    expect(state().round).toBe(1);
    expect(state().totalRounds).toBe(3);
    expect(state().current!.targets).toHaveLength(3);
    expect(state().current!.endsAt).toBeGreaterThan(0);

    const view = publicState(players[0]!.id);
    expect(view.prompt).toBe(state().current!.prompt);
    expect(view.correctId).toBeNull();
    expect(view.targets).toHaveLength(3);
  });

  /* ---------------------------------------------------------------- */
  /* Hits                                                              */
  /* ---------------------------------------------------------------- */

  it('scores correct hits with speed + combo bonuses', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const correctId = state().current!.correctId;

    const result = platform.gameManager.handleAction(room, playerId, {
      type: 'hit',
      payload: { targetId: correctId },
    });
    expect(result.accepted).toBe(true);
    // Instant tap → 10 base + 10 speed + 0 combo (no prior streak).
    expect(state().scores[playerId]).toBe(20);
    expect(state().hits[playerId]).toBe(1);
    expect(state().streaks[playerId]).toBe(1);
    expect(state().history[0]!.winner).toBe(playerId);
    expect(state().phase).toBe('reveal'); // round ended immediately
  });

  it('wrong target: no points, streak broken, short lockout, round continues', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const wrong = state().current!.targets.find((t) => t.id !== state().current!.correctId)!;
    state().streaks[playerId] = 3;

    const result = platform.gameManager.handleAction(room, playerId, {
      type: 'hit',
      payload: { targetId: wrong.id },
    });
    expect(result.accepted).toBe(true);
    expect(state().scores[playerId]).toBe(0);
    expect(state().wrongs[playerId]).toBe(1);
    expect(state().streaks[playerId]).toBe(0);
    expect(state().lockUntil[playerId]).toBeGreaterThan(0);
    expect(state().phase).toBe('round'); // the other player can still win it

    // Locked out + already tapped → duplicate taps rejected.
    expect(
      targetRushGame.validateAction(
        playerId,
        { type: 'hit', payload: { targetId: state()!.current!.correctId } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
  });

  it('rejects unknown actions, bogus ids and taps outside a round', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const playerId = players[0]!.id;

    expect(targetRushGame.validateAction(playerId, { type: 'shoot' }, state(), context()).valid).toBe(false);
    expect(
      targetRushGame.validateAction(playerId, { type: 'hit', payload: { targetId: 'target-99' } }, state(), context())
        .valid,
    ).toBe(false);
    expect(targetRushGame.validateAction(playerId, { type: 'hit', payload: { targetId: 5 } }, state(), context()).valid).toBe(
      false,
    );

    state().phase = 'reveal';
    expect(
      targetRushGame.validateAction(playerId, { type: 'hit', payload: { targetId: 'target-0' } }, state(), context())
        .valid,
    ).toBe(false);
    state().phase = 'round';
  });

  it('expired rounds score nothing and reset streaks', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    state().streaks[players[0]!.id] = 2;
    state().streaks[players[1]!.id] = 4;

    completeRushRound(state(), context(), null);
    expect(state().phase).toBe('reveal');
    expect(state().history[0]!.winner).toBeNull();
    expect(state().scores[players[0]!.id]).toBe(0);
    expect(state().streaks[players[0]!.id]).toBe(2); // winner-losing resets only apply on a win
  });

  /* ---------------------------------------------------------------- */
  /* Privacy                                                           */
  /* ---------------------------------------------------------------- */

  it('never leaks the correct id during a round, reveals it between rounds', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const view = publicState(players[0]!.id);
    expect(view.correctId).toBeNull();
    expect(JSON.stringify(view)).not.toContain(`"correctId":"${state().current!.correctId}"`);

    completeRushRound(state(), context(), players[0]!.id);
    const revealed = publicState(players[0]!.id);
    expect(revealed.correctId).toBe(state().current!.correctId);
    expect(revealed.history[0]!.correctId).toBe(state().current!.correctId);
  });

  /* ---------------------------------------------------------------- */
  /* Round progression / finish / result                               */
  /* ---------------------------------------------------------------- */

  it('progresses through all rounds and finishes with a winner', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    expect(state().totalRounds).toBe(3);

    state().scores[players[0]!.id] = 55;
    state().scores[players[1]!.id] = 40;

    completeRushRound(state(), context(), players[0]!.id);
    beginNextRushRound(state(), context());
    expect(state().round).toBe(2);
    expect(state().phase).toBe('round');

    completeRushRound(state(), context(), players[1]!.id);
    beginNextRushRound(state(), context());
    expect(state().round).toBe(3);

    completeRushRound(state(), context(), null);
    beginNextRushRound(state(), context());
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('completed');

    const draft = targetRushGame.getResult(state(), context());
    expect(draft.winners).toEqual([players[0]!.id]);
    expect(draft.rankings[0]!.score).toBe(55);
    expect(draft.isDraw).toBe(false);
  });

  it('timeout finishes the match and equal scores draw', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    finishRushOnTimeout(state(), context());
    expect(state().phase).toBe('finished');
    expect(state().finishReason).toBe('timeout');
    expect(targetRushGame.isGameFinished(state())).toBe(true);

    state().scores[players[0]!.id] = 30;
    state().scores[players[1]!.id] = 30;
    const draft = targetRushGame.getResult(state(), context());
    expect(draft.isDraw).toBe(true);
    expect(draft.winners).toHaveLength(2);
  });

  /* ---------------------------------------------------------------- */
  /* Reset / AI / disconnect                                           */
  /* ---------------------------------------------------------------- */

  it('reset keeps both seats and zeroes the duel', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const seats = Object.keys(state().scores);
    state().scores[seats[0]!] = 60;
    state().streaks[seats[0]!] = 3;

    const next = targetRushGame.reset(state());
    expect(Object.keys(next.scores)).toEqual(seats);
    expect(next.phase).toBe('idle');
    expect(next.current).toBeNull();
    expect(next.history).toEqual([]);
    expect(next.scores[seats[0]!]).toBe(0);
    expect(next.streaks[seats[0]!]).toBe(0);
  });

  it('AI taps valid targets with difficulty-scaled accuracy', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const playerId = players[0]!.id;
    const ids = state().current!.targets.map((t) => t.id);

    let hard = 0;
    for (let i = 0; i < 40; i += 1) {
      const move = targetRushGame.getAIMove?.(playerId, 'hard', state(), context());
      expect(move?.type).toBe('hit');
      expect(ids).toContain(move?.payload?.targetId);
      if (move?.payload?.targetId === state().current!.correctId) hard += 1;
    }
    expect(hard).toBeGreaterThan(30);

    let easy = 0;
    for (let i = 0; i < 60; i += 1) {
      const move = targetRushGame.getAIMove?.(playerId, 'easy', state(), context());
      if (move?.payload?.targetId === state().current!.correctId) easy += 1;
    }
    expect(hard / 40).toBeGreaterThan(easy / 60 + 0.2);

    state().current!.tapped[playerId] = true;
    expect(targetRushGame.getAIMove?.(playerId, 'hard', state(), context())).toBeNull();
  });

  it('a disconnected player keeps their seat; last leaver ends the match', async () => {
    await waitFor(() => state().phase === 'round', { timeoutMs: 5000 });
    const [a, b] = players.map((player) => player.id);

    targetRushGame.playerLeft(a, state(), context(), 'disconnect');
    expect(state().phase).toBe('round');

    targetRushGame.playerLeft(a, state(), context(), 'leave');
    expect(['round', 'reveal']).toContain(state().phase); // b may still be playing

    targetRushGame.playerLeft(b, state(), context(), 'leave');
    expect(state().phase).toBe('finished');
  });
});
