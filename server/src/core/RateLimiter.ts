import { createLogger, type Logger } from '../utils/logger';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterMs: number;
}

interface Bucket {
  hits: number[];
}

/**
 * Sliding-window rate limiter.
 *
 * Deliberately timer-free: expired hits are pruned lazily on access and by
 * `prune()` (driven by the platform sweep in TimerManager), so no hidden
 * setInterval lives outside TimerManager.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly logger: Logger = createLogger('RateLimiter');

  /** Records a hit when capacity is available. */
  consume(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((hit) => now - hit < windowMs);

    if (bucket.hits.length >= limit) {
      const oldest = bucket.hits[0] ?? now;
      const retryAfterMs = Math.max(0, windowMs - (now - oldest));
      this.buckets.set(key, bucket);
      this.logger.debug('rate limit hit', { key, limit, windowMs, retryAfterMs });
      return { allowed: false, remaining: 0, limit, retryAfterMs };
    }

    bucket.hits.push(now);
    this.buckets.set(key, bucket);
    return { allowed: true, remaining: limit - bucket.hits.length, limit, retryAfterMs: 0 };
  }

  /** Peek without consuming (used for health/debug). */
  inspect(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const hits = (this.buckets.get(key)?.hits ?? []).filter((hit) => now - hit < windowMs);
    const oldest = hits[0] ?? now;
    return {
      allowed: hits.length < limit,
      remaining: Math.max(0, limit - hits.length),
      limit,
      retryAfterMs: hits.length >= limit ? Math.max(0, windowMs - (now - oldest)) : 0,
    };
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  resetPrefix(prefix: string): void {
    for (const key of [...this.buckets.keys()]) {
      if (key.startsWith(prefix)) this.buckets.delete(key);
    }
  }

  prune(): number {
    const cutoff = Date.now() - 60 * 60 * 1000;
    let removed = 0;
    for (const [key, bucket] of [...this.buckets.entries()]) {
      if (bucket.hits.length === 0 || (bucket.hits.at(-1) ?? 0) < cutoff) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.buckets.size;
  }
}
