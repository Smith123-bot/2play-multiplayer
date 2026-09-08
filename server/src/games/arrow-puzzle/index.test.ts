import { describe, expect, it } from 'vitest';
import { createArrowPuzzle, playerUnlocked } from './index';
import { createGameFixture, createTestPlatform } from '../../test/harness';

describe('Arrow Puzzle', () => {
  it('generates deterministic, acyclic solvable boards', () => {
    const a = createArrowPuzzle(42, 'hard'); const b = createArrowPuzzle(42, 'hard');
    expect(a).toEqual(b); const cleared = a.map(() => false); let count = 0;
    while (count < a.length) { const index = a.findIndex((tile, i) => !cleared[i] && (targetOutside(i, tile.direction) || (targetIndex(i, tile.direction) !== null && cleared[targetIndex(i, tile.direction)!]))); expect(index).toBeGreaterThanOrEqual(0); cleared[index] = true; count += 1; }
  });
  it('validates actions and determines completion on the server', async () => {
    const h = createTestPlatform(); const f = await createGameFixture(h.platform, 'arrow-puzzle'); const state = f.room.gameState as any; const id = Object.keys(state.players)[0]!;
    expect(state.phase).toBe('playing'); let guard = 0;
    while (state.phase === 'playing' && guard++ < 30) { const index = state.tiles.findIndex((_t: any, i: number) => !state.players[id].clearedTiles[i] && playerUnlocked(i, state, state.players[id])); expect(index).toBeGreaterThanOrEqual(0); h.platform.gameManager.handleAction(f.room, id, { type: 'activate-arrow', payload: { index } }); }
    expect(state.players[id].cleared).toBe(25); expect(state.winnerId).toBe(id); h.destroy();
  });
  it('rejects client-owned completion and invalid tiles', async () => { const h = createTestPlatform(); const f = await createGameFixture(h.platform, 'arrow-puzzle'); const id = Object.keys((f.room.gameState as any).players)[0]!; expect(h.platform.gameManager.handleAction(f.room, id, { type: 'puzzle-solved' }).accepted).toBe(false); expect(h.platform.gameManager.handleAction(f.room, id, { type: 'activate-arrow', payload: { index: 99 } }).accepted).toBe(false); h.destroy(); });
});
function targetIndex(index: number, direction: string): number | null { const x=index%5,y=Math.floor(index/5); const d: Record<string,[number,number]>={up:[0,-1],left:[-1,0],right:[1,0],down:[0,1]}; const [dx,dy]=d[direction]!; const nx=x+dx,ny=y+dy; return nx<0||ny<0||nx>=5||ny>=5?null:ny*5+nx; }
function targetOutside(index: number, direction: string) { return targetIndex(index,direction) === null; }
