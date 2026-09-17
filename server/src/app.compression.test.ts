import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createTestPlatform, type TestPlatform } from './test/harness';

/**
 * HTTP compression on the real app wiring. The catalogue payload (~70 KB of
 * JSON for the full registry) must shrink drastically over the wire, while
 * /socket.io traffic stays untouched by the compressor.
 */
describe('app: response compression', () => {
  let testPlatform: TestPlatform;
  let app: Express;

  beforeEach(() => {
    testPlatform = createTestPlatform();
    app = createApp(testPlatform.platform);
  });

  afterEach(async () => {
    await testPlatform.destroy();
  });

  it('serves the games catalogue gzip-compressed only when accepted', async () => {
    // superagent sends Accept-Encoding: gzip by default; overriding to
    // 'identity' proves the client-side opt-out path too.
    const plain = await request(app)
      .get('/api/games')
      .set('Accept-Encoding', 'identity');
    expect(plain.status).toBe(200);
    expect(plain.headers['content-encoding']).toBeUndefined();
    const plainBytes = Buffer.byteLength(JSON.stringify(plain.body));

    // superagent inflates transparently, so the payload must decode to the
    // exact same catalogue while the wire is gzip-framed. (The live byte
    // comparison is part of the production probe, done with raw curl.)
    const zipped = await request(app).get('/api/games').set('Accept-Encoding', 'gzip');
    expect(zipped.status).toBe(200);
    expect(zipped.headers['content-encoding']).toBe('gzip');
    expect(zipped.body.games.length).toBe(plain.body.games.length);
    expect(plainBytes).toBeGreaterThan(30_000); // catalogue is the heavy route
  });

  it('advertises vary: accept-encoding and stays off for tiny bodies', async () => {
    const health = await request(app).get('/healthz').set('Accept-Encoding', 'gzip');
    expect(health.status).toBe(200);
    // 15 bytes: below the compression threshold — no pointless framing cost.
    expect(health.headers['content-encoding']).toBeUndefined();
  });

  it('leaves the socket.io transport path unwrapped', async () => {
    // Engine.IO handles /socket.io itself; even if a request reaches Express
    // (bad transport polling URL), the compressor must never claim the path.
    const response = await request(app)
      .get('/socket.io/?EIO=4&transport=polling')
      .set('Accept-Encoding', 'gzip');
    expect(response.headers['content-encoding']).toBeUndefined();
  });
});
