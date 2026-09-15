import { create } from 'zustand';
import type { GameHistoryEntry, GameStatistics } from '@2play/shared';
import { useSessionStore } from './sessionStore';
import { api } from '../services/api';

export interface StatisticsSummary {
  totalPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  favoriteGameId: string | null;
}

export interface StatisticsStoreState {
  statistics: GameStatistics[];
  history: GameHistoryEntry[];
  summary: StatisticsSummary | null;
  /**
   * The user id the cached statistics belong to. The cache is never served
   * to a different user: after an identity change the next load refetches.
   */
  loadedUserId: string | null;
  loading: boolean;
  error: string | null;
  load: (force?: boolean) => Promise<void>;
  clear: () => void;
}

export const useStatisticsStore = create<StatisticsStoreState>((set, get) => ({
  statistics: [],
  history: [],
  summary: null,
  loadedUserId: null,
  loading: false,
  error: null,

  load: async (force = false) => {
    const session = useSessionStore.getState().session;
    if (!session) {
      set({ statistics: [], history: [], summary: null, loadedUserId: null, loading: false });
      return;
    }
    // Never serve one user's cached statistics to another identity.
    if (get().loadedUserId !== null && get().loadedUserId !== session.userId) {
      set({ statistics: [], history: [], summary: null, loadedUserId: null });
    }
    if (get().loading) return;
    if (!force && get().summary && get().loadedUserId === session.userId) return;

    set({ loading: true, error: null });
    const [stats, history] = await Promise.all([
      api.statistics(session.userId, session.sessionToken),
      api.history(session.userId, 30, session.sessionToken),
    ]);

    if (!stats.ok || !stats.data) {
      set({ loading: false, error: stats.error?.message ?? 'Could not load statistics.' });
      return;
    }

    set({
      statistics: stats.data.statistics,
      summary: (stats.data.summary ?? {
        totalPlayed: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        winRate: 0,
        favoriteGameId: null,
      }) as unknown as StatisticsSummary,
      loadedUserId: session.userId,
      history: history.ok && history.data ? history.data.history : [],
      loading: false,
      error: null,
    });
  },

  clear: () =>
    set({ statistics: [], history: [], summary: null, loadedUserId: null, loading: false, error: null }),
}));
