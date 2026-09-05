import { create } from 'zustand';

export interface UiState {
  nicknamePromptOpen: boolean;
  pendingAction: (() => void) | null;
  openNicknamePrompt: (action?: () => void) => void;
  closeNicknamePrompt: () => void;
  resolvePending: () => void;
}

/**
 * Global UI state for the "pick a nickname" gate.
 *
 * The platform needs a 3–20 character nickname before any multiplayer action;
 * instead of duplicating that flow in every screen, screens call
 * `openNicknamePrompt(callback)`.
 */
export const useUiStore = create<UiState>((set, get) => ({
  nicknamePromptOpen: false,
  pendingAction: null,
  openNicknamePrompt: (action) => set({ nicknamePromptOpen: true, pendingAction: action ?? null }),
  closeNicknamePrompt: () => set({ nicknamePromptOpen: false, pendingAction: null }),
  resolvePending: () => {
    const action = get().pendingAction;
    set({ nicknamePromptOpen: false, pendingAction: null });
    action?.();
  },
}));
