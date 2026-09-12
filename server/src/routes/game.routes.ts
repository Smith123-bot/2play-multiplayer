import { Router, type Request, type Response } from 'express';
import { gameIdSchema, roomCodeSchema } from '@2play/shared';
import type { Platform } from '../core/Platform';
import { AppError } from '../utils/errors';
import { parseOrThrow } from '../utils/validate';

/** Game catalogue (metadata only — games are never described in the frontend). */
export function createGameRouter(platform: Platform): Router {
  const router = Router();

  router.get('/games', (_req: Request, res: Response) => {
    res.json({ games: platform.registry.getAllMetadata() });
  });

  /** Real, platform-wide "most played" ranking — never fabricated (spec §14). */
  router.get('/games/popularity', (_req: Request, res: Response) => {
    res.json({ popularity: platform.statisticsManager.getGlobalPopularity() });
  });

  router.get('/games/:gameId', (req: Request, res: Response) => {
    const gameId = parseOrThrow(gameIdSchema, req.params.gameId, 'game id');
    const game = platform.registry.get(gameId);
    res.json({ game: game.metadata });
  });

  router.get('/rooms', (req: Request, res: Response) => {
    const gameId = req.query.gameId
      ? parseOrThrow(gameIdSchema, req.query.gameId, 'game id')
      : undefined;
    const rooms = platform.roomManager.listRooms({
      ...(gameId ? { gameId } : {}),
    });
    res.json({ rooms });
  });

  router.get('/rooms/:roomId', (req: Request, res: Response) => {
    const roomId = parseOrThrow(roomCodeSchema, req.params.roomId, 'room code');
    const room = platform.roomStore.get(roomId);
    // Private and Quick Play rooms are deliberately indistinguishable from an
    // unknown code on this unauthenticated discovery endpoint.
    if (!room || room.isPrivate || room.isQuickPlay) {
      throw AppError.roomNotFound('Room not found or no longer available.');
    }
    res.json({
      room: room.toSummary(platform.registry.find(room.gameId)?.metadata.name ?? room.gameId),
    });
  });

  return router;
}
