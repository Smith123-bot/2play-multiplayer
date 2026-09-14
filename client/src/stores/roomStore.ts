import { create } from 'zustand';
import type { ChatMessage, GameResult, Player, RoomState } from '@2play/shared';

/**
 * A room snapshot as the client keeps it: identical to the wire format, but
 * with the chat transcript always materialised.
 *
 * The server omits `chat` from `room:updated` when the transcript has not
 * changed for this viewer (it measured at ~83% of every snapshot payload).
 * `normalizeRoom` carries the previous array over — keeping the SAME array
 * reference, which also lets memoized chat components skip re-rendering on
 * gameplay-only snapshots.
 */
export type LiveRoomState = RoomState & { chat: ChatMessage[] };

export function normalizeRoom(next: RoomState, previous: LiveRoomState | null): LiveRoomState {
  if (next.chat !== undefined || !previous || previous.id !== next.id) {
    return { ...next, chat: next.chat ?? [] };
  }
  return { ...next, chat: previous.chat };
}

export interface RoomStoreState {
  room: LiveRoomState | null;
  /** Snapshot of the last finished match (survives the return to the lobby). */
  lastResult: GameResult | null;
  kicked: boolean;
  roomClosedReason: string | null;
  setRoom: (room: RoomState) => void;
  updateRoom: (room: RoomState) => void;
  setLastResult: (result: GameResult | null) => void;
  setKicked: (value: boolean) => void;
  setRoomClosed: (reason: string | null) => void;
  clearRoom: () => void;
  me: () => Player | null;
}

/** Player id of the local user (set once the session is known). */
let localPlayerId: string | null = null;

export function setLocalPlayerId(playerId: string | null): void {
  localPlayerId = playerId;
}

export function getLocalPlayerId(): string | null {
  return localPlayerId;
}

export const useRoomStore = create<RoomStoreState>((set, get) => ({
  room: null,
  lastResult: null,
  kicked: false,
  roomClosedReason: null,

  setRoom: (room) => set({ room: normalizeRoom(room, null), kicked: false, roomClosedReason: null }),

  updateRoom: (incoming) => {
    const current = get().room;
    // Ignore stale snapshots (out-of-order delivery).
    if (current && incoming.stateVersion < current.stateVersion && incoming.id === current.id) return;
    set({ room: normalizeRoom(incoming, current) });
  },

  setLastResult: (lastResult) => set({ lastResult }),
  setKicked: (kicked) => set({ kicked }),
  setRoomClosed: (roomClosedReason) => set({ roomClosedReason }),

  clearRoom: () => set({ room: null, kicked: false, roomClosedReason: null }),

  me: () => {
    const room = get().room;
    if (!room || !localPlayerId) return null;
    return room.players.find((player) => player.id === localPlayerId) ?? null;
  },
}));

/** Convenience selector helpers (kept outside the store to avoid re-renders). */
export function selectPlayers(room: LiveRoomState | null): Player[] {
  return room?.players ?? [];
}

export function selectChat(room: LiveRoomState | null): ChatMessage[] {
  return room?.chat ?? [];
}
