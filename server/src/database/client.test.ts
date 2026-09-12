import { describe, expect, it, vi } from 'vitest';
import { Database } from './client';
import { MemoryRepository } from './repositories/MemoryRepository';

describe('Database health caching', () => {
  it('coalesces concurrent health checks and caches the result', async () => {
    const repository = new MemoryRepository();
    const health = vi.spyOn(repository, 'health');
    const database = new Database(repository);
    await database.init();
    health.mockClear();

    const results = await Promise.all(Array.from({ length: 100 }, () => database.healthStatus()));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(health).toHaveBeenCalledTimes(1);

    await database.healthStatus();
    expect(health).toHaveBeenCalledTimes(1);
    await database.close();
  });
});
