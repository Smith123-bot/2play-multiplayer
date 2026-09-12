import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Loads `.env` files (root first, then server) without ever throwing when they
 * are missing — a missing env file is a normal state, a missing *required*
 * value is not.
 */
function loadEnvFiles(): void {
  const rootEnv = path.resolve(__dirname, '../../../.env');
  const serverEnv = path.resolve(__dirname, '../../.env');
  for (const file of [rootEnv, serverEnv]) {
    if (fs.existsSync(file)) {
      dotenv.config({ path: file, override: false });
    }
  }
}

loadEnvFiles();

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalUrl = z.preprocess(
  emptyToUndefined,
  z.string().url('SUPABASE_URL must be a valid URL.').optional(),
);

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  // Fail closed when deployed directly. Reverse-proxy deployments must opt in
  // with the exact trusted hop count so X-Forwarded-For cannot bypass limits.
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),

  SUPABASE_URL: optionalUrl,
  SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SUPABASE_DB_URL: optionalString,

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  MAX_ROOMS: z.coerce.number().int().min(1).max(100000).default(1000),
  MAX_PLAYERS_PER_ROOM: z.coerce.number().int().min(2).max(4).default(4),

  ROOM_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(300_000),
  ROOM_MAX_LIFETIME_MS: z.coerce.number().int().min(60_000).default(14_400_000),
  RECONNECT_GRACE_MS: z.coerce.number().int().min(5_000).default(120_000),
  REMATCH_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(60_000),

  CHAT_RATE_LIMIT_PER_SEC: z.coerce.number().int().min(1).max(50).default(5),
  ACTION_RATE_LIMIT_PER_SEC: z.coerce.number().int().min(1).max(200).default(20),
  ROOM_CREATE_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(600).default(20),
  ROOM_JOIN_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(600).default(60),
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(600).default(60),
  HTTP_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(300),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    // Logging to stderr directly: the logger itself depends on env.

    console.error(`[2PLAY] Invalid environment configuration:\n${issues}`);
    throw new Error('Invalid environment configuration.');
  }
  return parsed.data;
}

export const env: Env = parseEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * Resolves the allowed CORS origins.
 *
 * In production a wildcard is never returned: the API is credentialed
 * (`credentials: true`), and reflecting an arbitrary origin back with
 * credentials lets any site drive authenticated cross-origin requests. If
 * `CORS_ORIGIN` is missing or `*` in production we fall back to the configured
 * `CLIENT_URL` — a same-origin deployment keeps working, and a misconfigured
 * one fails closed instead of open.
 *
 * Development and test keep the permissive behaviour so local tooling, the
 * Vite dev server and the sandbox preview all work unchanged.
 */
export function parseCorsOrigins(): string[] | '*' {
  const raw = (env.CORS_ORIGIN ?? '').trim();
  const explicit = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value !== '*');

  if (explicit.length > 0) return explicit;

  if (env.NODE_ENV === 'production') {
    const fallback = (env.CLIENT_URL ?? '').trim();
    return fallback.length > 0 ? [fallback] : [];
  }
  return '*';
}

/** True when Supabase credentials are (at least partially) configured. */
export function hasSupabaseConfig(): boolean {
  // Server-side persistence depends on service-role-only RPCs. An anon key is
  // intentionally insufficient and must never be promoted to a write-capable
  // backend credential.
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}
