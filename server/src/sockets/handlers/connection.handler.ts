import type { AckResponse, AuthSuccessPayload, RoomState } from '@2play/shared';
import { authenticateSchema, reconnectSchema } from '@2play/shared';
import { AppError, toApiError } from '../../utils/errors';
import { parseOrThrow } from '../../utils/validate';
import { joinSocketRoom, requireSession, safeHandler, type HandlerContext } from './context';

/** `authenticate` — mints or restores a session. */
const authenticate = safeHandler<unknown, AuthSuccessPayload>(async function (
  this: HandlerContext,
  payload,
) {
  const input = parseOrThrow(authenticateSchema, payload, 'authenticate payload');
  const clientKey = this.socket.data.clientKey ?? this.socket.id;

  const previousSocketId = input.sessionToken
    ? this.platform.connectionManager.getSessionByToken(input.sessionToken)?.socketId
    : null;

  const { session, restored } = await this.platform.connectionManager.authenticate({
    nickname: input.nickname,
    ...(input.avatar ? { avatar: input.avatar } : {}),
    ...(input.sessionToken ? { sessionToken: input.sessionToken } : {}),
    socketId: this.socket.id,
    clientKey,
  });

  this.socket.data.sessionToken = session.sessionToken;
  if (previousSocketId && previousSocketId !== this.socket.id) {
    this.platform.socketManager?.disconnectSocket(
      previousSocketId,
      'Your session was opened on another connection.',
    );
  }
  this.socket.emit('auth:success', { session, restored });

  // Already in a room (e.g. page refresh or tab wake-up)? Put the socket
  // straight back in through the same reconnection path everyone else uses.
  const existingRoomId = this.platform.connectionManager.getSessionByToken(
    session.sessionToken,
  )?.roomId;
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
    const currentSession = this.platform.connectionManager.getSessionBySocket(this.socket.id);
    const reconnectSession = this.platform.connectionManager.getSessionByToken(input.sessionToken);
    if (!reconnectSession || (currentSession && currentSession.token !== input.sessionToken)) {
      throw AppError.unauthorized('Reconnect credentials do not match this session.');
    }
    const { room, player } = this.platform.reconnectionManager.attemptReconnect({
      roomId: input.roomId,
      sessionToken: input.sessionToken,
      socketId: this.socket.id,
    });
    // An explicit reconnect is also authentication: bind the proven bearer
    // credential before allowing this socket to invoke any other handler.
    this.platform.connectionManager.bindSocket(input.sessionToken, this.socket.id);
    this.socket.data.sessionToken = input.sessionToken;
    joinSocketRoom(this, room.id);
    this.platform.socketManager?.broadcastRoomState(room, true);
    return {
      room: room.toState(player.id, this.platform.gameManager.getPublicState(room, player.id)),
      playerId: player.id,
    };
  },
);

/** `heartbeat` — keeps the session fresh during idle periods. */
const heartbeat = safeHandler<unknown, { serverTime: number }>(async function (
  this: HandlerContext,
) {
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
