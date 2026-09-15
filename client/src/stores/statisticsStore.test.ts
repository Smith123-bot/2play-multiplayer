import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionInfo } from '@2play/shared';

const { statistics, history } = vi.hoisted(() => ({
  statistics: vi.fn(),
  history: vi.fn(),
}));

vi.mock('../services/api', () => ({
  api: { statistics, history },
}));

import { useStatisticsStore } from './statisticsStore';
import { useSessionStore } from './sessionStore';

function sessionFor(userId: string): SessionInfo {
  return {
    userId,
    sessionToken: `token-${userId}`,
    playerId: userId,
    nickname: 'Tester',
    avatar: '🦊',
    createdAt: Date.now(),
  };
}

const STATS_PAYLOAD = {
  statistics: [
    {
      userId: 'u1',
      gameId: 'chess',
      wins: 3,
      losses: 1,
      draws: 0,
      totalPlayed: 4,
      bestScore: 100,
      updatedAt: new Date().toISOString(),
    },
  ],
  summary: { totalPlayed: 4, wins: 3, losses: 1, draws: 0, winRate: 75, favoriteGameId: 'chess' },
};

const HISTORY_PAYLOAD = {
  history: [
    {
      id: 'h1',
      gameId: 'chess',
      gameName: 'Chess',
      roomId: 'ABC123',
      players: [],
      winnerId: 'u1',
      winnerName: 'Tester',
      result: 'win',
      score: 100,
      durationSeconds: 60,
      playedAt: new Date().toISOString(),
    },
  ],
};

describe('statisticsStore', () => {
  beforeEach(() => {
    statistics.mockReset();
    history.mockReset();
    statistics.mockResolvedValue({ ok: true, data: STATS_PAYLOAD });
    history.mockResolvedValue({ ok: true, data: HISTORY_PAYLOAD });
    useStatisticsStore.getState().clear();
    useSessionStore.setState({ session: sessionFor('u1') });
  });

  it('loads statistics from the backend and caches them for the current user', async () => {
    await useStatisticsStore.getState().load();
    const state = useStatisticsStore.getState();
    expect(statistics).toHaveBeenCalledWith('u1', 'token-u1');
    expect(state.summary?.wins).toBe(3);
    expect(state.statistics).toHaveLength(1);
    expect(state.history).toHaveLength(1);
    expect(state.loadedUserId).toBe('u1');
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('serves the cache on repeat loads but refetches on force', async () => {
    await useStatisticsStore.getState().load();
    await useStatisticsStore.getState().load();
    expect(statistics).toHaveBeenCalledTimes(1);
    await useStatisticsStore.getState().load(true);
    expect(statistics).toHaveBeenCalledTimes(2);
  });

  it('never serves one user cached statistics belonging to another user', async () => {
    await useStatisticsStore.getState().load();
    expect(useStatisticsStore.getState().summary?.wins).toBe(3);

    // Identity changed (new login / restored different session): the old
    // cache must be dropped and fresh data fetched for the new user.
    statistics.mockResolvedValue({
      ok: true,
      data: {
        statistics: [],
        summary: { totalPlayed: 0, wins: 0, losses: 0, draws: 0, winRate: 0, favoriteGameId: null },
      },
    });
    history.mockResolvedValue({ ok: true, data: { history: [] } });
    useSessionStore.setState({ session: sessionFor('u2') });
    await useStatisticsStore.getState().load();

    expect(statistics).toHaveBeenCalledWith('u2', 'token-u2');
    const state = useStatisticsStore.getState();
    expect(state.loadedUserId).toBe('u2');
    expect(state.summary?.totalPlayed).toBe(0);
    expect(state.statistics).toEqual([]);
  });

  it('keeps previously known stats when a refresh fails', async () => {
    await useStatisticsStore.getState().load();
    statistics.mockResolvedValue({ ok: false, error: { message: 'network down' } });

    await useStatisticsStore.getState().load(true);

    const state = useStatisticsStore.getState();
    expect(state.error).toBe('network down');
    expect(state.loading).toBe(false);
    // Old data is preserved, not wiped.
    expect(state.summary?.wins).toBe(3);
    expect(state.statistics).toHaveLength(1);
  });

  it('reports genuinely missing stats as zero/empty, not an error', async () => {
    statistics.mockResolvedValue({
      ok: true,
      data: {
        statistics: [],
        summary: { totalPlayed: 0, wins: 0, losses: 0, draws: 0, winRate: 0, favoriteGameId: null },
      },
    });
    history.mockResolvedValue({ ok: true, data: { history: [] } });

    await useStatisticsStore.getState().load();

    const state = useStatisticsStore.getState();
    expect(state.error).toBeNull();
    expect(state.summary).toMatchObject({ totalPlayed: 0, wins: 0 });
    expect(state.statistics).toEqual([]);
    expect(state.history).toEqual([]);
  });

  it('clears when there is no session', async () => {
    await useStatisticsStore.getState().load();
    useSessionStore.setState({ session: null });
    await useStatisticsStore.getState().load();

    const state = useStatisticsStore.getState();
    expect(state.summary).toBeNull();
    expect(state.statistics).toEqual([]);
  });
});
