import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import { HTTP_RATE_LIMIT_WINDOW_MS, HTTP_RATE_LIMIT_MAX } from '@2play/shared';
import { env } from '../config/env';
import { makeErrorPayload } from '@2play/shared';

/** Coarse HTTP guard rail in front of every API route. */
export const httpRateLimiter = rateLimit({
  windowMs: HTTP_RATE_LIMIT_WINDOW_MS,
  limit: env.HTTP_RATE_LIMIT_MAX ?? HTTP_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req: Request) => req.path === '/api/health',
  keyGenerator: (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown',
  handler: (_req, res) => {
    res.status(429).json(makeErrorPayload('E007', 'Too many requests. Slow down.'));
  },
});
