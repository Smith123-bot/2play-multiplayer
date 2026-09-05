import fs from 'node:fs';
import path from 'node:path';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { makeErrorPayload } from '@2play/shared';
import { env, isProduction, parseCorsOrigins } from './config/env';
import type { Platform } from './core/Platform';
import { errorHandler, httpRateLimiter, notFoundHandler, requestLogger } from './middleware';
import { createApiRouter } from './routes';
import { createLogger } from './utils/logger';

const logger = createLogger('App');

/**
 * Builds the Express application: security headers, restricted CORS, JSON body
 * limits, HTTP rate limiting, REST routes and (in production) the built client.
 */
export function createApp(platform: Platform): Express {
  const app = express();
  const origins = parseCorsOrigins();

  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          frameAncestors: ["'self'", 'https://*.e2b.app'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'", 'ws:', 'wss:', 'https:'],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: origins === '*' ? true : origins,
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'x-session-token'],
      credentials: true,
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: '32kb' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(requestLogger);

  app.use('/api', httpRateLimiter, createApiRouter(platform));

  // Reject unknown API routes with JSON instead of HTML.
  app.use('/api', (req: Request, res: Response) => {
    res.status(404).json(makeErrorPayload('E001', `Route ${req.method} ${req.path} not found.`));
  });

  // Production: serve the built SPA (same origin => relative API/socket URLs).
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { maxAge: '1h', index: false }));
    app.get('*', (_req: Request, res: Response, next: NextFunction) => {
      const indexFile = path.join(clientDist, 'index.html');
      if (!fs.existsSync(indexFile)) {
        next();
        return;
      }
      res.sendFile(indexFile);
    });
    logger.info('serving client build', { path: clientDist });
  } else if (isProduction) {
    logger.warn('client build not found — API only mode', { expected: clientDist });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
