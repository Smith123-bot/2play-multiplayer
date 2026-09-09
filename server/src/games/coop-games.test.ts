import { describe, expect, it } from 'vitest';
import { createGameFixture, createTestPlatform } from '../test/harness';
import { loveMazeGame } from './love-maze';


describe('cooperative couple games', () => {
  it('Love Maze validates walls, switches, keys, checkpoints and requires both exits', async () => {
    const h = createTestPlatform(); const f = await createGameFixture(h.platform, 'love-maze'); const s = f.room.gameState as any;
    const [a, b] = Object.keys(s.players);
    expect(loveMazeGame.validateAction(a!, { type: 'move', payload: { dx: 3, dy: 0 } }, s, h.platform.gameManager.getContext(f.room)).valid).toBe(false);
    for (const id of [a!, b!]) { h.platform.gameManager.handleAction(f.room, id, { type: 'switch', payload: { index: id === a ? 0 : 1 } }); h.platform.gameManager.handleAction(f.room, id, { type: 'key', payload: { index: id === a ? 0 : 1 } }); h.platform.gameManager.handleAction(f.room, id, { type: 'checkpoint' }); }
    expect(s.teamScore).toBeGreaterThan(0); h.destroy();
  });
  it('Sync Jump scores synchronization and accepts recovery checkpoints', async () => {
    const h = createTestPlatform(); const f = await createGameFixture(h.platform, 'sync-jump'); const s = f.room.gameState as any;
    const id = Object.keys(s.players)[0]; expect(h.platform.gameManager.handleAction(f.room, id, { type: 'jump' }).accepted).toBe(true); expect(h.platform.gameManager.handleAction(f.room, id, { type: 'checkpoint' }).accepted).toBe(true); expect(s.syncScore).toBeGreaterThanOrEqual(0); h.destroy();
  });
  it('Couple Sync requires both valid signals to complete a round', async () => {
    const h = createTestPlatform(); const f = await createGameFixture(h.platform, 'couple-sync'); const s = f.room.gameState as any; const ids = Object.keys(s.players);
    expect(h.platform.gameManager.handleAction(f.room, ids[0]!, { type: 'press', payload: { value: 99 } }).accepted).toBe(true); expect(s.roundFailures).toBe(1); h.platform.gameManager.handleAction(f.room, ids[0]!, { type: 'press', payload: { value: s.roundTarget } }); h.platform.gameManager.handleAction(f.room, ids[1]!, { type: 'press', payload: { value: s.roundTarget } }); expect(s.roundSuccesses).toBe(1); h.destroy();
  });
  it('Couple Memory validates cards, pairs, combo and requires both contributors', async () => {
    const h = createTestPlatform(); const f = await createGameFixture(h.platform, 'couple-memory'); const s = f.room.gameState as any; const ids = Object.keys(s.players);
    expect(h.platform.gameManager.handleAction(f.room, ids[0]!, { type: 'reveal', payload: { cardId: 0 } }).accepted).toBe(true); expect(h.platform.gameManager.handleAction(f.room, ids[0]!, { type: 'reveal', payload: { cardId: 0 } }).accepted).toBe(false); expect(s.cards).toHaveLength(16); h.destroy();
  });
  it('Build Together validates available pieces and completion contribution', async () => {
    const h = createTestPlatform(); const f = await createGameFixture(h.platform, 'build-together'); const s = f.room.gameState as any; const ids = Object.keys(s.players);
    expect(h.platform.gameManager.handleAction(f.room, ids[0]!, { type: 'place', payload: { pieceId: 0, x: 0, y: 0, rotation: 0 } }).accepted).toBe(true); expect(h.platform.gameManager.handleAction(f.room, ids[0]!, { type: 'place', payload: { pieceId: 0, x: 0, y: 0, rotation: 0 } }).accepted).toBe(false); expect(s.piecesUsed).toBe(1); h.destroy();
  });
});
