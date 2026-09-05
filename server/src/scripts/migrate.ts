import { runMigrations, listMigrations } from '../database/migrationRunner';
import { env } from '../config/env';

async function main(): Promise<void> {
  console.log('2PLAY database migrations');
  console.log(`  environment : ${env.NODE_ENV}`);
  console.log(`  supabase url: ${env.SUPABASE_URL ?? '(not set)'}`);
  console.log(`  db url      : ${env.SUPABASE_DB_URL ? '(set)' : '(not set)'}`);
  console.log(`  migrations  : ${listMigrations().join(', ')}`);

  const result = await runMigrations();

  console.log(`\napplied : ${result.applied.length ? result.applied.join(', ') : '(none)'}`);
  console.log(`skipped : ${result.skipped.length ? result.skipped.join(', ') : '(none)'}`);
  if (result.message) {
    console.log(`\nNOTE: ${result.message}`);
  }
}

void main().catch((error: unknown) => {
  console.error('Migration failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
