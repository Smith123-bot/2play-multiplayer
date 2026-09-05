import {
  ApiError,
  ErrorCode,
  ERROR_CODES,
  ERROR_MESSAGES,
  ErrorDetails,
  makeError,
} from '@2play/shared';

/**
 * Application error carrying a platform error code.
 * Internal errors never leak to clients: `toApiError()` sanitises them.
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: ErrorDetails;
  public override readonly cause?: unknown;

  constructor(code: ErrorCode, message?: string, details?: ErrorDetails, cause?: unknown) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    if (details) this.details = details;
    if (cause !== undefined) this.cause = cause;
    Error.captureStackTrace?.(this, AppError);
  }

  static invalidInput(message?: string, details?: ErrorDetails): AppError {
    return new AppError('E001', message, details);
  }

  static unauthorized(message?: string): AppError {
    return new AppError('E002', message);
  }

  static roomNotFound(message?: string): AppError {
    return new AppError('E003', message);
  }

  static roomFull(message?: string): AppError {
    return new AppError('E004', message);
  }

  static gameNotFound(message?: string): AppError {
    return new AppError('E005', message);
  }

  static invalidAction(message?: string, details?: ErrorDetails): AppError {
    return new AppError('E006', message, details);
  }

  static rateLimited(message?: string): AppError {
    return new AppError('E007', message);
  }

  static connectionFailed(message?: string): AppError {
    return new AppError('E008', message);
  }

  static databaseError(message?: string, cause?: unknown): AppError {
    return new AppError('E009', message, undefined, cause);
  }

  static internal(message?: string, cause?: unknown): AppError {
    return new AppError('E010', message, undefined, cause);
  }

  toApiError(): ApiError {
    return makeError(this.code, this.message, this.details);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Converts anything thrown into a safe, client-renderable ApiError. */
export function toApiError(error: unknown): ApiError {
  if (isAppError(error)) return error.toApiError();
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code in ERROR_CODES) {
      return makeError(code as ErrorCode, (error as { message?: string }).message ?? ERROR_MESSAGES[code as ErrorCode]);
    }
  }
  return makeError('E010', ERROR_MESSAGES.E010);
}

/** Error message safe to log (never contains secrets). */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
