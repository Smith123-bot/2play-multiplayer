import type { GameMetadata } from '@2play/shared';
import type { ClientGameModule } from './types';
import { reactionRaceClient } from '../reaction-race';
import { memoryMatchClient } from '../memory-match';
import { wordRaceClient } from '../word-race';
import { dotsAndBoxesClient } from '../dots-and-boxes';
import { mathRushClient } from '../math-rush';
import { battle2048Client } from '../2048-battle';
import { mazeRaceClient } from '../maze-race-2d';
import { wordScrambleClient } from '../word-scramble-battle';
import { shapeMatchClient } from '../shape-match-battle';
import { snakeBattleClient } from '../snake-battle';
import { targetRushClient } from '../target-rush';
import { paddleDuelClient } from '../paddle-duel';
import { brickBreakerClient } from '../brick-breaker-battle';
import { patternMemoryClient } from '../pattern-memory-battle';
import { drawGuessClient } from '../draw-guess-battle';
import { secretRoleClient } from '../secret-role';
import { colorClashClient } from '../color-clash';
import { territoryRushClient } from '../territory-rush';
import { coinHuntersClient } from '../coin-hunters-arena';
import { shopRushClient } from '../shop-rush-battle';
import { fakeDoorClient } from '../fake-door-battle';
import { magnetThiefClient } from '../magnet-thief';
import { chainReactionClient } from '../chain-reaction-battle';
import { oneButtonClient } from '../one-button-battle';
import { splitWorldClient } from '../split-world';
import { connectFourClient } from '../connect-four';
import { hangmanClient } from '../hangman';
import { sosGameClient } from '../sos-game';
import { chessClient } from '../chess';
import { unoClient } from '../uno';
import { simClient } from '../sim';
import { mirrorGridClient } from '../mirror-grid';
import { fuseClient } from '../fuse';
import { dominoMindClient } from '../domino-mind';
import { coupleSyncClient } from '../couple-sync';
import { coupleMemoryClient } from '../couple-memory';
import { ludoClient } from '../ludo';
import { arrowPuzzleClient } from '../arrow-puzzle';
import { blackBlastClient } from '../black-blast';

/**
 * Client game registry.
 *
 * Adding a game = add `client/src/games/<id>/index.tsx` exporting a
 * `ClientGameModule` and register it here (see docs/adding-a-game.md).
 */
const modules: ClientGameModule[] = [
  reactionRaceClient,
  memoryMatchClient,
  wordRaceClient,
  dotsAndBoxesClient,
  mathRushClient,
  battle2048Client,
  mazeRaceClient,
  wordScrambleClient,
  shapeMatchClient,
  snakeBattleClient,
  targetRushClient,
  paddleDuelClient,
  brickBreakerClient,
  patternMemoryClient,
  drawGuessClient,
  secretRoleClient,
  colorClashClient,
  territoryRushClient,
  coinHuntersClient,
  shopRushClient,
  fakeDoorClient,
  magnetThiefClient,
  chainReactionClient,
  oneButtonClient,
  splitWorldClient,
  ludoClient,
  arrowPuzzleClient,
  blackBlastClient,
  coupleSyncClient,
  coupleMemoryClient,
  connectFourClient,
  hangmanClient,
  sosGameClient,
  chessClient,
  unoClient,
  simClient,
  mirrorGridClient,
  fuseClient,
  dominoMindClient,
];

const registry = new Map<string, ClientGameModule>(modules.map((module) => [module.metadata.id, module]));

export function getGameComponent(gameId: string): ClientGameModule | undefined {
  return registry.get(gameId);
}

export function listClientGames(): GameMetadata[] {
  return modules.map((module) => module.metadata);
}

export function hasClientGame(gameId: string): boolean {
  return registry.has(gameId);
}

export type { ClientGameModule, GameComponentProps } from './types';
