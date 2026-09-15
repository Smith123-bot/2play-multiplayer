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
  it('ships the full 35 game catalogue with unique kebab-case ids', () => {
    expect(ALL_GAME_METADATA).toHaveLength(35);
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

/**
 * How To Play content contract (Phase 2 rules audit).
 *
 * The shared popup used to fall back to `About N min per match.` derived from
 * `estimatedDuration`, which is a marketing guess rather than the clock the
 * server actually runs. Every game now overrides the timer, turn system,
 * special rules and win/draw outcome with values read from its own server
 * module, so these assertions fail if a future game ships generic copy.
 */
describe('How To Play content matches real game mechanics', () => {
  /**
   * Games whose server can never produce a draw:
   *  - ludo hardcodes `isDraw: false` in getResult (first to home wins, and a
   *    cut-short match is ranked by tokens home rather than tied).
   *  - sim's `concludeDraw` is unreachable for K6 by Ramsey's theorem R(3,3)=6;
   *    it exists only as a defensive branch.
   */
  const GAMES_WITHOUT_A_DRAW = new Set(['ludo', 'sim']);

  it('replaces the derived estimate with the real clock for every game', () => {
    for (const game of ALL_GAME_METADATA) {
      const timeLimit = game.howToPlay?.timeLimit;
      expect(timeLimit, `${game.id} has no timeLimit`).toBeTruthy();
      // The generic fallback HowToPlayModal would otherwise derive.
      expect(
        timeLimit,
        `${game.id} still uses the generic estimated-duration fallback`,
      ).not.toMatch(/^About \d+ min per match\.$/);
      expect(timeLimit!.trim().length, game.id).toBeGreaterThan(12);
    }
  });

  it('documents the turn system for every game', () => {
    for (const game of ALL_GAME_METADATA) {
      const turnSystem = game.howToPlay?.turnSystem;
      expect(turnSystem, `${game.id} has no turnSystem`).toBeTruthy();
      expect(turnSystem!.trim().length, game.id).toBeGreaterThan(20);
      // Must say whether play is simultaneous or turn-taking — the two shapes
      // a player needs to understand before the match starts.
      expect(
        /simultaneous|strict turns|turn|co-op/i.test(turnSystem!),
        `${game.id} turnSystem does not describe how play alternates`,
      ).toBe(true);
    }
  });

  it('gives every game its own special rules instead of copied text', () => {
    const seen = new Map<string, string>();
    for (const game of ALL_GAME_METADATA) {
      const rules = game.howToPlay?.specialRules ?? [];
      expect(rules.length, `${game.id} has no specialRules`).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(rule.trim().length, game.id).toBeGreaterThan(12);
      }
      // Two games sharing an identical rule set means the text was copy-pasted
      // rather than written from the implementation.
      const signature = rules.join('|');
      expect(
        seen.has(signature),
        `${game.id} duplicates ${seen.get(signature)}'s specialRules`,
      ).toBe(false);
      seen.set(signature, game.id);
    }
  });

  it('gives every game a distinct, substantive win condition', () => {
    const seen = new Map<string, string>();
    for (const game of ALL_GAME_METADATA) {
      const win = game.howToPlay?.winCondition;
      expect(win, `${game.id} has no winCondition`).toBeTruthy();
      expect(win!.trim().length, game.id).toBeGreaterThan(20);
      expect(seen.has(win!), `${game.id} duplicates ${seen.get(win)}'s winCondition`).toBe(false);
      seen.set(win!, game.id);
    }
  });

  it('documents the draw outcome for every game that can actually draw', () => {
    for (const game of ALL_GAME_METADATA) {
      const win = game.howToPlay!.winCondition!;
      const documentsDraw = /draw|tie|tied|level|equal|shared/i.test(win);
      if (GAMES_WITHOUT_A_DRAW.has(game.id)) {
        expect(documentsDraw, `${game.id} cannot draw but claims to`).toBe(false);
      } else {
        expect(documentsDraw, `${game.id} can draw but never says so`).toBe(true);
      }
    }
  });

  it('describes touch input for mobile and pointer/keyboard input for desktop', () => {
    for (const game of ALL_GAME_METADATA) {
      const controls = game.howToPlay!.controls!;
      expect(
        /tap|swipe|drag|touch|long-press|hold|pinch|d-pad/i.test(controls.mobile),
        `${game.id} mobile controls do not describe a touch gesture`,
      ).toBe(true);
      expect(
        /click|key|press|mouse|arrow|space|enter|drag|hover|type|1-|1–|wasd/i.test(controls.desktop),
        `${game.id} desktop controls do not describe a pointer or keyboard action`,
      ).toBe(true);
    }
  });
});
