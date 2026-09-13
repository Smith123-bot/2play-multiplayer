import type { ClientGameModule } from './types';

/**
 * Client game registry — lazily loaded, one Vite chunk per game.
 *
 * All 40 games used to be imported eagerly, which put every game's renderer
 * (including the chess engine, ludo board and canvas games) into the initial
 * bundle and made the Home page download ~850 KB of JavaScript before showing a
 * single card. Each game is now a dynamic import, so its chunk is fetched only
 * when a room actually renders it, and the discovery screens ship without any
 * game code at all.
 *
 * Adding a game = add `client/src/games/<id>/index.tsx` exporting a
 * `ClientGameModule` and register one loader line below (see
 * docs/adding-a-game.md). The key MUST equal `metadata.id`; the registry test
 * asserts this for every entry.
 */
type GameLoader = () => Promise<ClientGameModule>;

const loaders: Record<string, GameLoader> = {
  '2048-battle': () => import('../2048-battle').then((m) => m.battle2048Client),
  'arrow-puzzle': () => import('../arrow-puzzle').then((m) => m.arrowPuzzleClient),
  'black-blast': () => import('../black-blast').then((m) => m.blackBlastClient),
  'brick-breaker-battle': () => import('../brick-breaker-battle').then((m) => m.brickBreakerClient),
  'chain-reaction-battle': () => import('../chain-reaction-battle').then((m) => m.chainReactionClient),
  'chess': () => import('../chess').then((m) => m.chessClient),
  'coin-hunters-arena': () => import('../coin-hunters-arena').then((m) => m.coinHuntersClient),
  'color-clash': () => import('../color-clash').then((m) => m.colorClashClient),
  'connect-four': () => import('../connect-four').then((m) => m.connectFourClient),
  'couple-memory': () => import('../couple-memory').then((m) => m.coupleMemoryClient),
  'couple-sync': () => import('../couple-sync').then((m) => m.coupleSyncClient),
  'domino-mind': () => import('../domino-mind').then((m) => m.dominoMindClient),
  'dots-and-boxes': () => import('../dots-and-boxes').then((m) => m.dotsAndBoxesClient),
  'draw-guess-battle': () => import('../draw-guess-battle').then((m) => m.drawGuessClient),
  'fake-door-battle': () => import('../fake-door-battle').then((m) => m.fakeDoorClient),
  'fuse': () => import('../fuse').then((m) => m.fuseClient),
  'hangman': () => import('../hangman').then((m) => m.hangmanClient),
  'ludo': () => import('../ludo').then((m) => m.ludoClient),
  'magnet-thief': () => import('../magnet-thief').then((m) => m.magnetThiefClient),
  'math-rush': () => import('../math-rush').then((m) => m.mathRushClient),
  'maze-race-2d': () => import('../maze-race-2d').then((m) => m.mazeRaceClient),
  'memory-match': () => import('../memory-match').then((m) => m.memoryMatchClient),
  'mirror-grid': () => import('../mirror-grid').then((m) => m.mirrorGridClient),
  'one-button-battle': () => import('../one-button-battle').then((m) => m.oneButtonClient),
  'paddle-duel': () => import('../paddle-duel').then((m) => m.paddleDuelClient),
  'pattern-memory-battle': () => import('../pattern-memory-battle').then((m) => m.patternMemoryClient),
  'reaction-race': () => import('../reaction-race').then((m) => m.reactionRaceClient),
  'rock-paper-scissors': () => import('../rock-paper-scissors').then((m) => m.rockPaperScissorsClient),
  'secret-role': () => import('../secret-role').then((m) => m.secretRoleClient),
  'shape-match-battle': () => import('../shape-match-battle').then((m) => m.shapeMatchClient),
  'shop-rush-battle': () => import('../shop-rush-battle').then((m) => m.shopRushClient),
  'sim': () => import('../sim').then((m) => m.simClient),
  'snake-battle': () => import('../snake-battle').then((m) => m.snakeBattleClient),
  'sos-game': () => import('../sos-game').then((m) => m.sosGameClient),
  'split-world': () => import('../split-world').then((m) => m.splitWorldClient),
  'target-rush': () => import('../target-rush').then((m) => m.targetRushClient),
  'territory-rush': () => import('../territory-rush').then((m) => m.territoryRushClient),
  'uno': () => import('../uno').then((m) => m.unoClient),
  'word-race': () => import('../word-race').then((m) => m.wordRaceClient),
  'word-scramble-battle': () => import('../word-scramble-battle').then((m) => m.wordScrambleClient),
};

/** Resolved modules, so re-entering a room never re-fetches the chunk. */
const resolved = new Map<string, ClientGameModule>();

/** True when this client knows how to render `gameId`. Needs no network. */
export function hasClientGame(gameId: string): boolean {
  return Object.prototype.hasOwnProperty.call(loaders, gameId);
}

/** Every game id this client can render, in registration order. */
export function listClientGameIds(): string[] {
  return Object.keys(loaders);
}

/**
 * Resolves a game's client module, fetching its chunk on first use.
 * Returns `undefined` for an unknown id so the caller can show its
 * "game not available" state instead of throwing.
 */
export async function loadGameModule(gameId: string): Promise<ClientGameModule | undefined> {
  const cached = resolved.get(gameId);
  if (cached) return cached;
  const load = loaders[gameId];
  if (!load) return undefined;
  const gameModule = await load();
  resolved.set(gameId, gameModule);
  return gameModule;
}

export type { ClientGameModule, GameComponentProps } from './types';
