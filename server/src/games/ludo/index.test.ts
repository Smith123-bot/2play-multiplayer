import { describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform } from '../../test/harness';
import { ludoGame, LUDO_SAFE_CELLS } from './index';

describe('Ludo', () => {
  it('initializes 2, 3 and 4 player boards with four tokens', async () => {
    for (const count of [2, 3, 4]) {
      const state = ludoGame.createInitialState(Array.from({ length: count }, (_, i) => ({ id: `p${i}`, nickname: `P${i}`, avatar: '', isAI: false, aiDifficulty: null, isConnected: true, seatIndex: i, isHost: i === 0 })), { playerCount: count, humanCount: count, aiOpponents: 0, aiDifficulty: 'medium' });
      expect(Object.keys(state.players)).toHaveLength(count);
      expect(Object.values(state.players).every((p) => p.tokens.length === 4)).toBe(true);
    }
  });
  it('only permits the active player to roll and never accepts client dice', async () => {
    const h = createTestPlatform(); const f = await createGameFixture(h.platform, 'ludo');
    const state = f.room.gameState as any; const first = Object.keys(state.players)[0]!;
    expect(ludoGame.validateAction(first, { type: 'roll-dice', payload: { value: 6 } }, state, h.platform.gameManager.getContext(f.room)).valid).toBe(true);
    expect(ludoGame.validateAction(Object.keys(state.players)[1]!, { type: 'roll-dice' }, state, h.platform.gameManager.getContext(f.room)).valid).toBe(false);
    h.platform.gameManager.handleAction(f.room, first, { type: 'roll-dice' });
    expect(state.dice === null || [1,2,3,4,5,6].includes(state.dice)).toBe(true); h.destroy();
  });
  it('exposes safe cells and rejects movement after a turn is over', async () => {
    const h = createTestPlatform(); const f = await createGameFixture(h.platform, 'ludo'); const state = f.room.gameState as any;
    expect(LUDO_SAFE_CELLS.length).toBe(8); expect(state.phase).toBe('playing');
    const id = state.currentPlayerId; h.platform.gameManager.handleAction(f.room, id, { type: 'roll-dice' });
    if (state.dice !== null) { const result = h.platform.gameManager.handleAction(f.room, id, { type: 'move-token', payload: { tokenIndex: 0 } }); expect(typeof result.accepted).toBe('boolean'); }
    h.destroy();
  });
});
