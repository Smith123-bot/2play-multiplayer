import { RECONNECT_GRACE_MS } from '@2play/shared';
import type { Platform } from '../core/Platform';
import type { Room } from '../rooms/Room';
import type { ServerPlayer } from '../rooms/ServerPlayer';
import { AppError } from '../utils/errors';
import { createLogger } from '../utils/logger';

export interface ReconnectInput {
  roomId: string;
  sessionToken: string;
  socketId: string;
}

/**
 * ReconnectionManager — 120 second grace period.
 *
 * On disconnect the player is *kept* in the room (seat, score and chat intact)
 * until the grace deadline. On reconnect the session token is validated and the
 * player is restored; on expiry the player is removed and the match safely ends
 * if the minimum player count is no longer met (spec §19).
 */
export class ReconnectionManager {
  private readonly logger = createLogger('ReconnectionManager');

  constructor(private readonly platform: Platform) {}

  get graceMs(): number {
    return this.platform.config.reconnectGraceMs || RECONNECT_GRACE_MS;
  }

  /** Socket dropped: keep the seat, start the grace countdown. */
  handleDisconnect(room: Room, player: ServerPlayer): void {
    if (player.isAI) return;
    if (!player.isConnected) return; // Duplicate disconnect handling is a no-op.

    const deadline = Date.now() + this.graceMs;
    player.markDisconnected(deadline);
    room.bumpVersion();

    this.platform.timerManager.create({
      roomId: room.id,
      type: 'reconnect',
      delayMs: this.graceMs,
      key: `player:${player.id}`,
      label: `reconnect:${player.id}`,
      onComplete: () => this.expire(room, player.id),
    });

    // Let the game decide how to continue (skip turns, ignore, etc.).
    this.platform.gameManager.playerLeft(room, player.id, 'disconnect');

    this.platform.eventBus.emit('player:disconnected', { room, player, reconnectDeadline: deadline });
    this.platform.socketManager?.emitToRoom(room.id, 'player:disconnected', {
      roomId: room.id,
      playerId: player.id,
      nickname: player.nickname,
      reconnectDeadline: deadline,
      graceMs: this.graceMs,
    });

    if (room.activeHumans.length === 0) {
      // Nobody can continue: mark the room as empty so the sweep reclaims it.
      room.emptyAt = Date.now();
    }

    this.platform.socketManager?.broadcastRoomState(room);
    this.logger.info('player disconnected — grace started', {
      roomId: room.id,
      playerId: player.id,
      graceMs: this.graceMs,
    });
  }

  /** Explicit reconnection attempt from a client (refresh, network switch...). */
  attemptReconnect(input: ReconnectInput): { room: Room; player: ServerPlayer; restored: boolean } {
    const room = this.platform.roomStore.get(input.roomId);
    if (!room || room.status === 'CLOSED') {
      throw AppError.roomNotFound('This room no longer exists.');
    }

    const player = room.getPlayerBySession(input.sessionToken);
    if (!player) {
      throw AppError.unauthorized('You are not a member of this room.');
    }

    const isDuplicate = player.isConnected && player.socketId === input.socketId;
    if (isDuplicate) {
      // Same socket asking twice: idempotent success.
      return { room, player, restored: false };
    }

    const deadline = player.reconnectDeadline;
    if (deadline !== null && Date.now() > deadline) {
      throw AppError.connectionFailed('The reconnection window has expired.');
    }

    this.platform.timerManager.cancelByKey(room.id, 'reconnect', `player:${player.id}`);
    player.markConnected(input.socketId);
    room.emptyAt = null;
    room.bumpVersion();

    this.platform.connectionManager.setRoom(input.sessionToken, room.id);
    this.platform.eventBus.emit('player:reconnected', { room, player });
    this.platform.socketManager?.emitToRoom(room.id, 'player:reconnected', {
      roomId: room.id,
      playerId: player.id,
      nickname: player.nickname,
    });
    this.platform.socketManager?.broadcastRoomState(room);

    this.logger.info('player reconnected', { roomId: room.id, playerId: player.id });
    return { room, player, restored: true };
  }

  /** Grace period expired: the player officially leaves. */
  expire(room: Room, playerId: string): void {
    const player = room.getPlayer(playerId);
    if (!player || player.isConnected) return;
    if (room.status === 'CLOSED') return;

    this.logger.info('reconnection grace expired', { roomId: room.id, playerId });
    this.platform.roomManager.leaveRoom(room, playerId, 'timeout');
  }

  remainingMs(room: Room, playerId: string): number | null {
    return this.platform.timerManager.getRemainingByKey(room.id, 'reconnect', `player:${playerId}`);
  }

  /** Number of players currently inside their reconnection window. */
  pendingCount(room: Room): number {
    return room.humanPlayers.filter((player) => !player.isConnected).length;
  }
}
