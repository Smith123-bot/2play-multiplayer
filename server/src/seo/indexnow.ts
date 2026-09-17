import type { Request, Response } from 'express';
import {
  SITE_URL,
  gamePagePath,
  publicUrl,
  type GameMetadata,
} from '@2play/shared';

/**
 * IndexNow (https://www.indexnow.org/) — the push protocol Bing (and other
 * participating engines) accept for instant URL submission.
 *
 * Two moving parts:
 *  1. Key ownership proof — the key is served as a text file at
 *     `https://duoplay.in/<KEY>.txt` from this server (createIndexNowKeyHandler).
 *  2. Submission — a POST of the full public URL list to the IndexNow
 *     endpoint (submitIndexNow), driven by `npm run seo:submit`.
 *
 * The key ALWAYS comes from the INDEXNOW_KEY environment variable. It is a
 * shared-secret-by-obscurity credential: anyone who knows it can submit URLs
 * for the host, so it must never be committed into the repository.
 */

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

/** IndexNow keys: 8–128 characters, letters, digits and hyphen only. */
const INDEXNOW_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

/**
 * Webmaster verification tokens (Google `google-site-verification`, Bing
 * `msvalidate.01`) land inside a meta content attribute: keep them to a
 * conservative alphabet so a malformed value can never break the document.
 */
const VERIFICATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{4,256}$/;

/** Returns the key only when it satisfies the IndexNow format, else undefined. */
export function normalizeIndexNowKey(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  return INDEXNOW_KEY_PATTERN.test(value) ? value : undefined;
}

/** Returns the token only when it is safe to place in a meta attribute. */
export function normalizeVerificationToken(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  return VERIFICATION_TOKEN_PATTERN.test(value) ? value : undefined;
}

/** `/<KEY>.txt` — the exact document Bing fetches to verify key ownership. */
export function buildIndexNowKeyPath(key: string): string {
  return `/${key}.txt`;
}

/** Absolute keyLocation URL submitted inside the payload. */
export function buildIndexNowKeyLocation(key: string): string {
  return `${SITE_URL}${buildIndexNowKeyPath(key)}`;
}

/**
 * The complete public URL list — homepage, catalogue and every registered
 * game, straight from the registry metadata (never a hard-coded count).
 */
export function buildPublicUrlList(games: readonly GameMetadata[]): string[] {
  const urls = [publicUrl('/'), publicUrl('/games')];
  for (const game of games) {
    urls.push(publicUrl(gamePagePath(game.id)));
  }
  return [...new Set(urls)];
}

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

export function buildIndexNowPayload(key: string, urls: readonly string[]): IndexNowPayload {
  return {
    host: new URL(SITE_URL).host,
    key,
    keyLocation: buildIndexNowKeyLocation(key),
    urlList: [...new Set(urls)],
  };
}

/** Serves the ownership proof document: plain-text body containing only the key. */
export function createIndexNowKeyHandler(key: string) {
  return (_req: Request, res: Response): void => {
    res
      .status(200)
      .set('Cache-Control', 'public, max-age=3600')
      .type('text/plain')
      .send(`${key}\n`);
  };
}

/* ---------------- Submission (used by scripts/indexnow-submit.ts) ---------------- */

export interface FetchLikeResponse {
  status: number;
  text: () => Promise<string>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchLikeResponse>;

export interface IndexNowSubmissionResult {
  ok: boolean;
  status: number;
  body: string;
}

/**
 * POSTs the payload to the IndexNow endpoint. `fetchImpl` is injectable so
 * tests never touch the network; production uses the global fetch (Node 18+).
 */
export async function submitIndexNow(
  payload: IndexNowPayload,
  fetchImpl?: FetchLike,
): Promise<IndexNowSubmissionResult> {
  const fetchFn =
    fetchImpl ??
    ((globalThis as unknown as { fetch: FetchLike }).fetch as FetchLike | undefined);
  if (!fetchFn) {
    throw new Error('IndexNow submission requires fetch (Node.js 18+).');
  }
  const response = await fetchFn(INDEXNOW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  // 200 (accepted) and 202 (accepted, processing) are the protocol's success codes.
  return { ok: response.status === 200 || response.status === 202, status: response.status, body };
}
