import type { GameMetadata } from '@2play/shared';
import type { ClientGameModule } from './types';
import { reactionRaceClient } from '../reaction-race';
import { memoryMatchClient } from '../memory-match';
import { wordRaceClient } from '../word-race';
import { dotsAndBoxesClient } from '../dots-and-boxes';
import { mathRushClient } from '../math-rush';

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
