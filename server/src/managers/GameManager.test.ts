import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGameFixture, createPlayer, createTestPlatform, type TestPlatform } from '../test/harness';
import type { Platform } from '../core/Platform';

/**
 * Content-variety guarantees that live in the platform rather than in a game.
 *
 * Every module that derives its opening layout from `config.seed` depends on the
 * manager handing it a seed that actually changes per match. When it did not,
 * `config.seed` was always undefined and those games silently fell back to their
 * own default — memory-match dealt a byte-identical deck in every game ever
 * played. These tests pin the plumbing so that cannot regress quietly.
 */
describe('GameManager content seeding', () => {
  let harness: TestPlatform;
  let platform: Platform;

  beforeEach(() => {
    harness = createTestPlatform();
    platform = harness.platform;
  });

  afterEach(() => harness.destroy());

  const deckOf = (room: { gameState: unknown }): string => {
    const state = room.gameState as { cards: Array<{ symbol: string }> };
    return state.cards.map((card) => card.symbol).join('');
  };

  async function memoryMatchRoom(label: string) {
    const host = await createPlayer(platform, `${label}-host`);
    const guest = await createPlayer(platform, `${label}-guest`);
    const room = platform.roomManager.createRoom({
      gameId: 'memory-match',
      maxPlayers: 2,
      isPrivate: false,
      host,
    });
    platform.roomManager.joinRoom({ roomId: room.id, player: guest });
    room.status = 'PLAYING';
    room.gameStartedAt = Date.now();
    platform.gameManager.createState(room);
    platform.gameManager.start(room);
    return room;
  }

  it('supplies a real per-match seed instead of leaving config.seed undefined', async () => {
    const { room } = await createGameFixture(platform, 'memory-match');
    const built = platform.gameManager.buildConfig(room);

    // This is the regression guard: config.seed used to be undefined, so any
    // module reading `config.seed ?? 1` was pinned to the same content forever.
    expect(built.seed).toBeDefined();
    expect(typeof built.seed).toBe('number');
    expect(Number.isFinite(built.seed)).toBe(true);
    expect(built.seed).toBeGreaterThan(0);
    expect(built.seed).not.toBe(1);

    // The context handed to modules carries the same seed.
    expect(platform.gameManager.getContext(room).config.seed).toBe(built.seed);
    expect(platform.gameManager.getContext(room).seed).toBe(built.seed);
  });

  it('gives different matches different seeds', async () => {
    const a = await memoryMatchRoom('a');
    const b = await memoryMatchRoom('b');
    const seedA = platform.gameManager.buildConfig(a).seed;
    const seedB = platform.gameManager.buildConfig(b).seed;
    expect(seedA).not.toBe(seedB);
  });

  it('deals a different layout in every fresh match', async () => {
    const decks = new Set<string>();
    for (let i = 0; i < 8; i += 1) {
      const room = await memoryMatchRoom(`fresh-${i}`);
      decks.add(deckOf(room));
      platform.roomManager.closeRoom(room, 'server');
    }
    // Before the seed was plumbed through this was 1 identical deck out of 8.
    expect(decks.size).toBe(8);
  });

  it('deals a different layout on rematch rather than replaying the last one', async () => {
    const { room } = await createGameFixture(platform, 'memory-match');
    const seen = [deckOf(room)];

    for (let i = 0; i < 5; i += 1) {
      platform.gameManager.resetState(room);
      platform.gameManager.start(room);
      seen.push(deckOf(room));
    }

    expect(new Set(seen).size).toBe(seen.length);
    // The ordering matters: resetState must reseed BEFORE building the next
    // state, otherwise a rematch inherits the previous match's seed.
    expect(seen[1]).not.toBe(seen[0]);
  });

  it('reseeds so a rematch is not a replay of the previous match stream', async () => {
    const { room } = await createGameFixture(platform, 'memory-match');
    const before = platform.gameManager.buildConfig(room).seed;
    platform.gameManager.reseed(room);
    const after = platform.gameManager.buildConfig(room).seed;
    expect(after).not.toBe(before);
  });

  it('keeps the same seed for every view of one live match', async () => {
    const { room } = await createGameFixture(platform, 'memory-match');
    const first = platform.gameManager.getContext(room).config.seed;
    const second = platform.gameManager.getContext(room).config.seed;
    // Refreshing mutable context fields must not silently re-roll the seed,
    // which would make a mid-match rebuild deal a different board.
    expect(first).toBe(second);
  });
});
