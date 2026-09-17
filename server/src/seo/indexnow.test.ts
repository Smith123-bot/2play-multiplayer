import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ALL_GAME_METADATA, SITE_URL, gamePagePath } from '@2play/shared';
import {
  INDEXNOW_ENDPOINT,
  buildIndexNowKeyLocation,
  buildIndexNowKeyPath,
  buildIndexNowPayload,
  buildPublicUrlList,
  createIndexNowKeyHandler,
  normalizeIndexNowKey,
  normalizeVerificationToken,
  submitIndexNow,
  type FetchLike,
} from './indexnow';

const VALID_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('normalizeIndexNowKey', () => {
  it('accepts a well-formed key', () => {
    expect(normalizeIndexNowKey(VALID_KEY)).toBe(VALID_KEY);
    expect(normalizeIndexNowKey(`  ${VALID_KEY}  `)).toBe(VALID_KEY); // trims
  });

  it('rejects missing, short, long and dirty keys — never trusted blindly', () => {
    expect(normalizeIndexNowKey(undefined)).toBeUndefined();
    expect(normalizeIndexNowKey('')).toBeUndefined();
    expect(normalizeIndexNowKey('   ')).toBeUndefined();
    expect(normalizeIndexNowKey('short')).toBeUndefined();
    expect(normalizeIndexNowKey('x'.repeat(129))).toBeUndefined();
    expect(normalizeIndexNowKey('has spaces inside')).toBeUndefined();
    expect(normalizeIndexNowKey('slash/not/allowed')).toBeUndefined();
    expect(normalizeIndexNowKey('<script>alert(1)</script>')).toBeUndefined();
  });
});

describe('normalizeVerificationToken', () => {
  it('accepts realistic tokens and rejects unsafe input', () => {
    expect(normalizeVerificationToken('ABCDEF1234567890_-xyz')).toBe('ABCDEF1234567890_-xyz');
    expect(normalizeVerificationToken('')).toBeUndefined();
    expect(normalizeVerificationToken(undefined)).toBeUndefined();
    expect(normalizeVerificationToken('has spaces')).toBeUndefined();
    expect(normalizeVerificationToken('token"onclick="bad')).toBeUndefined();
  });
});

describe('IndexNow key document', () => {
  it('serves the key as plain text at /<KEY>.txt', async () => {
    const app = express();
    app.get(buildIndexNowKeyPath(VALID_KEY), createIndexNowKeyHandler(VALID_KEY));

    const res = await request(app).get(`/${VALID_KEY}.txt`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text.trim()).toBe(VALID_KEY);
  });

  it('does not answer for any other filename', async () => {
    const app = express();
    app.get(buildIndexNowKeyPath(VALID_KEY), createIndexNowKeyHandler(VALID_KEY));

    const res = await request(app).get('/some-other-file.txt');
    expect(res.status).toBe(404);
  });
});

describe('public URL list', () => {
  it('contains homepage, catalogue and every registered game — dynamic, no duplicates', () => {
    const urls = buildPublicUrlList(ALL_GAME_METADATA);
    expect(urls[0]).toBe(`${SITE_URL}/`);
    expect(urls[1]).toBe(`${SITE_URL}/games`);
    expect(urls).toHaveLength(ALL_GAME_METADATA.length + 2);
    for (const game of ALL_GAME_METADATA) {
      expect(urls).toContain(`${SITE_URL}${gamePagePath(game.id)}`);
    }
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('shrinks with the catalogue instead of keeping stale URLs', () => {
    const urls = buildPublicUrlList(ALL_GAME_METADATA.slice(0, 2));
    expect(urls).toHaveLength(4);
    expect(urls).not.toContain(`${SITE_URL}${gamePagePath(ALL_GAME_METADATA[5]!.id)}`);
  });

  it('never includes rooms, API paths or private pages', () => {
    const urls = buildPublicUrlList(ALL_GAME_METADATA);
    for (const banned of ['/room/', '/api/', '/socket.io/', '/settings', '/favorites', '/stats']) {
      expect(urls.some((url) => url.includes(banned))).toBe(false);
    }
  });
});

describe('payload', () => {
  it('targets the production host with an absolute keyLocation and deduped URLs', () => {
    const urls = buildPublicUrlList(ALL_GAME_METADATA);
    const payload = buildIndexNowPayload(VALID_KEY, [...urls, urls[0]!]);
    expect(payload.host).toBe('duoplay.in');
    expect(payload.key).toBe(VALID_KEY);
    expect(payload.keyLocation).toBe(`${SITE_URL}/${VALID_KEY}.txt`);
    expect(payload.urlList).toHaveLength(urls.length); // duplicate homepage dropped
    for (const url of payload.urlList) {
      expect(url.startsWith(`${SITE_URL}/`)).toBe(true);
    }
  });
});

describe('submitIndexNow', () => {
  const payload = buildIndexNowPayload(VALID_KEY, buildPublicUrlList(ALL_GAME_METADATA.slice(0, 2)));

  it('POSTs JSON to the official endpoint and reports 200 as success', async () => {
    const calls: Array<{ url: string; init: { method: string; headers: Record<string, string>; body: string } }> = [];
    const fakeFetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return { status: 200, text: async () => '' };
    };
    const result = await submitIndexNow(payload, fakeFetch);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(INDEXNOW_ENDPOINT);
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.headers['Content-Type']).toBe('application/json; charset=utf-8');
    const body = JSON.parse(calls[0]!.init.body) as {
      host: string;
      key: string;
      keyLocation: string;
      urlList: string[];
    };
    expect(body.host).toBe('duoplay.in');
    expect(body.key).toBe(VALID_KEY);
    expect(body.keyLocation).toBe(buildIndexNowKeyLocation(VALID_KEY));
    expect(Array.isArray(body.urlList)).toBe(true);
  });

  it('reports non-2xx responses as failures with the response body', async () => {
    const fakeFetch: FetchLike = async () => ({ status: 422, text: async () => 'Invalid key' });
    const result = await submitIndexNow(payload, fakeFetch);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.body).toBe('Invalid key');
  });
});
