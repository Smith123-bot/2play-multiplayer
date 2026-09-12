import type { Socket } from 'socket.io';
import type {
  AckResponse,
  ApiError,
  ClientToServerEvents,
  ServerToClientEvents,
} from '@2play/shared';
import type { Platform } from '../../core/Platform';
import { isAppError, toApiError } from '../../utils/errors';
import { createLogger } from '../../utils/logger';
import type { Session } from '../../managers/ConnectionManager';
import type { Room } from '../../rooms/Room';
import type { ServerPlayer } from '../../rooms/ServerPlayer';
import { AppError } from '../../utils/errors';

export interface SocketData {
  sessionToken?: string;
  clientKey: string;
  connectedAt: number;
}

/** Server-side socket typed with the shared protocol. */
export type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

const logger = createLogger('SocketHandlers');
const SOCKET_EVENTS_PER_SECOND = 120;

export interface HandlerContext {
  platform: Platform;
  socket: GameSocket;
}

/**
 * Wraps a handler so that:
 *  - every thrown error becomes a typed `AckResponse` (never a stack trace),
 *  - the client also receives an `error` event for UI feedback,
 *  - rate-limit / validation failures are logged at debug level only.
 */
export function safeHandler<TPayload, TResult>(
  handler: (
    payload: TPayload,
    ack?: (response: AckResponse<TResult>) => void,
  ) => TResult | Promise<TResult>,
) {
  return async function wrapped(
    this: HandlerContext,
    payload: TPayload,
    ack?: (response: AckResponse<TResult>) => void,
  ): Promise<void> {
    try {
      const eventLimit = this.platform.rateLimiter.consume(
        `socket-event:${this.socket.id}`,
        SOCKET_EVENTS_PER_SECOND,
        1_000,
      );
      if (!eventLimit.allowed) throw AppError.rateLimited('Too many socket events. Slow down.');
      const result = await handler.call(this, payload, ack);
      ack?.({ ok: true, ...(result !== undefined ? { data: result as TResult } : {}) });
    } catch (error) {
      const apiError: ApiError = toApiError(error);
      if (!isAppError(error) || error.code === 'E010') {
        logger.error('socket handler failed', {
          message: error instanceof Error ? error.message : String(error),
          code: apiError.code,
        });
      } else {
        logger.debug('socket handler rejected', {
          code: apiError.code,
          message: apiError.message,
        });
      }
      if (ack) ack({ ok: false, error: apiError });
      else this.socket.emit('error', { error: apiError });
    }
  };
}

export function requireSession(context: HandlerContext): Session {
  const token = context.socket.data.sessionToken as string | undefined;
  if (!token) throw AppError.unauthorized('Authenticate before doing that.');
  const session = context.platform.connectionManager.getSessionByToken(token);
  if (!session) throw AppError.unauthorized('Your session expired. Please reconnect.');
  // A bearer token is bound to exactly one live socket. Authentication on a
  // newer socket invalidates stale tabs before they can act as the player.
  if (
    session.socketId !== context.socket.id ||
    context.platform.connectionManager.getSessionBySocket(context.socket.id)?.token !== token
  ) {
    throw AppError.unauthorized('This connection is no longer the active session.');
  }
  return session;
}

/** Resolves the room a socket currently belongs to, and the player inside it. */
export function requireRoomAndPlayer(context: HandlerContext): {
  room: Room;
  player: ServerPlayer;
  session: Session;
} {
  const session = requireSession(context);
  const roomId = session.roomId;
  if (!roomId) throw AppError.roomNotFound('You are not in a room.');
  const room = context.platform.roomStore.get(roomId);
  if (!room || room.status === 'CLOSED') throw AppError.roomNotFound('This room no longer exists.');
  const player = room.getPlayerBySession(session.token);
  if (!player) throw AppError.unauthorized('You are not a member of this room.');
  return { room, player, session };
}

export function joinSocketRoom(context: HandlerContext, roomId: string): void {
  void context.socket.join(roomId);
}
