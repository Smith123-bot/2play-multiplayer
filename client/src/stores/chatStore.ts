import { create } from 'zustand';
import type { ChatMessage } from '@2play/shared';

export interface ChatStoreState {
  /** Optimistic messages that are not yet confirmed by the server snapshot. */
  pending: ChatMessage[];
  mutedUntil: number | null;
  draft: string;
  addPending: (message: ChatMessage) => void;
  clearPending: () => void;
  setMutedUntil: (value: number | null) => void;
  setDraft: (value: string) => void;
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  pending: [],
  mutedUntil: null,
  draft: '',
  addPending: (message) => set({ pending: [...get().pending.slice(-20), message] }),
  clearPending: () => set({ pending: [] }),
  setMutedUntil: (mutedUntil) => set({ mutedUntil }),
  setDraft: (draft) => set({ draft }),
}));
