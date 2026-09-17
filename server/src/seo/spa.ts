import type { Request, Response } from 'express';
import {
  buildGameSeo,
  buildGamesCatalogSeo,
  buildHomeSeo,
  buildNotFoundSeo,
  buildPrivateSeo,
  buildStaticInfoPageSeo,
  findStaticInfoPage,
  type GameMetadata,
  type PageSeo,
} from '@2play/shared';
import { renderShell, type SeoHeadExtras } from './render';

/**
 * Route → SEO resolution for the SPA shell.
 *
 * The resolution is a pure function of (path, catalogue): unit tests drive it
 * with the shared metadata directly, while the app wires it to the live
 * GameRegistry so it always agrees with /api/games.
 */
export interface SeoMetadataProvider {
  findGame: (gameId: string) => GameMetadata | undefined;
  listGames: () => readonly GameMetadata[];
}

export interface ResolvedPage {
  status: number;
  seo: PageSeo;
}

/** Same validation as the shared gameIdSchema — kebab-case ids only. */
const GAME_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

/**
 * Pages a signed-in player uses but nobody should land on from a search
 * result: live matches, room join/create flows and account surfaces. They get
 * a 200 (the app needs them) with a noindex head.
 */
const PRIVATE_TITLE_BY_PATH: Array<[prefix: string, title: string, description: string]> = [
  ['/room', 'Room', 'A live DuoPlay room. Rooms are private, realtime matches and are not indexed.'],
  ['/create', 'Create a Room', 'Create a DuoPlay room and invite friends with a room code.'],
  ['/join', 'Join a Room', 'Join a DuoPlay room with a room code from a friend.'],
  ['/settings', 'Settings', 'Your DuoPlay settings.'],
  ['/stats', 'Your Statistics', 'Your DuoPlay match statistics and history.'],
  ['/statistics', 'Your Statistics', 'Your DuoPlay match statistics and history.'],
  ['/favorites', 'Your Favorites', 'Your favorite DuoPlay games.'],
  ['/error', 'Something Went Wrong', 'Something went wrong.'],
];

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function resolveSeoForPath(pathname: string, provider: SeoMetadataProvider): ResolvedPage {
  const games = provider.listGames();
  // Anything but a clean root-relative path is not something we optimise for.
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;

  if (path === '/') {
    return { status: 200, seo: buildHomeSeo(games) };
  }

  if (path === '/games' || path === '/games/') {
    return { status: 200, seo: buildGamesCatalogSeo(games) };
  }

  // Public information & legal pages (registry-driven, indexable). A single
  // trailing slash is tolerated like /games/ — the canonical still points at
  // the clean URL.
  const staticInfoPage =
    findStaticInfoPage(path) ??
    (path.endsWith('/') && path.length > 1 ? findStaticInfoPage(path.slice(0, -1)) : undefined);
  if (staticInfoPage) {
    return { status: 200, seo: buildStaticInfoPageSeo(staticInfoPage) };
  }

  if (path.startsWith('/games/')) {
    const rest = path.slice('/games/'.length);
    // A nested path under /games/ is not a game page: '/games/chess/anything'
    // fails the pattern below (no slashes allowed), so it can never shadow or
    // duplicate the real page. A single trailing slash is tolerated and the
    // canonical still points at the clean URL.
    const cleaned = rest.endsWith('/') ? rest.slice(0, -1) : rest;
    const decoded = cleaned.length > 0 ? safeDecode(cleaned) : null;
    const gameId = decoded?.trim() ?? '';
    const game = decoded !== null && GAME_ID_PATTERN.test(gameId) ? provider.findGame(gameId) : undefined;
    if (game) {
      return { status: 200, seo: buildGameSeo(game) };
    }
    return { status: 404, seo: buildNotFoundSeo('Game') };
  }

  for (const [prefix, title, description] of PRIVATE_TITLE_BY_PATH) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return { status: 200, seo: buildPrivateSeo(title, description) };
    }
  }

  return { status: 404, seo: buildNotFoundSeo('Page') };
}

/**
 * The SPA catch-all: every unknown GET that is not an asset, an API route or
 * a discovery document lands here and receives the built shell with the head
 * block swapped for the resolved route — including real 404 status codes.
 * `extras` carries the env-configured webmaster verification tokens.
 */
export function createSpaSeoHandler(
  provider: SeoMetadataProvider,
  indexTemplate: string,
  extras: SeoHeadExtras = {},
) {
  return (req: Request, res: Response): void => {
    const { status, seo } = resolveSeoForPath(req.path, provider);
    res
      .status(status)
      // Same revalidation semantics the old sendFile fallback had: the shell
      // references content-hashed assets, so it must never be served stale.
      .set('Cache-Control', 'public, max-age=0, must-revalidate')
      .type('html')
      .send(renderShell(indexTemplate, seo, extras));
  };
}
