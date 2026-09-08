import { create } from 'zustand';
import type { GamePopularity } from '@2play/shared';
import { api } from '../services/api';

/**
 * Real, platform-wide "Most Played" ranking (spec: never fabricated numbers).
 * Backed by `StatisticsManager.getGlobalPopularity()` — counts completed
 * matches across every player, not just the current user.
 */
export interface PopularityStoreState {
  popularity: GamePopularity[];
  loading: boolean;
  loadedAt: number | null;
  load: (force?: boolean) => Promise<GamePopularity[]>;
}

export const usePopularityStore = create<PopularityStoreState>((set, get) => ({
  popularity: [],
  loading: false,
  loadedAt: null,

  load: async (force = false) => {
    const state = get();
    if (!force && state.loadedAt && Date.now() - state.loadedAt < 30_000) {
      return state.popularity;
    }
    set({ loading: true });
    const result = await api.popularity();
    if (!result.ok || !result.data) {
      set({ loading: false });
      return get().popularity;
    }
    set({ popularity: result.data.popularity, loading: false, loadedAt: Date.now() });
    return result.data.popularity;
  },
}));
