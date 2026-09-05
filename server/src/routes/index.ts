import { Router } from 'express';
import type { Platform } from '../core/Platform';
import { createGameRouter } from './game.routes';
import { createHealthRouter } from './health.routes';
import { createPersistenceRouter } from './persistence.routes';

export function createApiRouter(platform: Platform): Router {
  const router = Router();
  router.use(createHealthRouter(platform));
  router.use(createGameRouter(platform));
  router.use(createPersistenceRouter(platform));
  return router;
}

export { createHealthRouter, createGameRouter, createPersistenceRouter };
