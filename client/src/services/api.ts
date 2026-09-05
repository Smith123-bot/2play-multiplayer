import type {
  ApiError,
  FavoriteGame,
  GameHistoryEntry,
  GameMetadata,
  GameStatistics,
  RoomSummary,
} from '@2play/shared';
import { apiUrl } from '../core/config';

export interface ApiResult<T> {
  ok: boolean;
  data: T | null;
  error: ApiError | null;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const response = await fetch(apiUrl(path), {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });

    if (response.status === 204) return { ok: true, data: null, error: null };

    const body = (await response.json().catch(() => null)) as
      | (T & { error?: ApiError })
      | { error?: ApiError }
      | null;

    if (!response.ok) {
      const error: ApiError =
        (body as { error?: ApiError })?.error ??
        ({ code: 'E010', name: 'INTERNAL_ERROR', message: 'Request failed.' } as ApiError);
      return { ok: false, data: null, error };
    }

    return { ok: true, data: body as T, error: null };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: {
        code: 'E008',
        name: 'CONNECTION_FAILED',
        message: error instanceof Error ? error.message : 'Network error.',
      },
    };
  }
}

function sessionHeaders(token?: string | null): Record<string, string> {
  return token ? { 'x-session-token': token } : {};
}

export const api = {
  async health(): Promise<ApiResult<{ status: string; database: { connected: boolean; mode: string } }>> {
    return request('/api/health');
  },

  async games(): Promise<ApiResult<{ games: GameMetadata[] }>> {
    return request('/api/games');
  },

  async game(gameId: string): Promise<ApiResult<{ game: GameMetadata }>> {
    return request(`/api/games/${encodeURIComponent(gameId)}`);
  },

  async rooms(gameId?: string): Promise<ApiResult<{ rooms: RoomSummary[] }>> {
    const query = gameId ? `?gameId=${encodeURIComponent(gameId)}` : '';
    return request(`/api/rooms${query}`);
  },

  async statistics(userId: string, token?: string | null) {
    return request<{ statistics: GameStatistics[]; summary: Record<string, number> }>(
      `/api/statistics/${encodeURIComponent(userId)}`,
      { headers: sessionHeaders(token) },
    );
  },

  async history(userId: string, limit = 20, token?: string | null) {
    return request<{ history: GameHistoryEntry[] }>(
      `/api/history/${encodeURIComponent(userId)}?limit=${limit}`,
      { headers: sessionHeaders(token) },
    );
  },

  async favorites(userId: string, token?: string | null) {
    return request<{ favorites: FavoriteGame[] }>(`/api/favorites/${encodeURIComponent(userId)}`, {
      headers: sessionHeaders(token),
    });
  },

  async addFavorite(gameId: string, token?: string | null) {
    return request<{ favorite: FavoriteGame }>('/api/favorites', {
      method: 'POST',
      body: JSON.stringify({ gameId }),
      headers: sessionHeaders(token),
    });
  },

  async removeFavorite(gameId: string, token?: string | null) {
    return request<null>(`/api/favorites/${encodeURIComponent(gameId)}`, {
      method: 'DELETE',
      headers: sessionHeaders(token),
    });
  },
};

export type { ApiError };
