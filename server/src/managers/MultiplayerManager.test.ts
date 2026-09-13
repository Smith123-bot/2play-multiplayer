import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform, type TestPlatform } from '../test/harness';
import type { Room } from '../rooms/Room';
import type { MemoryMatchState } from '../games/memory-match';

describe('MultiplayerManager security boundary', () => {
  let harness: TestPlatform;
  let room: Room;

  beforeEach(async () => {
    harness = createTestPlatform();
    room = (await createGameFixture(harness.platform, 'memory-match')).room;
    harness.clearEmissions();
  });

  afterEach(() => harness.destroy());

  it('never broadcasts raw game-action payloads or rejected actions', () => {
    const state = room.gameState as MemoryMatchState;
    const playerId = state.currentPlayerId!;
    const cardId = state.cards[0]!.id;
    const accepted = harness.platform.multiplayerManager.submitAction(room, playerId, {
      type: 'flip',
      payload: { cardId },
    });
    expect(accepted.accepted).toBe(true);

    const actionEvent = harness.emissions.find((entry) =>
      entry.event.endsWith(':game:player-action'),
    );
    expect(actionEvent?.payload).toMatchObject({
      playerId,
      action: { type: 'flip' },
      accepted: true,
    });
    expect(JSON.stringify(actionEvent?.payload)).not.toContain('cardId');

    harness.clearEmissions();
    const rejected = harness.platform.multiplayerManager.submitAction(room, playerId, {
      type: 'flip',
      payload: { cardId: 999 },
    });
    expect(rejected.accepted).toBe(false);
    expect(harness.emissions.some((entry) => entry.event.endsWith(':game:player-action'))).toBe(
      false,
    );
  });

  /**
   * The low-latency path (an immediate snapshot to the acting player, so they
   * do not wait out the broadcast throttle) sends state too, so it has to obey
   * exactly the same information-hiding rules as the room broadcast.
   */
  it('leaks no hidden information on the immediate snapshot to the acting player', () => {
    const state = room.gameState as MemoryMatchState;
    const playerId = state.currentPlayerId!;
    const flipped = state.cards[0]!;

    harness.clearEmissions();
    const accepted = harness.platform.multiplayerManager.submitAction(room, playerId, {
      type: 'flip',
      payload: { cardId: flipped.id },
    });
    expect(accepted.accepted).toBe(true);
    expect(accepted.stateChanged).toBe(true);

    const frame = harness.emissions.find((entry) => entry.event === `${playerId}:room:updated`);
    expect(frame, 'the acting player should get an immediate snapshot').toBeDefined();

    const sent = (
      frame!.payload as {
        room: { gameState: { cards: Array<{ id: number; symbol: string | null }> } };
      }
    ).room.gameState.cards;

    expect(sent.find((card) => card.id === flipped.id)?.symbol).toBe(flipped.symbol);

    // Every card that is still face down on the server stays face down here.
    const isHidden = (id: number): boolean =>
      !state.selection.includes(id) && state.cards.find((card) => card.id === id)!.matchedBy === null;

    for (const card of sent) {
      if (isHidden(card.id)) {
        expect(card.symbol, `leaked the symbol of hidden card ${card.id}`).toBeNull();
      }
    }

    // The full server-side layout must never be serialised onto the wire, and
    // no raw action payload rides along either.
    const serialised = JSON.stringify(frame!.payload);
    expect(serialised).not.toContain('cardId');

    // A hidden card's twin is legitimately face up, so only symbols that are
    // not revealed anywhere may be absent from the frame.
    const revealedSymbols = new Set(
      state.cards.filter((card) => !isHidden(card.id)).map((card) => card.symbol),
    );
    const secretSymbols = state.cards
      .filter((card) => isHidden(card.id) && !revealedSymbols.has(card.symbol))
      .map((card) => card.symbol);
    expect(secretSymbols.length).toBeGreaterThan(0);
    for (const symbol of secretSymbols) {
      expect(serialised, `leaked hidden symbol "${symbol}"`).not.toContain(
        `"symbol":"${symbol}"`,
      );
    }
  });
});
