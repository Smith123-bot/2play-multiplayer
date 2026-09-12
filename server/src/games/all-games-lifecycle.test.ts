import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALL_GAME_METADATA, type GameMetadata } from '@2play/shared';
import { createPlayer, createTestPlatform, waitFor, type TestPlatform } from '../test/harness';
import type { Platform } from '../core/Platform';
import type { Room } from '../rooms/Room';

/**
 * Catalogue-wide lifecycle contract.
 *
 * Every shipped game must survive the finish line the same way: a real result
 * with one ranking per seat, a declared winner or an explicit draw, a room that
 * stays open in the rematch stage, and a rematch that produces match #2 in the
 * SAME room with the SAME seats.
 *
 * Each case is driven with one connected human plus AI seats, which is the
 * Quick Play shape and by far the most common room on the platform. Matches are
 * finished directly rather than played out so all 39 games run in a few seconds;
 * natural end-of-match behaviour is covered by the per-game module tests and by
 * tests/integration/all-games.test.ts.
 */
describe('every shipped game honours the result and rematch contract', () => {
  let harness: TestPlatform;
  let platform: Platform;
  let counter = 0;

  beforeEach(() => {
    harness = createTestPlatform({ rematchTimeoutMs: 5_000 });
    platform = harness.platform;
    counter = 0;
  });

  afterEach(() => harness.destroy());

  /** One connected human + enough AI seats to satisfy the game minimum. */
  async function soloWithAi(game: GameMetadata): Promise<{ room: Room; humanId: string }> {
    counter += 1;
    const seats = Math.max(2, game.minPlayers);
    const host = await createPlayer(
      platform,
      `LC${counter}${game.id.replace(/-/g, '').slice(0, 6)}`,
    );
    const room = platform.roomManager.createRoom({
      gameId: game.id,
      maxPlayers: seats,
      isPrivate: true,
      isQuickPlay: true,
      host,
    });
    for (let seat = room.players.size; seat < seats; seat += 1) {
      platform.roomManager.addAI(room, host.playerId, 'hard');
    }
    for (const player of room.players.values()) player.isReady = true;

    room.status = 'PLAYING';
    room.gameStartedAt = Date.now();
    platform.gameManager.createState(room);
    platform.gameManager.start(room);
    return { room, humanId: host.playerId };
  }

  it('the registry ships the whole shared catalogue', () => {
    expect(ALL_GAME_METADATA).toHaveLength(39);
    for (const game of ALL_GAME_METADATA) {
      expect(platform.registry.has(game.id), `${game.id} is missing from the registry`).toBe(true);
    }
    expect(platform.registry.size).toBe(ALL_GAME_METADATA.length);
  });

  for (const game of ALL_GAME_METADATA) {
    it(`${game.id}: finishes into REMATCH_WAITING with a complete result and a working rematch`, async () => {
      const { room, humanId } = await soloWithAi(game);
      const seats = room.players.size;
      expect(seats).toBe(Math.max(2, game.minPlayers));

      platform.lifecycleManager.finishMatch(room, 'completed');

      /* ---- the room must NOT be dumped back to the lobby ---- */
      // Regression: the rematch gate compared the *human voter* count against
      // the game's minPlayers (which counts AI seats), so every human-vs-AI
      // match was returned to the lobby and its result wiped at the finish line.
      expect(room.status).toBe('REMATCH_WAITING');
      expect(platform.rematchManager.canRematch(room)).toBe(true);

      const result = room.gameResult;
      expect(result, `${game.id} produced no gameResult`).not.toBeNull();
      expect(result!.gameId).toBe(game.id);
      expect(result!.roomId).toBe(room.id);
      expect(result!.matchNumber).toBe(1);

      /* ---- scoring: one ranking per seat, valid ranks ---- */
      expect(result!.rankings).toHaveLength(seats);
      const rankedIds = result!.rankings.map((entry) => entry.playerId);
      expect(new Set(rankedIds).size).toBe(seats);
      for (const entry of result!.rankings) {
        expect(entry.rank, `${game.id} rank out of range`).toBeGreaterThanOrEqual(1);
        expect(entry.rank).toBeLessThanOrEqual(seats);
        expect(Number.isFinite(entry.score), `${game.id} score must be finite`).toBe(true);
        expect(entry.score, `${game.id} score must not be negative`).toBeGreaterThanOrEqual(0);
        expect(entry.nickname.length, `${game.id} ranking needs a nickname`).toBeGreaterThan(0);
      }

      /* ---- winner / draw must be unambiguous ---- */
      if (result!.isDraw) {
        // A draw may list the tied seats as winners, but every entry agrees.
        expect(result!.rankings.every((entry) => entry.isDraw)).toBe(true);
      } else {
        expect(
          result!.winners.length,
          `${game.id} declared neither a winner nor a draw`,
        ).toBeGreaterThan(0);
        for (const winner of result!.winners) expect(rankedIds).toContain(winner);
        // A competitive game must not crown the whole table.
        if (game.category !== 'coop') expect(result!.winners.length).toBeLessThan(seats);
      }

      /* ---- rematch: same room, same seats, match #2 ---- */
      platform.rematchManager.vote(room, humanId, true);
      await waitFor(() => room.matchNumber === 2, { timeoutMs: 5_000 });

      expect(room.id).toBe(result!.roomId);
      expect(room.matchNumber).toBe(2);
      expect(room.players.size).toBe(seats);
      expect(room.humanPlayers).toHaveLength(1);
      expect(room.aiPlayers).toHaveLength(seats - 1);
      expect(room.gameResult).toBeNull();
      expect(['NEW_MATCH', 'COUNTDOWN', 'PLAYING']).toContain(room.status);
      expect(room.gameState, `${game.id} reset produced no state`).not.toBeNull();
    }, 30_000);
  }
});
