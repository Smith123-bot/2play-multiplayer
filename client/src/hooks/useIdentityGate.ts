import { useCallback } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { useUiStore } from '../stores/uiStore';
import { authenticateSession } from '../multiplayer/session';

/**
 * Runs an action only once a nickname + session exist.
 * Opens the global nickname prompt when needed.
 */
export function useIdentityGate() {
  const openNicknamePrompt = useUiStore((store) => store.openNicknamePrompt);

  return useCallback(
    (action?: () => void | Promise<void>) => {
      const state = useSessionStore.getState();
      const nickname = state.nickname.trim();

      if (nickname.length < 3) {
        openNicknamePrompt(action ?? undefined);
        return;
      }

      if (state.session) {
        void action?.();
        return;
      }

      openNicknamePrompt(action ?? undefined);
      // The prompt authenticates on submit; if a session already exists we can
      // also authenticate silently here.
      void authenticateSession(nickname, state.avatar).then((session) => {
        if (session) void action?.();
      });
    },
    [openNicknamePrompt],
  );
}

export default useIdentityGate;
