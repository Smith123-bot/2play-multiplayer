import { create } from 'zustand';
import { useSessionStore } from './sessionStore';
import { api } from '../services/api';

export interface FavoritesStoreState {
  favorites: string[];
  loading: boolean;
  pending: Record<string, boolean>;
  load: (force?: boolean) => Promise<void>;
  isFavorite: (gameId: string) => boolean;
  toggle: (gameId: string) => Promise<void>;
  clear: () => void;
}

export const useFavoritesStore = create<FavoritesStoreState>((set, get) => ({
  favorites: [],
  loading: false,
  pending: {},

  load: async (force = false) => {
    const session = useSessionStore.getState().session;
    if (!session) return;
    if (!force && get().favorites.length > 0) return;
    set({ loading: true });
    const result = await api.favorites(session.userId, session.sessionToken);
    if (result.ok && result.data) {
      set({ favorites: result.data.favorites.map((favorite) => favorite.gameId), loading: false });
    } else {
      set({ loading: false });
    }
  },

  isFavorite: (gameId) => get().favorites.includes(gameId),

  toggle: async (gameId) => {
    const session = useSessionStore.getState().session;
    if (!session) return;
    const isFavorite = get().favorites.includes(gameId);
    set({ pending: { ...get().pending, [gameId]: true } });

    const result = isFavorite
      ? await api.removeFavorite(gameId, session.sessionToken)
      : await api.addFavorite(gameId, session.sessionToken);

    set({ pending: { ...get().pending, [gameId]: false } });

    if (!result.ok) return;
    set({
      favorites: isFavorite
        ? get().favorites.filter((id) => id !== gameId)
        : [gameId, ...get().favorites],
    });
  },

  clear: () => set({ favorites: [], pending: {} }),
}));
