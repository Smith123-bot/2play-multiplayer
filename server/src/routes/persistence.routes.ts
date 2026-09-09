import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { gameIdSchema } from '@2play/shared';
import type { Platform } from '../core/Platform';
import type { Session } from '../managers/ConnectionManager';
import { AppError } from '../utils/errors';
import { parseOrThrow } from '../utils/validate';
import { asyncHandler } from '../middleware';

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

/** Resolve the caller: a valid `x-session-token` header wins. */
function resolveUserId(platform: Platform, req: Request, routeUserId?: string): string {
  const session = sessionFromRequest(platform, req);
  // User IDs are not credentials. Every persistence read/write requires the
  // caller's valid bearer session; accepting a route ID anonymously is an IDOR.
  if (!session) throw AppError.unauthorized('Authenticate to use this endpoint.');
  if (routeUserId) {
    parseOrThrow(userIdSchema, routeUserId, 'user id');
    if (routeUserId !== session.userId) throw AppError.unauthorized('You can only access your own data.');
  }
  return session.userId;
}

/** Persistent (REST) features: statistics, history and favorites. */
export function createPersistenceRouter(platform: Platform): Router {
  const router = Router();

  router.get('/statistics/:userId', asyncHandler(async (req: Request, res: Response) => {
    const userId = resolveUserId(platform, req, req.params.userId);
    const [statistics, summary] = await Promise.all([
      platform.statisticsManager.getStatistics(userId),
      platform.statisticsManager.getSummary(userId),
    ]);
    res.json({ userId, statistics, summary });
  }));

  router.get('/statistics/:userId/:gameId', asyncHandler(async (req: Request, res: Response) => {
    const userId = resolveUserId(platform, req, req.params.userId);
    const gameId = parseOrThrow(gameIdSchema, req.params.gameId, 'game id');
    const statistic = await platform.statisticsManager.getStatistic(userId, gameId);
    res.json({ statistic });
  }));

  router.get('/history/:userId', asyncHandler(async (req: Request, res: Response) => {
    const userId = resolveUserId(platform, req, req.params.userId);
    const limitRaw = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 20;
    const history = await platform.statisticsManager.getHistory(userId, limit);
    res.json({ userId, history });
  }));

  router.get('/favorites/:userId', asyncHandler(async (req: Request, res: Response) => {
    const userId = resolveUserId(platform, req, req.params.userId);
    const favorites = await platform.favoriteManager.list(userId);
    res.json({ userId, favorites });
  }));

  router.post('/favorites', asyncHandler(async (req: Request, res: Response) => {
    const body = parseOrThrow(favoriteBodySchema, req.body, 'favorite payload');
    const userId = resolveUserId(platform, req);
    const favorite = await platform.favoriteManager.add(userId, body.gameId);
    res.status(201).json({ favorite });
  }));

  router.delete('/favorites/:gameId', asyncHandler(async (req: Request, res: Response) => {
    const gameId = parseOrThrow(gameIdSchema, req.params.gameId, 'game id');
    const userId = resolveUserId(platform, req);
    await platform.favoriteManager.remove(userId, gameId);
    res.status(204).send();
  }));

  return router;
}
