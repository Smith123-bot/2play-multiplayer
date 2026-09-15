import { describe, expect, it } from 'vitest';
import { ALL_GAME_METADATA } from '@2play/shared';
import { hasClientGame, listClientGameIds, loadGameModule } from './index';

/**
 * The registry is lazily loaded, so a typo in a loader key or export name is no
 * longer caught at module-evaluation time — it would only surface as a blank
 * "Game not available" panel once a player actually entered that room. These
 * tests resolve every chunk so a broken registration fails the build.
 */
describe('lazy client game registry', () => {
  it('registers exactly the 38 catalogue games, once each', () => {
    const ids = listClientGameIds();
    expect(ids).toHaveLength(38);
    expect(new Set(ids).size, 'duplicate loader key').toBe(ids.length);
    expect([...ids].sort()).toEqual(ALL_GAME_METADATA.map((game) => game.id).sort());
  });

  it('knows every catalogue id and nothing else', () => {
    for (const game of ALL_GAME_METADATA) {
      expect(hasClientGame(game.id), `${game.id} has no loader`).toBe(true);
    }
    expect(hasClientGame('not-a-real-game')).toBe(false);
    // Must consult own keys only, not the prototype chain.
    expect(hasClientGame('constructor')).toBe(false);
    expect(hasClientGame('toString')).toBe(false);
  });

  it('resolves every game to a module whose metadata.id matches its key', async () => {
    for (const id of listClientGameIds()) {
      const module = await loadGameModule(id);
      expect(module, `${id} did not resolve`).toBeDefined();
      // A key that disagrees with the module it loads would render the wrong
      // game's board for a room.
      expect(module!.metadata.id, `${id} loads the wrong module`).toBe(id);
      expect(typeof module!.Component, `${id} has no Component`).toBe('function');
    }
  });

  it('caches a resolved module so re-entering a room does not refetch it', async () => {
    const first = await loadGameModule('chess');
    const second = await loadGameModule('chess');
    expect(second).toBe(first);
  });

  it('returns undefined for an unknown game instead of throwing', async () => {
    await expect(loadGameModule('does-not-exist')).resolves.toBeUndefined();
  });
});
