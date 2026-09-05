import type { GameActionPayload } from '@2play/shared';
import { gameActionPayloadSchema } from '@2play/shared';
import { parseOrThrow } from '../../utils/validate';
import { requireRoomAndPlayer, safeHandler, type HandlerContext } from './context';

/** `game:start` — host starts the countdown (server validates readiness). */
const start = safeHandler<Record<string, never>, { started: boolean }>(async function (
  this: HandlerContext,
) {
  const { room, player } = requireRoomAndPlayer(this);
  this.platform.multiplayerManager.startGame(room, player.id);
  return { started: true };
});

/** `game:action` — the only way clients interact with a running game. */
const action = safeHandler<GameActionPayload, { accepted: boolean }>(async function (
  this: HandlerContext,
  payload,
) {
  const input = parseOrThrow(gameActionPayloadSchema, payload, 'game action payload');
  const { room, player } = requireRoomAndPlayer(this);
  const result = this.platform.multiplayerManager.submitAction(room, player.id, input.action);
  return { accepted: result.accepted };
});

/** `game:leave` — abandon the running match and return to the lobby. */
const leaveGame = safeHandler<Record<string, never>, { left: boolean }>(async function (
  this: HandlerContext,
) {
  const { room, player } = requireRoomAndPlayer(this);
  this.platform.multiplayerManager.leaveMatch(room, player.id);
  this.platform.socketManager?.broadcastRoomState(room, true);
  return { left: true };
});

export function registerGameHandlers(context: HandlerContext): void {
  context.socket.on('game:start', start.bind(context));
  context.socket.on('game:action', action.bind(context));
  context.socket.on('game:leave', leaveGame.bind(context));
}
