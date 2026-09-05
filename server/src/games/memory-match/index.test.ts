import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, waitFor, type TestPlatform } from '../../test/harness';
import type { Platform } from '../../core/Platform';
import type { GameContext, GamePlayerView } from '../GameModule';
import { memoryMatchGame, type MemoryMatchState } from './index';
import type { Room } from '../../rooms/Room';

describe('Memory Match', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let room: Room;
  let players: GamePlayerView[];

  beforeEach(async () => {
    harness = createTestPlatform();
    platform = harness.platform;
    const fixture = await createGameFixture(platform, 'memory-match', {
      settings: { gridSize: '4x4' },
    });
    room = fixture.room;
    players = platform.gameManager.playerViews(room);
  });

  afterEach(() => harness.destroy());

  const state = () => room.gameState as MemoryMatchState;
  const context = (): GameContext => platform.gameManager.getContext(room);
  const publicState = (viewerId?: string) =>
    platform.gameManager.getPublicState(room, viewerId) as {
      cards: Array<{ id: number; symbol: string | null; revealed: boolean }>;
      currentPlayerId: string | null;
      totalPairs: number;
    };

  it('builds a shuffled deck of pairs', () => {
    const current = state();
    expect(current.cards).toHaveLength(16);
    expect(current.totalPairs).toBe(8);
    const counts = new Map<string, number>();
    for (const card of current.cards) counts.set(card.symbol, (counts.get(card.symbol) ?? 0) + 1);
    expect([...counts.values()].every((count) => count === 2)).toBe(true);
    expect(counts.size).toBe(8);
  });

  it('NEVER sends hidden card identities to clients', () => {
    const view = publicState(players[0]!.id);
    expect(view.cards).toHaveLength(16);
    expect(view.cards.every((card) => card.symbol === null)).toBe(true);
    expect(view.cards.every((card) => card.revealed === false)).toBe(true);
  });

  it('only reveals the cards that are currently flipped or matched', () => {
    const current = state();
    const cardId = current.cards[0]!.id;
    platform.gameManager.handleAction(room, current.currentPlayerId!, {
      type: 'flip',
      payload: { cardId },
    });

    const view = publicState(players[0]!.id);
    const flipped = view.cards.find((card) => card.id === cardId);
    expect(flipped?.revealed).toBe(true);
    expect(flipped?.symbol).toBe(current.cards[0]!.symbol);
    expect(view.cards.filter((card) => card.symbol !== null)).toHaveLength(1);
  });

  it('rejects flips out of turn, of matched cards and of unknown cards', () => {
    const current = state();
    const notTurn = players.find((player) => player.id !== current.currentPlayerId)!;

    const validation = memoryMatchGame.validateAction(
      notTurn.id,
      { type: 'flip', payload: { cardId: 0 } },
      current,
      context(),
    );
    expect(validation.valid).toBe(false);

    const turnPlayer = current.currentPlayerId!;
    platform.gameManager.handleAction(room, turnPlayer, { type: 'flip', payload: { cardId: 0 } });
    expect(
      memoryMatchGame.validateAction(
        turnPlayer,
        { type: 'flip', payload: { cardId: 0 } },
        state(),
        context(),
      ).valid,
    ).toBe(false);

    expect(
      memoryMatchGame.validateAction(
        turnPlayer,
        { type: 'flip', payload: { cardId: 999 } },
        state(),
        context(),
      ).valid,
    ).toBe(false);
  });

  it('keeps the turn on a match and passes it on a miss', async () => {
    const current = state();
    const turnPlayer = current.currentPlayerId!;

    // Force a known match: flip the two cards holding the same symbol.
    const first = current.cards[0]!;
    const partner = current.cards.find((card) => card.symbol === first.symbol && card.id !== first.id)!;

    platform.gameManager.handleAction(room, turnPlayer, { type: 'flip', payload: { cardId: first.id } });
    platform.gameManager.handleAction(room, turnPlayer, {
      type: 'flip',
      payload: { cardId: partner.id },
    });

    await waitFor(() => state().phase === 'playing', { timeoutMs: 4000 });
    expect(state().pairs[turnPlayer]).toBe(1);
    expect(state().currentPlayerId).toBe(turnPlayer);
    expect(state().matchedPairs).toBe(1);

    // Miss: two cards with different symbols.
    const remaining = state().cards.filter((card) => card.matchedBy === null);
    const a = remaining[0]!;
    const b = remaining.find((card) => card.symbol !== a.symbol)!;
    platform.gameManager.handleAction(room, turnPlayer, { type: 'flip', payload: { cardId: a.id } });
    platform.gameManager.handleAction(room, turnPlayer, { type: 'flip', payload: { cardId: b.id } });

    await waitFor(() => state().phase === 'playing', { timeoutMs: 4000 });
    expect(state().currentPlayerId).not.toBe(turnPlayer);
    expect(state().pairs[turnPlayer]).toBe(1);
  });

  it('finishes the match and ranks by pairs', () => {
    const current = state();
    const [first, second] = players;
    for (const card of current.cards) card.matchedBy = first!.id;
    current.matchedPairs = current.totalPairs;
    current.pairs[first!.id] = current.totalPairs;
    current.phase = 'finished';
    current.selection = [];

    const draft = memoryMatchGame.getResult(current, context());
    expect(draft.winners).toEqual([first!.id]);
    expect(draft.rankings[0]!.playerId).toBe(first!.id);
    expect(draft.rankings[0]!.score).toBe(8);
    expect(draft.rankings[1]!.playerId).toBe(second!.id);
  });

  it('AI only ever selects legal cards', () => {
    const current = state();
    const aiPlayer = players[0]!;
    current.currentPlayerId = aiPlayer.id;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const move = memoryMatchGame.getAIMove?.(aiPlayer.id, 'hard', current, context());
      expect(move).not.toBeNull();
      const cardId = Number(move?.payload?.cardId);
      const card = current.cards.find((entry) => entry.id === cardId);
      expect(card).toBeDefined();
      expect(card?.matchedBy).toBeNull();
      expect(current.selection).not.toContain(cardId);
    }
  });

  it('resets the board for a rematch', () => {
    state().cards[0]!.matchedBy = players[0]!.id;
    state().matchedPairs = 1;
    const reset = memoryMatchGame.reset(state());
    expect(reset.cards.every((card) => card.matchedBy === null)).toBe(true);
    expect(reset.matchedPairs).toBe(0);
    expect(Object.values(reset.pairs).every((value) => value === 0)).toBe(true);
  });
});
