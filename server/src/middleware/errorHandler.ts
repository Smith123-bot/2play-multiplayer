import type { NextFunction, Request, Response } from 'express';
import { httpStatusFor, makeErrorPayload } from '@2play/shared';
import { env } from '../config/env';
import { isAppError, toApiError } from '../utils/errors';
import { createLogger } from '../utils/logger';

const logger = createLogger('ErrorHandler');

/** 404 for unknown routes (API returns JSON, the SPA is handled separately). */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  if (req.path.startsWith('/api')) {
    const error = toApiError(new Error('API route not found.'));
    const payload = makeErrorPayload('E001', 'API route not found.');
    logger.debug('route not found', { path: req.path });
    void error;
    const res = _res;
    res.status(404).json(payload);
    return;
  }
  next();
}

/**
 * Central error handler.
 * Never leaks stack traces, SQL, secrets or internal messages in production.
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const apiError = toApiError(error);
  const status = httpStatusFor(apiError.code);

  if (!isAppError(error) || apiError.code === 'E010') {
    logger.error('unhandled error', {
      code: apiError.code,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  } else {
    logger.debug('request rejected', { code: apiError.code, message: apiError.message });
  }

  res.status(status).json({
    error: {
      ...apiError,
      ...(env.NODE_ENV !== 'production' && error instanceof Error && error.stack
        ? { details: { ...(apiError.details ?? {}), meta: { stack: error.stack.split('\n')[0] } } }
        : {}),
    },
  });
}
