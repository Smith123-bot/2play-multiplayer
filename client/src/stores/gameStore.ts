import { create } from 'zustand';
import type { GameMetadata } from '@2play/shared';
import { api } from '../services/api';

export interface GameStoreState {
  games: GameMetadata[];
  loading: boolean;
  error: string | null;
  loadedAt: number | null;
  load: (force?: boolean) => Promise<GameMetadata[]>;
  getGame: (gameId: string) => GameMetadata | undefined;
}

export const useGameStore = create<GameStoreState>((set, get) => ({
  games: [],
  loading: false,
  error: null,
  loadedAt: null,

  load: async (force = false) => {
    const state = get();
    if (!force && state.games.length > 0 && state.loadedAt && Date.now() - state.loadedAt < 60_000) {
      return state.games;
    }
    set({ loading: true, error: null });
    const result = await api.games();
    if (!result.ok || !result.data) {
      set({ loading: false, error: result.error?.message ?? 'Could not load games.' });
      return get().games;
    }
    set({ games: result.data.games, loading: false, loadedAt: Date.now(), error: null });
    return result.data.games;
  },

  getGame: (gameId) => get().games.find((game) => game.id === gameId),
}));
