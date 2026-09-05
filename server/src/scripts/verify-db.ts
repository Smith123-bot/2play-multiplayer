import { database } from '../database/client';
import { env } from '../config/env';

async function main(): Promise<void> {
  await database.init();
  const health = await database.healthStatus();

  console.log('2PLAY database verification');
  console.log(`  mode     : ${health.mode}`);
  console.log(`  connected: ${health.ok ? 'yes' : 'no'}`);
  if (health.detail) console.log(`  detail   : ${health.detail}`);
  console.log(`  supabase : ${env.SUPABASE_URL ?? '(not configured)'}`);

  if (health.ok) {
    const probe = await database.upsertUser({
      sessionToken: `verify-${Date.now()}`,
      nickname: 'VerifyBot',
      avatar: '🦊',
    });
    if (probe) {
      await database.addFavorite(probe.id, 'reaction-race');
      const favorites = await database.getFavorites(probe.id);
      const stats = await database.getStatistics(probe.id);
      const history = await database.getHistory(probe.id);
      console.log(`  probe user: ${probe.id}`);
      console.log(`  favorites : ${favorites.length}`);
      console.log(`  statistics: ${stats.length}`);
      console.log(`  history   : ${history.length}`);
    }
  }

  await database.close();
  process.exit(health.ok ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error('Database verification failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
