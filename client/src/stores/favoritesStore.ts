import { create } from 'zustand';
import { useSessionStore } from './sessionStore';
import { api } from '../services/api';

export interface FavoritesStoreState {
  favorites: string[];
  /** User id represented by this server cache; never reuse it for another session. */
  loadedUserId: string | null;
  loading: boolean;
  pending: Record<string, boolean>;
  load: (force?: boolean) => Promise<void>;
  isFavorite: (gameId: string) => boolean;
  toggle: (gameId: string) => Promise<void>;
  clear: () => void;
}

export const useFavoritesStore = create<FavoritesStoreState>((set, get) => ({
  favorites: [],
  loadedUserId: null,
  loading: false,
  pending: {},

  load: async (force = false) => {
    const session = useSessionStore.getState().session;
    if (!session) {
      set({ favorites: [], loadedUserId: null, loading: false });
      return;
    }
    // Never render one account's cached favorites for another account while
    // the restored session is being authenticated.
    if (get().loadedUserId !== null && get().loadedUserId !== session.userId) {
      set({ favorites: [], loadedUserId: null });
    }
    if (!force && get().loadedUserId === session.userId) return;

    set({ loading: true });
    const requestedUserId = session.userId;
    const result = await api.favorites(session.userId, session.sessionToken);
    // A logout/login may have happened while the request was in flight. Do not
    // let the old response populate the new account's cache.
    if (useSessionStore.getState().session?.userId !== requestedUserId) {
      set({ loading: false });
      return;
    }
    if (result.ok && result.data) {
      set({
        favorites: result.data.favorites.map((favorite) => favorite.gameId),
        loadedUserId: requestedUserId,
        loading: false,
      });
    } else {
      set({ loading: false });
    }
  },

  isFavorite: (gameId) => get().favorites.includes(gameId),

  toggle: async (gameId) => {
    const session = useSessionStore.getState().session;
    if (!session) return;
    // A second tap while the first request is still in flight used to fire a
    // duplicate add and prepend the same id twice, so the Favorites rail could
    // show one game two times until the next reload.
    if (get().pending[gameId]) return;
    const isFavorite = get().favorites.includes(gameId);
    set({ pending: { ...get().pending, [gameId]: true } });

    const result = isFavorite
      ? await api.removeFavorite(gameId, session.sessionToken)
      : await api.addFavorite(gameId, session.sessionToken);

    set({ pending: { ...get().pending, [gameId]: false } });

    if (!result.ok || useSessionStore.getState().session?.userId !== session.userId) return;
    // Re-read and de-duplicate at resolve time: state may have moved while the
    // request was in flight.
    const current = get().favorites.filter((id) => id !== gameId);
    set({
      favorites: isFavorite ? current : [gameId, ...current],
      loadedUserId: session.userId,
    });
  },

  clear: () => set({ favorites: [], loadedUserId: null, pending: {} }),
}));
