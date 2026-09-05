import type { Platform } from '../../core/Platform';
import type { SocketManager } from '../SocketManager';
import { createLogger } from '../../utils/logger';
import type { GameSocket, HandlerContext } from './context';
import { registerChatHandlers } from './chat.handler';
import { registerConnectionHandlers } from './connection.handler';
import { registerGameHandlers } from './game.handler';
import { registerLobbyHandlers } from './lobby.handler';
import { registerRematchHandlers } from './rematch.handler';
import { registerRoomHandlers } from './room.handler';

const logger = createLogger('SocketHandlers');

/**
 * Registers the whole socket protocol for one connection.
 *
 * Every listener is registered exactly once per socket and removed when the
 * socket is gone, which — together with the socket id bookkeeping — prevents
 * duplicate handlers, ghost players and double disconnect handling (spec §68).
 */
export function registerSocketHandlers(
  platform: Platform,
  socket: GameSocket,
  socketManager: SocketManager,
): void {
  socket.data.clientKey = socket.handshake.address || socket.id;
  socket.data.connectedAt = Date.now();

  const context: HandlerContext = { platform, socket };

  registerConnectionHandlers(context);
  registerRoomHandlers(context);
  registerLobbyHandlers(context);
  registerGameHandlers(context);
  registerRematchHandlers(context);
  registerChatHandlers(context);

  socket.on('disconnect', (reason: string) => {
    try {
      handleDisconnect(platform, socket, reason);
    } catch (error) {
      logger.error('disconnect handling failed', {
        socketId: socket.id,
        reason,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  logger.debug('handlers registered', { socketId: socket.id });
  void socketManager; // keep the reference for future manager-level helpers
}

function handleDisconnect(platform: Platform, socket: GameSocket, reason: string): void {
  const session = platform.connectionManager.unbindSocket(socket.id);

  // Find the room + player *before* the player is marked disconnected.
  let room = platform.roomManager.findRoomOfSocket(socket.id);
  let player = room?.getPlayerBySocket(socket.id);

  if (!room && session?.roomId) {
    room = platform.roomStore.get(session.roomId);
    player = room?.getPlayerBySession(session.token);
  }

  if (!room || !player) {
    logger.debug('socket disconnected without an active seat', { socketId: socket.id, reason });
    return;
  }

  if (player.socketId === socket.id || !player.isConnected) {
    platform.reconnectionManager.handleDisconnect(room, player);
  }
}

export { handleDisconnect };
