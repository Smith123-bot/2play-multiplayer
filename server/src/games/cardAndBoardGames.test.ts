import { describe, expect, it } from 'vitest';
import { createCardBoardGame, type DominoState, type SimState, type UnoState } from './cardAndBoardGames';
import { UNO_METADATA, SIM_METADATA, DOMINOES_METADATA } from '@2play/shared';
import { createGameFixture, createTestPlatform } from '../test/harness';

const players = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `p${i}`, nickname: `P${i}`, avatar: '', isAI: false, aiDifficulty: null, isConnected: true, seatIndex: i, isHost: i === 0 }));
const config = (n: number) => ({ playerCount: n, humanCount: n, aiOpponents: 0, aiDifficulty: 'medium' as const, seed: 42 });

describe('UNO, Sim and Dominoes authoritative rules', () => {
  it('creates a 108-card UNO round and never exposes another hand', () => {
    const game = createCardBoardGame(UNO_METADATA, 'uno');
    const s = game.createInitialState(players(4), config(4)) as UnoState;
    expect(s.deck.length + s.discard.length + Object.values(s.hands).flat().length).toBe(108);
    expect(s.hands.p0).toHaveLength(7);
    expect((game.getPublicState(s, 'p0', { now: () => 0 } as never) as any).hands.p1.every((c: any) => c.id === 'hidden')).toBe(true);
  });
  it('builds all fifteen Sim edges and rejects occupied or wrong-turn edges', async () => {
    const game = createCardBoardGame(SIM_METADATA, 'sim'); const s = game.createInitialState(players(2), config(2)) as SimState;
    expect(Object.keys(s.edges)).toHaveLength(15);
    const h = createTestPlatform(); const f = await createGameFixture(h.platform, 'sim'); const state = f.room.gameState as SimState; const id = state.currentPlayerId!;
    expect(game.validateAction(id, { type: 'edge', payload: { edge: '0-1' } }, state, h.platform.gameManager.getContext(f.room)).valid).toBe(true);
    h.platform.gameManager.handleAction(f.room, id, { type: 'edge', payload: { edge: '0-1' } });
    expect(game.validateAction(id, { type: 'edge', payload: { edge: '0-1' } }, state, h.platform.gameManager.getContext(f.room)).valid).toBe(false); h.destroy();
  });
  it('creates 28 unique dominoes, deals by player count, and hides opponents', () => {
    const game = createCardBoardGame(DOMINOES_METADATA, 'dominoes');
    const s = game.createInitialState(players(4), config(4)) as DominoState;
    const all = [...Object.values(s.hands).flat(), ...s.boneyard];
    expect(all).toHaveLength(28); expect(new Set(all.map(t => t.id)).size).toBe(28);
    expect(Object.values(s.hands).every(h => h.length === 5)).toBe(true);
    const publicState = game.getPublicState(s, 'p0', { now: () => 0 } as never) as any;
    expect(publicState.hands.p1.every((t: any) => t.hidden)).toBe(true);
  });
});
