import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from '../helpers/server';

/**
 * IndexNow ownership-proof endpoint over the wire. The key comes from the
 * environment — this suite sets it before the server module graph loads
 * (helpers/server.ts imports ApplicationManager lazily for exactly this
 * reason), and it asserts the server exposes the key document at precisely
 * /<KEY>.txt and nowhere else.
 */
const TEST_KEY = 'arena-indexnow-test-key-0123456789abcdef';

let server: TestServer;

beforeAll(async () => {
  process.env.INDEXNOW_KEY = TEST_KEY;
  server = await startTestServer();
}, 30_000);

afterAll(async () => {
  await server?.stop();
  delete process.env.INDEXNOW_KEY;
});

describe('IndexNow key document', () => {
  it('serves the configured key as plain text at /<KEY>.txt', async () => {
    const response = await fetch(`${server.url}/${TEST_KEY}.txt`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect((await response.text()).trim()).toBe(TEST_KEY);
  });

  it('answers 404 for any similar-but-wrong filename', async () => {
    for (const path of [`/${TEST_KEY}-wrong.txt`, '/indexnow.txt', `/${TEST_KEY}`]) {
      const response = await fetch(`${server.url}${path}`);
      expect(response.status, path).toBe(404);
    }
  });

  it('keeps the discovery documents working alongside the key endpoint', async () => {
    const robots = await fetch(`${server.url}/robots.txt`);
    expect(robots.status).toBe(200);

    const sitemap = await fetch(`${server.url}/sitemap.xml`);
    expect(sitemap.status).toBe(200);
    const body = await sitemap.text();
    // The key document is a verification artifact, not content: it must never
    // be advertised to crawlers as an indexable URL.
    expect(body).not.toContain(`${TEST_KEY}.txt`);
  });
});
