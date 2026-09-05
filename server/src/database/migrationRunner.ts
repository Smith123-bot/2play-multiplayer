import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { env } from '../config/env';
import { createLogger } from '../utils/logger';

const logger = createLogger('Migrations');
const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
  mode: 'postgres' | 'manual';
  message?: string;
}

export function listMigrations(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

export function readMigration(name: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
}

/**
 * Applies pending SQL migrations.
 *
 * Requires SUPABASE_DB_URL (direct Postgres connection). When only the HTTP
 * Supabase credentials are available the SQL files are printed for the SQL
 * editor instead (documented in docs/database.md).
 */
export async function runMigrations(): Promise<MigrationResult> {
  const migrations = listMigrations();

  if (!env.SUPABASE_DB_URL) {
    logger.warn(
      'SUPABASE_DB_URL is not set — cannot apply migrations automatically. ' +
        'Paste the SQL from server/src/database/migrations into the Supabase SQL editor, ' +
        'or set SUPABASE_DB_URL and re-run "npm run db:migrate".',
    );
    return {
      applied: [],
      skipped: migrations,
      mode: 'manual',
      message:
        'SUPABASE_DB_URL missing. Apply the SQL files in server/src/database/migrations via the Supabase SQL editor.',
    };
  }

  const client = new pg.Client({
    connectionString: env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });

  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.connect();
    await client.query(
      `create table if not exists schema_migrations (
         id uuid primary key default gen_random_uuid(),
         name text not null unique,
         applied_at timestamptz not null default now()
       );`,
    );
    const { rows } = await client.query<{ name: string }>('select name from schema_migrations;');
    const done = new Set(rows.map((row) => row.name));

    for (const migration of migrations) {
      if (done.has(migration)) {
        skipped.push(migration);
        continue;
      }
      const sql = readMigration(migration);
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1);', [migration]);
        await client.query('commit');
        applied.push(migration);
        logger.info('migration applied', { migration });
      } catch (error) {
        await client.query('rollback');
        logger.error('migration failed', {
          migration,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    logger.info('migrations complete', { applied: applied.length, skipped: skipped.length });
    return { applied, skipped, mode: 'postgres' };
  } finally {
    await client.end().catch(() => undefined);
  }
}
