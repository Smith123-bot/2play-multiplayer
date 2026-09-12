import { describe, expect, it } from 'vitest';
import { ALL_GAME_METADATA } from './metadata';
import { GAME_CATEGORIES } from '../constants';

/**
 * Catalogue contract — every shipped game must be fully documented.
 *
 * The server registry re-validates most of this at registration time, but these
 * assertions run without booting a server and cover the player-facing
 * documentation (rules + How To Play) that a launch depends on.
 */
describe('game catalogue metadata', () => {
  it('ships the full 39 game catalogue with unique kebab-case ids', () => {
    expect(ALL_GAME_METADATA).toHaveLength(39);
    const ids = ALL_GAME_METADATA.map((game) => game.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('gives every game a name, description, icon and thumbnail', () => {
    for (const game of ALL_GAME_METADATA) {
      expect(game.name.trim().length, game.id).toBeGreaterThan(0);
      expect(game.description.trim().length, game.id).toBeGreaterThan(0);
      expect(game.icon.trim().length, game.id).toBeGreaterThan(0);
      expect(game.thumbnail.trim().length, game.id).toBeGreaterThan(0);
      expect(GAME_CATEGORIES, game.id).toContain(game.category);
      expect(game.version.trim().length, game.id).toBeGreaterThan(0);
    }
  });

  it('keeps supportedPlayerCounts consistent with min/max and inside 2-4', () => {
    for (const game of ALL_GAME_METADATA) {
      expect(game.supportedPlayerCounts.length, game.id).toBeGreaterThan(0);
      expect(game.minPlayers, game.id).toBe(game.supportedPlayerCounts[0]);
      expect(game.maxPlayers, game.id).toBe(
        game.supportedPlayerCounts[game.supportedPlayerCounts.length - 1],
      );
      for (const count of game.supportedPlayerCounts) {
        expect(count, game.id).toBeGreaterThanOrEqual(2);
        expect(count, game.id).toBeLessThanOrEqual(4);
      }
      expect(game.estimatedDuration, game.id).toBeGreaterThan(0);
    }
  });

  it('never advertises AI without real difficulty levels', () => {
    for (const game of ALL_GAME_METADATA) {
      if (game.hasAI) {
        expect(game.aiDifficulties.length, game.id).toBeGreaterThan(0);
      } else {
        expect(game.aiDifficulties, game.id).toHaveLength(0);
      }
    }
  });

  it('documents rules, controls, scoring and win condition for every game', () => {
    for (const game of ALL_GAME_METADATA) {
      expect(game.rules.length, game.id).toBeGreaterThan(0);
      expect(game.controls.trim().length, game.id).toBeGreaterThan(0);
      expect(game.scoring.trim().length, game.id).toBeGreaterThan(0);
      expect(game.winCondition.trim().length, game.id).toBeGreaterThan(0);
      expect(Array.isArray(game.tags), game.id).toBe(true);
    }
  });

  /**
   * How To Play must describe mobile and desktop separately.
   *
   * 28 games used to fall back to a single `controls` string for both, so the
   * shared rules popup told touch players to "press Space". Every game now
   * supplies a real pair.
   */
  it('gives every game distinct mobile and desktop controls in How To Play', () => {
    for (const game of ALL_GAME_METADATA) {
      const controls = game.howToPlay?.controls;
      expect(controls, `${game.id} has no howToPlay.controls`).toBeDefined();
      expect(controls!.mobile.trim().length, game.id).toBeGreaterThan(0);
      expect(controls!.desktop.trim().length, game.id).toBeGreaterThan(0);
      expect(controls!.mobile, `${game.id} repeats one string for both`).not.toBe(
        controls!.desktop,
      );
    }
  });

  it('fills every How To Play section, deriving nothing important', () => {
    for (const game of ALL_GAME_METADATA) {
      const howToPlay = game.howToPlay ?? {};
      const objective = howToPlay.objective ?? game.description;
      const steps = howToPlay.steps ?? game.rules;
      const scoring = howToPlay.scoring ?? game.scoring;
      const winCondition = howToPlay.winCondition ?? game.winCondition;

      expect(objective.trim().length, game.id).toBeGreaterThan(0);
      expect(steps.length, game.id).toBeGreaterThan(0);
      expect(scoring.trim().length, game.id).toBeGreaterThan(0);
      expect(winCondition.trim().length, game.id).toBeGreaterThan(0);
    }
  });
});
