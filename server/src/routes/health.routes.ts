import { Router, type Request, type Response } from 'express';
import { APP_NAME, APP_VERSION } from '@2play/shared';
import type { Platform } from '../core/Platform';
import { env, isProduction } from '../config/env';

/** GET /api/health — liveness, environment and database status. No secrets. */
export function createHealthRouter(platform: Platform): Router {
  const router = Router();
  const startedAt = Date.now();

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
        // Raw provider/database errors may contain internal infrastructure
        // details. They remain server-side in production.
        ...(!isProduction && database.detail ? { detail: database.detail } : {}),
      },
      ...(!isProduction
        ? {
            platform: {
              games: platform.registry.size,
              rooms: platform.roomStore.size,
              sockets: platform.socketManager.connectionCount,
              sessions: platform.connectionManager.activeSessions,
              timers: platform.timerManager.activeCount,
            },
          }
        : {}),
    });
  });

  return router;
}
