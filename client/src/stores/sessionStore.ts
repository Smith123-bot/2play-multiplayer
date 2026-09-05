import { create } from 'zustand';
import type { SessionInfo } from '@2play/shared';
import { STORAGE_KEYS } from '../core/config';
import { readJson, readString, removeKey, writeJson, writeString } from '../utils/storage';

export interface StoredSession {
  userId: string;
  sessionToken: string;
  playerId: string;
  nickname: string;
  avatar: string;
}

export interface SessionState {
  session: SessionInfo | null;
  nickname: string;
  avatar: string;
  ready: boolean;
  recentlyPlayed: string[];
  recentRooms: Array<{ id: string; gameId: string; at: number }>;
  setSession: (session: SessionInfo) => void;
  clearSession: () => void;
  setIdentity: (nickname: string, avatar: string) => void;
  pushRecentlyPlayed: (gameId: string) => void;
  pushRecentRoom: (room: { id: string; gameId: string }) => void;
  getStoredSession: () => StoredSession | null;
}

function loadStored(): StoredSession | null {
  return readJson<StoredSession | null>(STORAGE_KEYS.session, null);
}

const stored = loadStored();

export const useSessionStore = create<SessionState>((set, get) => ({
  session: stored
    ? {
        userId: stored.userId,
        sessionToken: stored.sessionToken,
        playerId: stored.playerId,
        nickname: stored.nickname,
        avatar: stored.avatar,
        createdAt: Date.now(),
      }
    : null,
  nickname: stored?.nickname ?? readString(STORAGE_KEYS.nickname, ''),
  avatar: stored?.avatar ?? readString(STORAGE_KEYS.avatar, '🦊'),
  ready: false,
  recentlyPlayed: readJson<string[]>(STORAGE_KEYS.recentlyPlayed, []),
  recentRooms: readJson<Array<{ id: string; gameId: string; at: number }>>(STORAGE_KEYS.recentRooms, []),

  setSession: (session) => {
    const payload: StoredSession = {
      userId: session.userId,
      sessionToken: session.sessionToken,
      playerId: session.playerId,
      nickname: session.nickname,
      avatar: session.avatar,
    };
    writeJson(STORAGE_KEYS.session, payload);
    writeString(STORAGE_KEYS.nickname, session.nickname);
    writeString(STORAGE_KEYS.avatar, session.avatar);
    set({ session, nickname: session.nickname, avatar: session.avatar, ready: true });
  },

  clearSession: () => {
    removeKey(STORAGE_KEYS.session);
    set({ session: null, ready: false, ...({} as Partial<SessionState>) });
  },

  setIdentity: (nickname, avatar) => {
    writeString(STORAGE_KEYS.nickname, nickname);
    writeString(STORAGE_KEYS.avatar, avatar);
    const current = get().session;
    if (current) {
      const updated = { ...current, nickname, avatar };
      writeJson(STORAGE_KEYS.session, {
        userId: updated.userId,
        sessionToken: updated.sessionToken,
        playerId: updated.playerId,
        nickname,
        avatar,
      });
      set({ nickname, avatar, session: updated });
      return;
    }
    set({ nickname, avatar });
  },

  pushRecentlyPlayed: (gameId) => {
    const next = [gameId, ...get().recentlyPlayed.filter((id) => id !== gameId)].slice(0, 8);
    writeJson(STORAGE_KEYS.recentlyPlayed, next);
    set({ recentlyPlayed: next });
  },

  pushRecentRoom: (room) => {
    const next = [{ ...room, at: Date.now() }, ...get().recentRooms.filter((entry) => entry.id !== room.id)].slice(0, 8);
    writeJson(STORAGE_KEYS.recentRooms, next);
    set({ recentRooms: next });
  },

  getStoredSession: () => loadStored(),
}));
