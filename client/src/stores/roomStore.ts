import { create } from 'zustand';
import type { ChatMessage, GameResult, Player, RoomState } from '@2play/shared';

export interface RoomStoreState {
  room: RoomState | null;
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

  setRoom: (room) => set({ room, kicked: false, roomClosedReason: null }),

  updateRoom: (room) => {
    const current = get().room;
    // Ignore stale snapshots (out-of-order delivery).
    if (current && room.stateVersion < current.stateVersion && room.id === current.id) return;
    set({ room });
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
export function selectPlayers(room: RoomState | null): Player[] {
  return room?.players ?? [];
}

export function selectChat(room: RoomState | null): ChatMessage[] {
  return room?.chat ?? [];
}
