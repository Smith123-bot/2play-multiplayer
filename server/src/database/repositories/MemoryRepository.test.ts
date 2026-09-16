import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRepository } from './MemoryRepository';

function matchInput(matchId: string, result: 'win' | 'loss' | 'draw' = 'win') {
  return {
    userId: 'user-1',
    gameId: 'chess',
    result,
    score: result === 'win' ? 100 : 20,
    history: {
      userId: 'user-1',
      matchId,
      gameId: 'chess',
      roomId: 'ROOM01',
      players: [],
      winnerId: result === 'win' ? 'player-1' : null,
      result,
      score: result === 'win' ? 100 : 20,
      durationSeconds: 60,
    },
  };
}

describe('MemoryRepository match persistence contract', () => {
  let repository: MemoryRepository;

  beforeEach(() => {
    repository = new MemoryRepository();
  });

  it('does not double-count a retried match identifier', async () => {
    await repository.recordMatch(matchInput('match-1'));
    // A retry may carry the same match id even if a transport payload is
    // repeated; the durable repository contract must ignore it atomically.
    await repository.recordMatch(matchInput('match-1', 'loss'));

    await expect(repository.getStatistic('user-1', 'chess')).resolves.toMatchObject({
      wins: 1,
      losses: 0,
      totalPlayed: 1,
    });
    const history = await repository.getHistory('user-1');
    expect(history).toHaveLength(1);
    expect(history[0]?.matchId).toBe('match-1');
  });

  it('allows a new server match identifier for a rematch', async () => {
    await repository.recordMatch(matchInput('match-1'));
    await repository.recordMatch(matchInput('match-2', 'draw'));

    await expect(repository.getStatistic('user-1', 'chess')).resolves.toMatchObject({
      wins: 1,
      draws: 1,
      totalPlayed: 2,
    });
    await expect(repository.getHistory('user-1')).resolves.toHaveLength(2);
  });
});
