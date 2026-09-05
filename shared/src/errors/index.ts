/**
 * Platform-wide error codes.
 *
 * Every error surfaced to a client uses one of these codes plus a human readable
 * message. Internal stack traces are never serialised to the client.
 */

export const ERROR_CODES = {
  E001: 'INVALID_INPUT',
  E002: 'UNAUTHORIZED',
  E003: 'ROOM_NOT_FOUND',
  E004: 'ROOM_FULL',
  E005: 'GAME_NOT_FOUND',
  E006: 'INVALID_ACTION',
  E007: 'RATE_LIMITED',
  E008: 'CONNECTION_FAILED',
  E009: 'DATABASE_ERROR',
  E010: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
export type ErrorCodeName = (typeof ERROR_CODES)[ErrorCode];

export interface ErrorDetails {
  /** Machine readable field name, when the error targets one field. */
  field?: string;
  /** Safe-to-render extra info (never stack traces or secrets). */
  meta?: Record<string, string | number | boolean>;
}

export interface ApiError {
  code: ErrorCode;
  name: ErrorCodeName;
  message: string;
  details?: ErrorDetails;
}

export interface ErrorPayload {
  error: ApiError;
}

const HTTP_STATUS: Record<ErrorCode, number> = {
  E001: 400,
  E002: 401,
  E003: 404,
  E004: 409,
  E005: 404,
  E006: 400,
  E007: 429,
  E008: 503,
  E009: 503,
  E010: 500,
};

export function httpStatusFor(code: ErrorCode): number {
  return HTTP_STATUS[code] ?? 500;
}

export function makeError(
  code: ErrorCode,
  message: string,
  details?: ErrorDetails,
): ApiError {
  return { code, name: ERROR_CODES[code], message, ...(details ? { details } : {}) };
}

export function makeErrorPayload(
  code: ErrorCode,
  message: string,
  details?: ErrorDetails,
): ErrorPayload {
  return { error: makeError(code, message, details) };
}

export const ERROR_MESSAGES = {
  E001: 'Invalid input.',
  E002: 'You are not allowed to do that.',
  E003: 'Room not found.',
  E004: 'That room is full.',
  E005: 'Game not found.',
  E006: 'That action is not allowed right now.',
  E007: 'Slow down — you are doing that too fast.',
  E008: 'Connection failed.',
  E009: 'A storage problem occurred. Please try again.',
  E010: 'Something went wrong on our side.',
} as const;
