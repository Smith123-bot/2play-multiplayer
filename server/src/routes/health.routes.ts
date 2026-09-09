import { Router, type Request, type Response } from 'express';
import { APP_NAME, APP_VERSION } from '@2play/shared';
import type { Platform } from '../core/Platform';
import { env } from '../config/env';

/** GET /api/health — liveness, environment and database status. No secrets. */
export function createHealthRouter(platform: Platform): Router {
  const router = Router();
  const startedAt = Date.now();

  router.get('/health/detailed', (_req: Request, res: Response) => {
    // Detailed diagnostics are deliberately development/test only. Production
    // receives a normal 404 so room/player topology is not exposed publicly.
    if (env.NODE_ENV === 'production') {
      res.status(404).json({ status: 'not_found' });
      return;
    }
    const rooms = platform.roomStore.all();
    const games = Object.fromEntries(
      [...new Set(rooms.map((room) => room.gameId))].map((gameId) => [
        gameId,
        rooms.filter((room) => room.gameId === gameId).length,
      ]),
    );
    const memory = process.memoryUsage();
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
      rooms: rooms.length,
      games,
      sockets: platform.socketManager.connectionCount,
      sessions: platform.connectionManager.activeSessions,
      timers: platform.timerManager.activeCount,
      memory: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
      },
    });
  });

  router.get('/health', async (_req: Request, res: Response) => {
    const database = await platform.database.healthStatus();
    res.status(200).json({
      status: 'ok',
      service: APP_NAME.toLowerCase(),
      version: APP_VERSION,
      environment: env.NODE_ENV,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
      database: {
        connected: database.ok,
        mode: database.mode,
        ...(database.detail ? { detail: database.detail } : {}),
      },
      platform: {
        games: platform.registry.size,
        rooms: platform.roomStore.size,
        sockets: platform.socketManager.connectionCount,
        sessions: platform.connectionManager.activeSessions,
        timers: platform.timerManager.activeCount,
      },
    });
  });

  return router;
}
