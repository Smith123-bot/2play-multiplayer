import { APP_NAME, APP_TAGLINE, APP_VERSION } from '@2play/shared';

/**
 * Runtime configuration.
 *
 * Security: only Vite `VITE_*` variables are ever exposed to the browser, and
 * none of them contain secrets. Supabase credentials (service role key, db url)
 * live on the server exclusively.
 */
const rawApi = (import.meta.env.VITE_API_URL ?? '').trim();
const rawSocket = (import.meta.env.VITE_SOCKET_URL ?? '').trim();

/** Empty => same origin (works behind the Vite proxy and in production). */
export const API_BASE_URL = rawApi.length > 0 ? rawApi.replace(/\/$/, '') : '';
export const SOCKET_URL = rawSocket.length > 0 ? rawSocket.replace(/\/$/, '') : undefined;

export const APP_CONFIG = {
  name: (import.meta.env.VITE_APP_NAME as string) || APP_NAME,
  version: (import.meta.env.VITE_APP_VERSION as string) || APP_VERSION,
  tagline: APP_TAGLINE,
} as const;

export const STORAGE_KEYS = {
  session: '2play.session',
  settings: '2play.settings',
  nickname: '2play.nickname',
  avatar: '2play.avatar',
  recentRooms: '2play.recentRooms',
  recentlyPlayed: '2play.recentlyPlayed',
} as const;

export function apiUrl(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${clean}`;
}
