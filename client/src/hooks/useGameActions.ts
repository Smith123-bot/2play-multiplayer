import { useCallback } from 'react';
import toast from 'react-hot-toast';
import type { GameAction } from '@2play/shared';
import { CLIENT_EVENTS } from '@2play/shared';
import { socketClient } from '../multiplayer/socketClient';
import { hapticsManager } from '../haptics/HapticsManager';
import { getLocalPlayerId } from '../stores/roomStore';

/**
 * Sends player intents to the server. The client never decides scores, winners
 * or timers — it only reports what the player did.
 */
export function useGameActions() {
  const sendAction = useCallback(async (action: GameAction, options: { silent?: boolean } = {}) => {
    const response = await socketClient.emitAck<{ accepted: boolean }>(CLIENT_EVENTS.GAME_ACTION, {
      action,
    });
    if (!response.ok) {
      if (!options.silent) toast.error(response.error?.message ?? 'That action was rejected.');
      hapticsManager.trigger('error');
      return false;
    }
    if (!response.data?.accepted && !options.silent) {
      hapticsManager.trigger('error');
    }
    return response.data?.accepted ?? false;
  }, []);

  const sendActionForPlayer = useCallback(
    async (playerId: string, action: GameAction) => {
      if (playerId !== getLocalPlayerId()) return false;
      return sendAction(action);
    },
    [sendAction],
  );

  return { sendAction, sendActionForPlayer };
}
