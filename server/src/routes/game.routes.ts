import { Router, type Request, type Response } from 'express';
import { gameIdSchema } from '@2play/shared';
import type { Platform } from '../core/Platform';
import { AppError } from '../utils/errors';
import { parseOrThrow } from '../utils/validate';

/** Game catalogue (metadata only — games are never described in the frontend). */
export function createGameRouter(platform: Platform): Router {
  const router = Router();

  router.get('/games', (_req: Request, res: Response) => {
    res.json({ games: platform.registry.getAllMetadata() });
  });

  router.get('/games/:gameId', (req: Request, res: Response) => {
    const gameId = parseOrThrow(gameIdSchema, req.params.gameId, 'game id');
    const game = platform.registry.get(gameId);
    res.json({ game: game.metadata });
  });

  router.get('/rooms', (req: Request, res: Response) => {
    const gameId = req.query.gameId ? parseOrThrow(gameIdSchema, req.query.gameId, 'game id') : undefined;
    const rooms = platform.roomManager.listRooms({
      ...(gameId ? { gameId } : {}),
      includePrivate: false,
    });
    res.json({ rooms });
  });

  router.get('/rooms/:roomId', (req: Request, res: Response) => {
    const room = platform.roomStore.get(String(req.params.roomId).toUpperCase());
    if (!room) throw AppError.roomNotFound('This room does not exist.');
    res.json({
      room: room.toSummary(platform.registry.find(room.gameId)?.metadata.name ?? room.gameId),
    });
  });

  return router;
}
