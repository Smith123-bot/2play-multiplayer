import { type ZodError, type ZodTypeAny, type output } from 'zod';
import { AppError } from './errors';

/**
 * Parses a payload with Zod and converts failures into E001 AppErrors whose
 * `details.meta.fields` describe exactly what was wrong.
 */
export function parseOrThrow<S extends ZodTypeAny>(
  schema: S,
  payload: unknown,
  label = 'payload',
): output<S> {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw AppError.invalidInput(`Invalid ${label}.`, {
      field: result.error.issues[0]?.path.join('.') || undefined,
      meta: {
        issues: result.error.issues.length,
        first: result.error.issues[0]?.message ?? 'unknown',
      },
    });
  }
  return result.data;
}

export function formatZodError(error: ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`).join('; ');
}
