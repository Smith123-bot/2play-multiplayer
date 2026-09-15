import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SessionInfo } from '@2play/shared';

const { statistics, history } = vi.hoisted(() => ({
  statistics: vi.fn(),
  history: vi.fn(),
}));

vi.mock('../services/api', () => ({
  api: {
    statistics,
    history,
    games: async () => ({ ok: true, data: { games: [] } }),
  },
}));

import { StatisticsScreen } from './StatisticsScreen';
import { useStatisticsStore } from '../stores/statisticsStore';
import { useSessionStore } from '../stores/sessionStore';
import { useGameStore } from '../stores/gameStore';

const SESSION: SessionInfo = {
  userId: 'u1',
  sessionToken: 'token-u1',
  playerId: 'u1',
  nickname: 'Tester',
  avatar: '🦊',
  createdAt: Date.now(),
};

function renderScreen() {
  return render(
    <MemoryRouter>
      <StatisticsScreen />
    </MemoryRouter>,
  );
}

describe('StatisticsScreen', () => {
  beforeEach(() => {
    statistics.mockReset();
    history.mockReset();
    useStatisticsStore.getState().clear();
    useSessionStore.setState({ session: SESSION });
    useGameStore.setState({ games: [], loading: false });
  });

  it('displays database statistics after a fresh load', async () => {
    statistics.mockResolvedValue({
      ok: true,
      data: {
        statistics: [
          {
            userId: 'u1',
            gameId: 'chess',
            wins: 3,
            losses: 1,
            draws: 2,
            totalPlayed: 6,
            bestScore: 100,
            updatedAt: new Date().toISOString(),
          },
        ],
        summary: { totalPlayed: 6, wins: 3, losses: 1, draws: 2, winRate: 50, favoriteGameId: 'chess' },
      },
    });
    history.mockResolvedValue({
      ok: true,
      data: {
        history: [
          {
            id: 'h1',
            gameId: 'chess',
            gameName: 'Chess',
            roomId: 'ABC123',
            players: [{ id: 'u1', nickname: 'Tester', avatar: '🦊' }],
            winnerId: 'u1',
            winnerName: 'Tester',
            result: 'win',
            score: 100,
            durationSeconds: 60,
            playedAt: new Date().toISOString(),
          },
        ],
      },
    });

    renderScreen();

    await waitFor(() => expect(screen.queryByText(/loading statistics/i)).not.toBeInTheDocument());
    expect(screen.getByText('3W · 1L · 2D')).toBeInTheDocument();
    expect(screen.getByText('Chess')).toBeInTheDocument();
    // "Room ABC123 · …" spans multiple text nodes, so match on the container.
    expect(screen.getByText((_, element) => element?.textContent === 'Room ABC123 · 1m 00s · Tester')).toBeInTheDocument();
  });

  it('shows a retryable error without wiping previously known stats', async () => {
    // First load succeeds.
    statistics.mockResolvedValue({
      ok: true,
      data: {
        statistics: [],
        summary: { totalPlayed: 2, wins: 2, losses: 0, draws: 0, winRate: 100, favoriteGameId: 'uno' },
      },
    });
    history.mockResolvedValue({ ok: true, data: { history: [] } });
    renderScreen();
    await waitFor(() => expect(statistics).toHaveBeenCalled());

    // Refresh fails (backend down): error banner appears, old numbers stay.
    statistics.mockResolvedValue({ ok: false, error: { message: 'boom' } });
    await useStatisticsStore.getState().load(true);

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't refresh statistics/i);
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
});
