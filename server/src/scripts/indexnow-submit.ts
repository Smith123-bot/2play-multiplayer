import { env } from '../config/env';
import { GameRegistry } from '../games/registry/GameRegistry';
import { GameLoader } from '../managers/GameLoader';
import type { Platform } from '../core/Platform';
import {
  buildIndexNowPayload,
  buildPublicUrlList,
  normalizeIndexNowKey,
  submitIndexNow,
} from '../seo/indexnow';

/**
 * `npm run seo:submit` — pushes the complete public URL list (homepage,
 * catalogue, every registered game page) to IndexNow so Bing re-crawls on
 * demand. Idempotent: safe to run after every deploy.
 *
 * Requires INDEXNOW_KEY in the environment. Without it the script exits
 * cleanly with an explanation — push submission is an optional accelerator,
 * the sitemap remains the source of truth.
 */
async function main(): Promise<void> {
  const key = normalizeIndexNowKey(env.INDEXNOW_KEY);
  if (!key) {
    if (env.INDEXNOW_KEY) {
      console.error(
        'INDEXNOW_KEY is set but invalid (expected 8–128 chars: A–Z, a–z, 0–9, hyphen). Nothing submitted.',
      );
      process.exit(1);
    }
    console.log('INDEXNOW_KEY not set — IndexNow submission skipped.');
    console.log('The sitemap at https://duoplay.in/sitemap.xml remains authoritative for crawlers.');
    return;
  }

  // Resolve the URL list from the same registry the running server uses, so a
  // game is submitted exactly when it actually exists.
  const registry = new GameRegistry();
  new GameLoader({ registry } as unknown as Platform).load();
  const urls = buildPublicUrlList(registry.getAllMetadata());
  const payload = buildIndexNowPayload(key, urls);

  console.log(`IndexNow submission for ${payload.host}`);
  console.log(`  keyLocation : ${payload.keyLocation}`);
  console.log(`  urls        : ${payload.urlList.length} (homepage, catalogue, ${registry.size} games)`);

  const result = await submitIndexNow(payload);
  console.log(`  response    : HTTP ${result.status}${result.body ? ` — ${result.body.slice(0, 200)}` : ''}`);
  if (!result.ok) {
    console.error('IndexNow submission failed.');
    process.exit(1);
  }
  console.log('IndexNow accepted the URL list.');
}

void main().catch((error: unknown) => {
  console.error('IndexNow submission errored:', error instanceof Error ? error.message : error);
  process.exit(1);
});
