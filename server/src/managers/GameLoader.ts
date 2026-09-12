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
import { targetRushGame } from '../games/target-rush';
import { paddleDuelGame } from '../games/paddle-duel';
import { brickBreakerGame } from '../games/brick-breaker-battle';
import { patternMemoryGame } from '../games/pattern-memory-battle';
import { drawGuessGame } from '../games/draw-guess-battle';
import { secretRoleGame } from '../games/secret-role';
import { colorClashGame } from '../games/color-clash';
import { territoryRushGame } from '../games/territory-rush';
import { coinHuntersGame } from '../games/coin-hunters-arena';
import { shopRushGame } from '../games/shop-rush-battle';
import { fakeDoorGame } from '../games/fake-door-battle';
import { magnetThiefGame } from '../games/magnet-thief';
import { chainReactionGame } from '../games/chain-reaction-battle';
import { oneButtonGame } from '../games/one-button-battle';
import { splitWorldGame } from '../games/split-world';
import { connectFourGame } from '../games/connect-four';
import { hangmanGame } from '../games/hangman';
import { sosGame } from '../games/sos-game';
import { chessGame } from '../games/chess';
import { unoGame } from '../games/uno';
import { simGame } from '../games/sim';
import { mirrorGridGame } from '../games/mirror-grid';
import { fuseGame } from '../games/fuse';
import { dominoMindGame } from '../games/domino-mind';
import { coupleSyncGame } from '../games/couple-sync';
import { coupleMemoryGame } from '../games/couple-memory';
import { ludoGame } from '../games/ludo';
import { arrowPuzzleGame } from '../games/arrow-puzzle';
import { blackBlastGame } from '../games/black-blast';
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
      targetRushGame,
      paddleDuelGame,
      brickBreakerGame,
      patternMemoryGame,
      drawGuessGame,
      secretRoleGame,
      colorClashGame,
      territoryRushGame,
      coinHuntersGame,
      shopRushGame,
      fakeDoorGame,
      magnetThiefGame,
      chainReactionGame,
      oneButtonGame,
      splitWorldGame,
      ludoGame,
      arrowPuzzleGame,
      blackBlastGame,
      coupleSyncGame,
      coupleMemoryGame,
      connectFourGame,
      hangmanGame,
      sosGame,
      chessGame,
      unoGame,
      simGame,
      mirrorGridGame,
      fuseGame,
      dominoMindGame,
    ];

    for (const game of games) {
      this.platform.registry.register(game);
    }

    const ids = games.map((game) => game.metadata.id);
    this.logger.info('games loaded', { count: ids.length, ids });
    return ids;
  }
}
