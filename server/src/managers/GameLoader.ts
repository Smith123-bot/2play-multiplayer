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
import { territoryRushGame } from '../games/territory-rush';
import { hexaConquestGame } from '../games/hexa-conquest';
import { colorTrailsGame } from '../games/color-trails';
import { coinHuntersGame } from '../games/coin-hunters-arena';
import { castleSiegeGame } from '../games/castle-siege-2d';
import { trafficControlGame } from '../games/traffic-control-battle';
import { magnetMazeGame } from '../games/magnet-maze';
import { shopRushGame } from '../games/shop-rush-battle';
import { shadowCopyGame } from '../games/shadow-copy-battle';
import { echoMazeGame } from '../games/echo-maze';
import { fakeDoorGame } from '../games/fake-door-battle';
import { movingIslandGame } from '../games/moving-island';
import { magnetThiefGame } from '../games/magnet-thief';
import { invisiblePathGame } from '../games/invisible-path';
import { reverseRaceGame } from '../games/reverse-race';
import { mirrorArenaGame } from '../games/mirror-arena';
import { chainReactionGame } from '../games/chain-reaction-battle';
import { oneButtonGame } from '../games/one-button-battle';
import { splitWorldGame } from '../games/split-world';
import { connectFourGame } from '../games/connect-four';
import { hangmanGame } from '../games/hangman';
import { sosGame } from '../games/sos-game';
import { chessGame } from '../games/chess';
import { unoGame } from '../games/uno';
import { simGame } from '../games/sim';
import { dominoesGame } from '../games/dominoes';
import { mirrorGridGame } from '../games/mirror-grid';
import { fuseGame } from '../games/fuse';
import { dominoMindGame } from '../games/domino-mind';
import { loveMazeGame } from '../games/love-maze';
import { syncJumpGame } from '../games/sync-jump';
import { coupleSyncGame } from '../games/couple-sync';
import { coupleMemoryGame } from '../games/couple-memory';
import { buildTogetherGame } from '../games/build-together';
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
      territoryRushGame,
      hexaConquestGame,
      colorTrailsGame,
      coinHuntersGame,
      castleSiegeGame,
      trafficControlGame,
      magnetMazeGame,
      shopRushGame,
      shadowCopyGame,
      echoMazeGame,
      fakeDoorGame,
      movingIslandGame,
      magnetThiefGame,
      invisiblePathGame,
      reverseRaceGame,
      mirrorArenaGame,
      chainReactionGame,
      oneButtonGame,
      splitWorldGame,
      ludoGame,
      arrowPuzzleGame,
      blackBlastGame,
      loveMazeGame,
      syncJumpGame,
      coupleSyncGame,
      coupleMemoryGame,
      buildTogetherGame,
      connectFourGame,
      hangmanGame,
      sosGame,
      chessGame,
      unoGame,
      simGame,
      dominoesGame,
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
