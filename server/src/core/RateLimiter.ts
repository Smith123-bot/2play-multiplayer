import { createLogger, type Logger } from '../utils/logger';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterMs: number;
}

interface Bucket {
  hits: number[];
  /** Index of the first live hit; avoids allocating/filtering on every event. */
  head: number;
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
    const bucket = this.buckets.get(key) ?? { hits: [], head: 0 };
    this.pruneBucket(bucket, now - windowMs);
    const activeHits = bucket.hits.length - bucket.head;

    if (activeHits >= limit) {
      const oldest = bucket.hits[bucket.head] ?? now;
      const retryAfterMs = Math.max(0, windowMs - (now - oldest));
      this.buckets.set(key, bucket);
      this.logger.debug('rate limit hit', { key, limit, windowMs, retryAfterMs });
      return { allowed: false, remaining: 0, limit, retryAfterMs };
    }

    bucket.hits.push(now);
    this.buckets.set(key, bucket);
    return { allowed: true, remaining: limit - activeHits - 1, limit, retryAfterMs: 0 };
  }

  /** Peek without consuming (used for health/debug). */
  inspect(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket) return { allowed: true, remaining: limit, limit, retryAfterMs: 0 };
    this.pruneBucket(bucket, now - windowMs);
    const count = bucket.hits.length - bucket.head;
    const oldest = bucket.hits[bucket.head] ?? now;
    return {
      allowed: count < limit,
      remaining: Math.max(0, limit - count),
      limit,
      retryAfterMs: count >= limit ? Math.max(0, windowMs - (now - oldest)) : 0,
    };
  }

  private pruneBucket(bucket: Bucket, cutoff: number): void {
    while (bucket.head < bucket.hits.length && (bucket.hits[bucket.head] ?? 0) <= cutoff) {
      bucket.head += 1;
    }
    // Compact infrequently; the hot path remains O(number of newly expired hits).
    if (bucket.head > 1024 && bucket.head * 2 >= bucket.hits.length) {
      bucket.hits.splice(0, bucket.head);
      bucket.head = 0;
    }
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
      if (bucket.head >= bucket.hits.length || (bucket.hits.at(-1) ?? 0) < cutoff) {
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
