import type { Platform } from '../core/Platform';
import { memoryMatchGame } from '../games/memory-match';
import { reactionRaceGame } from '../games/reaction-race';
import { wordRaceGame } from '../games/word-race';
import { dotsAndBoxesGame } from '../games/dots-and-boxes';
import { mathRushGame } from '../games/math-rush';
import { battle2048Game } from '../games/2048-battle';
import { mazeRaceGame } from '../games/maze-race-2d';
import { wordScrambleGame } from '../games/word-scramble-battle';
import { shapeMatchGame } from '../games/shape-match-battle';
import { snakeBattleGame } from '../games/snake-battle';
import { trafficDodgeGame } from '../games/traffic-dodge-race';
import { targetRushGame } from '../games/target-rush';
import { captureTheFlagGame } from '../games/capture-the-flag-2d';
import { paddleDuelGame } from '../games/paddle-duel';
import { brickBreakerGame } from '../games/brick-breaker-battle';
import { patternMemoryGame } from '../games/pattern-memory-battle';
import { bombPassGame } from '../games/bomb-pass-2d';
import { drawGuessGame } from '../games/draw-guess-battle';
import { secretRoleGame } from '../games/secret-role';
import { platformDashGame } from '../games/platform-dash-2d';
import { colorClashGame } from '../games/color-clash';
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
      battle2048Game,
      mazeRaceGame,
      wordScrambleGame,
      shapeMatchGame,
      snakeBattleGame,
      trafficDodgeGame,
      targetRushGame,
      captureTheFlagGame,
      paddleDuelGame,
      brickBreakerGame,
      patternMemoryGame,
      bombPassGame,
      drawGuessGame,
      secretRoleGame,
      platformDashGame,
      colorClashGame,
    ];

    for (const game of games) {
      this.platform.registry.register(game);
    }

    const ids = games.map((game) => game.metadata.id);
    this.logger.info('games loaded', { count: ids.length, ids });
    return ids;
  }
}
