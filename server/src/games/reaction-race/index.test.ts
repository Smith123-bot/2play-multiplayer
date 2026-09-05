import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIN_HUMAN_REACTION_MS } from '@2play/shared';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import { reactionRaceGame, type ReactionRaceState } from './index';
import type { Room } from '../../rooms/Room';

describe('Reaction Race', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'reaction-race', { settings: { rounds: 1 } });
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as ReactionRaceState;
  const context = (): GameContext => platform.gameManager.getContext(room);

  it('starts in the waiting phase of round one', () => {
    expect(state().phase).toBe('waiting');
    expect(state().round).toBe(1);
    expect(state().totalRounds).toBe(1);
    expect(Object.values(state().scores).every((score) => score === 0)).toBe(true);
  });

  it('never exposes the GO timestamp before the signal', () => {
    const publicState = platform.gameManager.getPublicState(room, players[0]!.id) as {
      goAt: number | null;
      phase: string;
    };
    expect(publicState.phase).toBe('waiting');
    expect(publicState.goAt).toBeNull();
  });

  it('penalises a false start', () => {
    const playerId = players[0]!.id;
    const result = platform.gameManager.handleAction(room, playerId, { type: 'tap' });
    expect(result.accepted).toBe(true);
    expect(state().falseStarts).toContain(playerId);
    expect(state().scores[playerId]).toBe(0);
  });

  it('awards the round to the first valid reaction and measures it server side', async () => {
    await waitFor(() => state().phase === 'go', { timeoutMs: 8000 });
    const goAt = state().goAt;
    expect(goAt).toBeGreaterThan(0);

    // Respect the minimum human reaction window (anti-cheat).
    await new Promise((resolve) => setTimeout(resolve, MIN_HUMAN_REACTION_MS + 60));
    const playerId = players[0]!.id;
    platform.gameManager.handleAction(room, playerId, { type: 'tap' });

    const current = state();
    const entry = current.reacted[playerId];
    expect(entry?.falseStart).toBe(false);
    expect(entry?.timeMs ?? 0).toBeGreaterThanOrEqual(MIN_HUMAN_REACTION_MS);
    expect(current.roundWinner).toBe(playerId);
    expect(current.scores[playerId]).toBe(1);
  });

  it('rejects impossible reactions (faster than a human can be)', () => {
    const current = state();
    current.phase = 'go';
    current.goAt = Date.now();

    const playerId = players[0]!.id;
    platform.gameManager.handleAction(room, playerId, { type: 'tap' });

    const entry = current.reacted[playerId];
    expect(entry?.falseStart).toBe(true);
    expect(current.falseStarts).toContain(playerId);
    expect(current.scores[playerId]).toBe(0);
  });

  it('rejects unknown actions and late taps', () => {
    const playerId = players[0]!.id;
    const validation = reactionRaceGame.validateAction(playerId, { type: 'dance' }, state(), context());
    expect(validation.valid).toBe(false);

    state().phase = 'roundResult';
    expect(
      reactionRaceGame.validateAction(playerId, { type: 'tap' }, state(), context()).valid,
    ).toBe(false);
  });

  it('produces a full ranking once finished', async () => {
    await waitFor(() => state().phase === 'go', { timeoutMs: 8000 });
    await new Promise((resolve) => setTimeout(resolve, MIN_HUMAN_REACTION_MS + 60));
    platform.gameManager.handleAction(room, players[0]!.id, { type: 'tap' });

    await waitFor(() => state().phase === 'finished', { timeoutMs: 6000 });
    const draft = reactionRaceGame.getResult(state(), context());
    expect(draft.rankings).toHaveLength(2);
    expect(draft.rankings[0]!.playerId).toBe(players[0]!.id);
    expect(draft.rankings[0]!.score).toBe(1);
    expect(draft.winners).toContain(players[0]!.id);
  });

  it('lets the AI react with a tap action', () => {
    state().phase = 'go';
    state().goAt = Date.now();
    const move = reactionRaceGame.getAIMove?.(players[0]!.id, 'medium', state(), context());
    expect(move).toEqual({ type: 'tap' });
  });

  it('resets for a rematch', () => {
    state().scores[players[0]!.id] = 3;
    const reset = reactionRaceGame.reset(state());
    expect(reset.scores[players[0]!.id]).toBe(0);
    expect(reset.phase).toBe('idle');
    expect(reset.history).toHaveLength(0);
  });
});
