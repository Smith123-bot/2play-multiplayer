import { describe, expect, it, vi } from 'vitest';
import { RateLimiter } from './RateLimiter';

describe('RateLimiter', () => {
  it('allows up to the limit then rejects', () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.consume('chat', 5, 1000).allowed).toBe(true);
    }
    const blocked = limiter.consume('chat', 5, 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills after the window elapses', async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter();
    limiter.consume('x', 1, 1000);
    expect(limiter.consume('x', 1, 1000).allowed).toBe(false);
    vi.advanceTimersByTime(1100);
    expect(limiter.consume('x', 1, 1000).allowed).toBe(true);
    vi.useRealTimers();
  });

  it('isolates keys and supports reset/prune', () => {
    const limiter = new RateLimiter();
    limiter.consume('a', 1, 1000);
    expect(limiter.consume('a', 1, 1000).allowed).toBe(false);
    expect(limiter.consume('b', 1, 1000).allowed).toBe(true);
    limiter.reset('a');
    expect(limiter.consume('a', 1, 1000).allowed).toBe(true);
    expect(limiter.prune()).toBeGreaterThanOrEqual(0);
  });
});
