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
import { trafficDodgeClient } from '../traffic-dodge-race';
import { targetRushClient } from '../target-rush';
import { captureTheFlagClient } from '../capture-the-flag-2d';
import { paddleDuelClient } from '../paddle-duel';
import { brickBreakerClient } from '../brick-breaker-battle';
import { patternMemoryClient } from '../pattern-memory-battle';
import { bombPassClient } from '../bomb-pass-2d';
import { drawGuessClient } from '../draw-guess-battle';
import { secretRoleClient } from '../secret-role';
import { platformDashClient } from '../platform-dash-2d';
import { colorClashClient } from '../color-clash';
import { territoryRushClient } from '../territory-rush';
import { hexaConquestClient } from '../hexa-conquest';
import { colorTrailsClient } from '../color-trails';
import { coinHuntersClient } from '../coin-hunters-arena';
import { castleSiegeClient } from '../castle-siege-2d';
import { trafficControlClient } from '../traffic-control-battle';
import { magnetMazeClient } from '../magnet-maze';
import { shopRushClient } from '../shop-rush-battle';
import { shadowCopyClient } from '../shadow-copy-battle';
import { echoMazeClient } from '../echo-maze';
import { fakeDoorClient } from '../fake-door-battle';
import { movingIslandClient } from '../moving-island';
import { magnetThiefClient } from '../magnet-thief';
import { invisiblePathClient } from '../invisible-path';

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
  trafficDodgeClient,
  targetRushClient,
  captureTheFlagClient,
  paddleDuelClient,
  brickBreakerClient,
  patternMemoryClient,
  bombPassClient,
  drawGuessClient,
  secretRoleClient,
  platformDashClient,
  colorClashClient,
  territoryRushClient,
  hexaConquestClient,
  colorTrailsClient,
  coinHuntersClient,
  castleSiegeClient,
  trafficControlClient,
  magnetMazeClient,
  shopRushClient,
  shadowCopyClient,
  echoMazeClient,
  fakeDoorClient,
  movingIslandClient,
  magnetThiefClient,
  invisiblePathClient,
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
