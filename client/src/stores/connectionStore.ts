import { create } from 'zustand';
import type { ConnectionState } from '@2play/shared';

export interface ConnectionStoreState {
  state: ConnectionState;
  message: string | null;
  serverTimeOffsetMs: number;
  lastConnectedAt: number | null;
  reconnectDeadline: number | null;
  /** True while the UI blocks interaction because the connection is gone. */
  setState: (state: ConnectionState, message?: string | null) => void;
  setReconnectDeadline: (deadline: number | null) => void;
  setServerTime: (serverTime: number) => void;
  serverNow: () => number;
}

export const useConnectionStore = create<ConnectionStoreState>((set, get) => ({
  state: 'DISCONNECTED',
  message: null,
  serverTimeOffsetMs: 0,
  lastConnectedAt: null,
  reconnectDeadline: null,

  setState: (state, message = null) =>
    set({
      state,
      message,
      ...(state === 'CONNECTED' ? { lastConnectedAt: Date.now(), reconnectDeadline: null } : {}),
    }),

  setReconnectDeadline: (reconnectDeadline) => set({ reconnectDeadline }),

  setServerTime: (serverTime) => set({ serverTimeOffsetMs: serverTime - Date.now() }),

  serverNow: () => Date.now() + get().serverTimeOffsetMs,
}));
