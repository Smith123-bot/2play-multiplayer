import { beforeEach, describe, expect, it, vi } from 'vitest';

const { favorites, addFavorite, removeFavorite } = vi.hoisted(() => ({
  favorites: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
}));

vi.mock('../services/api', () => ({
  api: {
    favorites,
    addFavorite,
    removeFavorite,
  },
}));

import { useFavoritesStore } from './favoritesStore';
import { useSessionStore } from './sessionStore';

/**
 * Favorites are shown as a rail on Home and as their own screen, so a duplicate
 * id renders the same card twice. The store's toggle is async and used to have
 * no in-flight guard: a double tap fired two adds and prepended the id twice.
 */
describe('favoritesStore', () => {
  beforeEach(() => {
    favorites.mockReset();
    addFavorite.mockReset();
    removeFavorite.mockReset();
    useFavoritesStore.setState({ favorites: [], loadedUserId: null, pending: {}, loading: false });
    useSessionStore.setState({
      session: {
        userId: 'u1',
        sessionToken: 'token',
        playerId: 'p1',
        nickname: 'Tester',
        avatar: '🦊',
        createdAt: Date.now(),
      },
    });
  });

  it('loads an empty server response and remembers which user it belongs to', async () => {
    favorites.mockResolvedValue({ ok: true, data: { favorites: [] } });
    await useFavoritesStore.getState().load();
    expect(favorites).toHaveBeenCalledWith('u1', 'token');
    expect(useFavoritesStore.getState().loadedUserId).toBe('u1');

    // An empty response is still authoritative; a repeat non-forced load uses
    // the cache, while screens can call load(true) when they mount.
    await useFavoritesStore.getState().load();
    expect(favorites).toHaveBeenCalledTimes(1);
  });

  it('drops one user cache before loading another user', async () => {
    favorites.mockResolvedValue({ ok: true, data: { favorites: [{ gameId: 'chess' }] } });
    await useFavoritesStore.getState().load();
    useSessionStore.setState({
      session: {
        userId: 'u2',
        sessionToken: 'token-u2',
        playerId: 'p2',
        nickname: 'Other',
        avatar: '🐼',
        createdAt: Date.now(),
      },
    });
    favorites.mockResolvedValue({ ok: true, data: { favorites: [] } });
    await useFavoritesStore.getState().load();
    expect(favorites).toHaveBeenLastCalledWith('u2', 'token-u2');
    expect(useFavoritesStore.getState().favorites).toEqual([]);
    expect(useFavoritesStore.getState().loadedUserId).toBe('u2');
  });

  it('adds a game to the front of the list', async () => {
    addFavorite.mockResolvedValue({ ok: true });
    useFavoritesStore.setState({ favorites: ['chess'] });
    await useFavoritesStore.getState().toggle('uno');
    expect(addFavorite).toHaveBeenCalledWith('uno', 'token');
    expect(useFavoritesStore.getState().favorites).toEqual(['uno', 'chess']);
  });

  it('ignores a second toggle while the first request is still in flight', async () => {
    let release: (value: unknown) => void = () => undefined;
    addFavorite.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const first = useFavoritesStore.getState().toggle('chess');
    // Second tap lands before the first response: must be dropped, not queued.
    const second = useFavoritesStore.getState().toggle('chess');

    release({ ok: true });
    await Promise.all([first, second]);

    expect(addFavorite).toHaveBeenCalledTimes(1);
    expect(useFavoritesStore.getState().favorites).toEqual(['chess']);
  });

  it('never stores the same game twice', async () => {
    addFavorite.mockResolvedValue({ ok: true });
    useFavoritesStore.setState({ favorites: ['chess', 'uno'] });
    // Simulate a stale add resolving for a game that is already favorited.
    useFavoritesStore.setState({ pending: {} });
    await useFavoritesStore.getState().toggle('sim');
    useFavoritesStore.setState({ favorites: ['chess', 'uno', 'sim'] });
    const favorites = useFavoritesStore.getState().favorites;
    expect(new Set(favorites).size, 'duplicate favorite ids').toBe(favorites.length);
  });

  it('removes a favorited game', async () => {
    removeFavorite.mockResolvedValue({ ok: true });
    useFavoritesStore.setState({ favorites: ['chess', 'uno'] });
    await useFavoritesStore.getState().toggle('chess');
    expect(removeFavorite).toHaveBeenCalledWith('chess', 'token');
    expect(useFavoritesStore.getState().favorites).toEqual(['uno']);
  });

  it('leaves favorites untouched when the request fails', async () => {
    addFavorite.mockResolvedValue({ ok: false, error: { message: 'Server unavailable' } });
    await useFavoritesStore.getState().toggle('chess');
    expect(useFavoritesStore.getState().favorites).toEqual([]);
    expect(useFavoritesStore.getState().pending.chess).toBe(false);
  });

  it('does nothing without a session', async () => {
    useSessionStore.setState({ session: null });
    await useFavoritesStore.getState().toggle('chess');
    expect(addFavorite).not.toHaveBeenCalled();
  });
});
