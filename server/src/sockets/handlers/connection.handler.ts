import { AUTH_RATE_LIMIT_PER_MIN } from '@2play/shared';
import type { AckResponse, AuthSuccessPayload, RoomState } from '@2play/shared';
import {
  authenticateSchema,
  reconnectSchema,
} from '@2play/shared';
import { AppError, toApiError } from '../../utils/errors';
import { parseOrThrow } from '../../utils/validate';
import { joinSocketRoom, requireSession, safeHandler, type HandlerContext } from './context';

/** `authenticate` — mints or restores a session. */
const authenticate = safeHandler<
  unknown,
  AuthSuccessPayload
>(async function (this: HandlerContext, payload) {
  const input = parseOrThrow(authenticateSchema, payload, 'authenticate payload');
  const clientKey = this.socket.data.clientKey ?? this.socket.id;

  const limit = this.platform.rateLimiter.consume(`auth:${clientKey}`, AUTH_RATE_LIMIT_PER_MIN, 60_000);
  if (!limit.allowed) {
    throw AppError.rateLimited('Too many connection attempts. Please wait a moment.');
  }

  const { session, restored } = await this.platform.connectionManager.authenticate({
    nickname: input.nickname,
    ...(input.avatar ? { avatar: input.avatar } : {}),
    ...(input.sessionToken ? { sessionToken: input.sessionToken } : {}),
    socketId: this.socket.id,
    clientKey,
  });

  this.socket.data.sessionToken = session.sessionToken;
  this.socket.emit('auth:success', { session, restored });

  // Already in a room (e.g. page refresh or tab wake-up)? Put the socket
  // straight back in through the same reconnection path everyone else uses.
  const existingRoomId = this.platform.connectionManager.getSessionByToken(session.sessionToken)?.roomId;
  if (existingRoomId) {
    const room = this.platform.roomStore.get(existingRoomId);
    const player = room?.getPlayerBySession(session.sessionToken);
    if (room && player) {
      if (player.isConnected) {
        player.markConnected(this.socket.id);
        joinSocketRoom(this, room.id);
        this.platform.socketManager?.broadcastRoomState(room, true);
      } else {
        try {
          this.platform.reconnectionManager.attemptReconnect({
            roomId: room.id,
            sessionToken: session.sessionToken,
            socketId: this.socket.id,
          });
          joinSocketRoom(this, room.id);
          this.platform.socketManager?.broadcastRoomState(room, true);
        } catch (error) {
          // Grace expired / room gone: nothing to restore, the client is informed
          // by the standard room errors when it acts next.
          this.platform.socketManager?.emitToSocket(this.socket.id, 'room:error', {
            roomId: room.id,
            error: toApiError(error),
          });
        }
      }
    }
  }

  return { session, restored };
});

/** `reconnect:attempt` — restores a seat after a network drop. */
const reconnectAttempt = safeHandler<unknown, { room: RoomState; playerId: string }>(
  async function (this: HandlerContext, payload) {
  const input = parseOrThrow(reconnectSchema, payload, 'reconnect payload');
  // A socket that already authenticated cannot switch identities by submitting
  // another player's bearer token. A fresh refresh socket may still present
  // its valid token through this event before the authenticate event runs.
  const boundToken = this.socket.data.sessionToken;
  if (boundToken && boundToken !== input.sessionToken) {
    throw AppError.unauthorized('The reconnect identity does not match this session.');
  }
  const { room, player } = this.platform.reconnectionManager.attemptReconnect({
    roomId: input.roomId,
    sessionToken: input.sessionToken,
    socketId: this.socket.id,
  });
  joinSocketRoom(this, room.id);
  this.platform.socketManager?.broadcastRoomState(room, true);
    return {
      room: room.toState(player.id, this.platform.gameManager.getPublicState(room, player.id)),
      playerId: player.id,
    };
  },
);

/** `heartbeat` — keeps the session fresh during idle periods. */
const heartbeat = safeHandler<unknown, { serverTime: number }>(async function (this: HandlerContext) {
  requireSession(this);
  this.platform.connectionManager.touch(this.socket.id);
  return { serverTime: Date.now() };
});

export function registerConnectionHandlers(context: HandlerContext): void {
  context.socket.on('authenticate', authenticate.bind(context));
  context.socket.on('reconnect:attempt', reconnectAttempt.bind(context));
  context.socket.on('heartbeat', heartbeat.bind(context));
}

export type { AckResponse };
