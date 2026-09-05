import type { Platform } from '../core/Platform';
import { memoryMatchGame } from '../games/memory-match';
import { reactionRaceGame } from '../games/reaction-race';
import { wordRaceGame } from '../games/word-race';
import { dotsAndBoxesGame } from '../games/dots-and-boxes';
import { mathRushGame } from '../games/math-rush';
import { createLogger } from '../utils/logger';
import type { GameModule } from '../games/GameModule';

/**
 * Registers every shipped game with the registry.
 *
 * Adding a game = create `server/src/games/<id>` + `client/src/games/<id>` and
 * add one line here (see docs/adding-a-game.md).
 */
export class GameLoader {
  private readonly logger = createLogger('GameLoader');

  constructor(private readonly platform: Platform) {}

  load(): string[] {
    const games: GameModule[] = [
      reactionRaceGame,
      memoryMatchGame,
      wordRaceGame,
      dotsAndBoxesGame,
      mathRushGame,
    ];

    for (const game of games) {
      this.platform.registry.register(game);
    }

    const ids = games.map((game) => game.metadata.id);
    this.logger.info('games loaded', { count: ids.length, ids });
    return ids;
  }
}
