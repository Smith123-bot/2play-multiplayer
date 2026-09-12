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
});
