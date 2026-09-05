import type {
  ReadyPayload,
  RoomSettingsPayload,
  SelectGamePayload,
} from '@2play/shared';
import { readySchema, roomSettingsSchema, selectGameSchema } from '@2play/shared';
import { parseOrThrow } from '../../utils/validate';
import { requireRoomAndPlayer, safeHandler, type HandlerContext } from './context';

/** `lobby:ready` — toggle readiness. */
const ready = safeHandler<ReadyPayload, { isReady: boolean }>(async function (
  this: HandlerContext,
  payload,
) {
  const input = parseOrThrow(readySchema, payload, 'ready payload');
  const { room, player } = requireRoomAndPlayer(this);
  const isReady = this.platform.lobbyManager.setReady(room, player.id, input.isReady);
  this.platform.socketManager?.emitToRoom(room.id, 'lobby:player-ready', {
    roomId: room.id,
    playerId: player.id,
    isReady,
    allReady: this.platform.lobbyManager.canStart(room),
  });
  this.platform.socketManager?.broadcastRoomState(room);
  return { isReady };
});

/** `lobby:select-game` — host switches the game (lobby only). */
const selectGame = safeHandler<SelectGamePayload, { gameId: string }>(async function (
  this: HandlerContext,
  payload,
) {
  const input = parseOrThrow(selectGameSchema, payload, 'select game payload');
  const { room, player } = requireRoomAndPlayer(this);
  this.platform.lobbyManager.selectGame(room, player.id, input.gameId);
  this.platform.socketManager?.broadcastRoomState(room, true);
  return { gameId: input.gameId };
});

/** `lobby:settings` — host adjusts player count / AI / grid / rounds. */
const settings = safeHandler<RoomSettingsPayload, RoomSettingsPayload>(async function (
  this: HandlerContext,
  payload,
) {
  const input = parseOrThrow(roomSettingsSchema, payload ?? {}, 'settings payload');
  const { room, player } = requireRoomAndPlayer(this);
  const updated = this.platform.lobbyManager.updateSettings(room, player.id, input);
  this.platform.socketManager?.broadcastRoomState(room, true);
  return updated;
});

export function registerLobbyHandlers(context: HandlerContext): void {
  context.socket.on('lobby:ready', ready.bind(context));
  context.socket.on('lobby:select-game', selectGame.bind(context));
  context.socket.on('lobby:settings', settings.bind(context));
}
