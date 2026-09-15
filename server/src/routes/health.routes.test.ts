import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createTestPlatform, type TestPlatform } from '../test/harness';

describe('health endpoints', () => {
  let app: Express;
  let testPlatform: TestPlatform;

  beforeEach(() => {
    testPlatform = createTestPlatform();
    app = createApp(testPlatform.platform);
  });

  afterEach(() => {
    testPlatform.destroy();
  });

  it('GET /healthz returns 200 with exactly { status: "ok" }', async () => {
    const response = await request(app).get('/healthz');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /healthz requires no authentication and carries safe headers', async () => {
    const response = await request(app).get('/healthz');
    expect(response.status).toBe(200);
    // Helmet headers apply; the server banner stays disabled.
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('GET /healthz exposes no secrets or internals', async () => {
    const response = await request(app).get('/healthz');
    const serialized = JSON.stringify(response.body);
    expect(Object.keys(response.body)).toEqual(['status']);
    for (const secret of ['SUPABASE', 'KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'stack', 'rooms']) {
      expect(serialized.toUpperCase()).not.toContain(secret);
    }
  });

  it('GET /api/health still works exactly as before', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.database).toBeDefined();
    expect(response.body.database.mode).toBeDefined();
  });

  it('leaves existing API routes unaffected', async () => {
    const games = await request(app).get('/api/games');
    expect(games.status).toBe(200);
    expect(Array.isArray(games.body.games)).toBe(true);
    expect(games.body.games.length).toBeGreaterThan(0);

    const missing = await request(app).get('/api/does-not-exist');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('E001');
  });
});
