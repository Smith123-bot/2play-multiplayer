import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodSchema } from 'zod';
import { parseOrThrow } from '../utils/validate';

type Source = 'body' | 'params' | 'query';

/** Zod validation middleware for HTTP inputs. */
export function validate(schema: ZodSchema, source: Source = 'body'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = parseOrThrow(schema, req[source], `${source} payload`);
      // Replace with the parsed (and coerced) value so handlers get clean data.
      (req as unknown as Record<string, Record<string, unknown>>)[source] = parsed as Record<
        string,
        unknown
      >;
      next();
    } catch (error) {
      next(error);
    }
  };
}
