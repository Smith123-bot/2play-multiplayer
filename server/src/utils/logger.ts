import winston from 'winston';
import { env, isProduction, isTest } from '../config/env';

const { combine, timestamp, printf, colorize, errors, json, splat } = winston.format;

const devFormat = printf((info) => {
  const { level, message, timestamp: ts, context, ...rest } = info as unknown as Record<
    string,
    unknown
  > & { level: string; message: string };
  const restKeys = Object.keys(rest).filter((key) => !['stack', 'splat'].includes(key));
  const extra =
    restKeys.length > 0 ? ` ${JSON.stringify(Object.fromEntries(restKeys.map((k) => [k, rest[k]])))}` : '';
  const scope = typeof context === 'string' ? ` [${context}]` : '';
  return `${String(ts)} ${level}${scope}: ${String(message)}${extra}`;
});

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: combine(
    errors({ stack: true }),
    splat(),
    timestamp(),
    isProduction
      ? combine(timestamp(), json())
      : combine(colorize({ level: true }), timestamp({ format: 'HH:mm:ss.SSS' }), devFormat),
  ),
  transports: [new winston.transports.Console({ silent: isTest && process.env.LOG_IN_TESTS !== 'true' })],
  exitOnError: false,
});

/** Contextual logger used by every manager/game module. */
export function createLogger(context: string) {
  return {
    error: (message: string, meta?: Record<string, unknown>) => logger.error(message, { context, ...meta }),
    warn: (message: string, meta?: Record<string, unknown>) => logger.warn(message, { context, ...meta }),
    info: (message: string, meta?: Record<string, unknown>) => logger.info(message, { context, ...meta }),
    debug: (message: string, meta?: Record<string, unknown>) => logger.debug(message, { context, ...meta }),
  };
}

export type Logger = ReturnType<typeof createLogger>;

/** Never log secrets: strips token-like values from objects before logging. */
const SENSITIVE_KEYS = ['sessionToken', 'token', 'password', 'serviceRoleKey', 'apiKey', 'secret'];

export function redact(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value ?? {})) {
    output[key] = SENSITIVE_KEYS.some((sensitive) => key.toLowerCase().includes(sensitive.toLowerCase()))
      ? '[redacted]'
      : val;
  }
  return output;
}
