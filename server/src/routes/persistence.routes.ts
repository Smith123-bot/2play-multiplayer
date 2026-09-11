import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { z } from 'zod';
import { gameIdSchema } from '@2play/shared';
import type { Platform } from '../core/Platform';
import type { Session } from '../managers/ConnectionManager';
import { AppError } from '../utils/errors';
import { parseOrThrow } from '../utils/validate';

const userIdSchema = z.string().uuid('Invalid user id.');
const favoriteBodySchema = z
  .object({
    gameId: gameIdSchema,
  })
  .strict();

function sessionFromRequest(platform: Platform, req: Request): Session | null {
  const token = req.header('x-session-token');
  if (!token) return null;
  return platform.connectionManager.getSessionByToken(token) ?? null;
}

/**
 * Resolves the caller and enforces ownership.
 *
 * These endpoints expose personal data (statistics, match history, favourites),
 * so a valid `x-session-token` is ALWAYS required and the caller may only ever
 * reach their own records.
 *
 * Previously an unauthenticated (or invalid-token) request that supplied a
 * well-formed uuid in the path was served that user's data, which allowed
 * anyone to read another player's statistics, history and favourites by id
 * (IDOR / broken access control). Both holes are closed here: a missing token
 * and an unknown token now fail identically, and a mismatched id is rejected.
 */
function resolveUserId(platform: Platform, req: Request, routeUserId?: string): string {
  const session = sessionFromRequest(platform, req);
  // No session, or a token we do not recognise: identical generic failure so
  // the response cannot be used to probe which tokens or ids exist.
  if (!session) throw AppError.unauthorized('Authenticate to use this endpoint.');

  if (routeUserId !== undefined) {
    // Validate the shape first so a malformed id never reaches the comparison.
    parseOrThrow(userIdSchema, routeUserId, 'user id');
    if (routeUserId !== session.userId) {
      throw AppError.unauthorized('You can only access your own data.');
    }
  }
  return session.userId;
}

/**
 * Wraps an async route so a rejected promise reaches the central error handler.
 *
 * Express 4 does not catch rejections from async handlers: without this the
 * request hangs until the client times out (and the rejection surfaces as an
 * unhandled promise). That turns an ordinary 401 into a resource leak, so every
 * async route below is wrapped.
 */
function asyncRoute(handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void Promise.resolve(handler(req, res)).catch(next);
  };
}

/** Persistent (REST) features: statistics, history and favorites. */
export function createPersistenceRouter(platform: Platform): Router {
  const router = Router();

  router.get(
    '/statistics/:userId',
    asyncRoute(async (req: Request, res: Response) => {
      const userId = resolveUserId(platform, req, req.params.userId);
      const [statistics, summary] = await Promise.all([
        platform.statisticsManager.getStatistics(userId),
        platform.statisticsManager.getSummary(userId),
      ]);
      res.json({ userId, statistics, summary });
    }),
  );

  router.get(
    '/statistics/:userId/:gameId',
    asyncRoute(async (req: Request, res: Response) => {
      const userId = resolveUserId(platform, req, req.params.userId);
      const gameId = parseOrThrow(gameIdSchema, req.params.gameId, 'game id');
      const statistic = await platform.statisticsManager.getStatistic(userId, gameId);
      res.json({ statistic });
    }),
  );

  router.get(
    '/history/:userId',
    asyncRoute(async (req: Request, res: Response) => {
      const userId = resolveUserId(platform, req, req.params.userId);
      const limitRaw = Number(req.query.limit ?? 20);
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(100, Math.floor(limitRaw)))
        : 20;
      const history = await platform.statisticsManager.getHistory(userId, limit);
      res.json({ userId, history });
    }),
  );

  router.get(
    '/favorites/:userId',
    asyncRoute(async (req: Request, res: Response) => {
      const userId = resolveUserId(platform, req, req.params.userId);
      const favorites = await platform.favoriteManager.list(userId);
      res.json({ userId, favorites });
    }),
  );

  router.post(
    '/favorites',
    asyncRoute(async (req: Request, res: Response) => {
      const body = parseOrThrow(favoriteBodySchema, req.body, 'favorite payload');
      const userId = resolveUserId(platform, req);
      const favorite = await platform.favoriteManager.add(userId, body.gameId);
      res.status(201).json({ favorite });
    }),
  );

  router.delete(
    '/favorites/:gameId',
    asyncRoute(async (req: Request, res: Response) => {
      const gameId = parseOrThrow(gameIdSchema, req.params.gameId, 'game id');
      const userId = resolveUserId(platform, req);
      await platform.favoriteManager.remove(userId, gameId);
      res.status(204).send();
    }),
  );

  return router;
}
