import type { GameAction } from '@2play/shared';
import { ACTION_RATE_LIMIT_PER_SEC } from '@2play/shared';
import type { Platform } from '../core/Platform';
import type { ActionResult } from '../games/GameModule';
import type { Room } from '../rooms/Room';
import { AppError } from '../utils/errors';
import { createLogger } from '../utils/logger';

/**
 * MultiplayerManager — the untrusted client's only door into a running game.
 *
 * Pipeline: rate limit → membership → connection → status → game validation →
 * module → broadcast (spec §14). Clients can never claim a winner, a score or a
 * timer value.
 */
export class MultiplayerManager {
  private readonly logger = createLogger('MultiplayerManager');

  constructor(private readonly platform: Platform) {}

  submitAction(room: Room, playerId: string, action: GameAction): ActionResult {
    const player = room.getPlayer(playerId);
    if (!player) throw AppError.unauthorized('You are not in this room.');
    if (player.isAI) throw AppError.invalidAction('AI players act on their own.');
    if (!player.isConnected) throw AppError.connectionFailed('You are currently disconnected.');

    if (room.status !== 'PLAYING') {
      throw AppError.invalidAction('The match is not running.');
    }

    const limit = this.platform.rateLimiter.consume(
      `action:${room.id}:${playerId}`,
      ACTION_RATE_LIMIT_PER_SEC,
      1000,
    );
    if (!limit.allowed) {
      throw AppError.rateLimited('You are acting too fast.');
    }

    const result = this.platform.gameManager.handleAction(room, playerId, action);

    if (result.accepted) {
      // Broadcast only non-sensitive action metadata. The canonical per-viewer
      // state carries the gameplay result; raw choices, guesses and coordinates
      // can contain hidden information and needlessly inflate every action.
      this.platform.socketManager?.emitToRoom(room.id, 'game:player-action', {
        roomId: room.id,
        playerId,
        action: { type: action.type },
        accepted: true,
      });

      // Give the acting player their authoritative snapshot immediately instead
      // of making them wait out the broadcast throttle for the consequence of
      // their own move. Opponents still receive the coalesced room broadcast.
      if (result.stateChanged) {
        this.platform.socketManager?.deliverRoomStateToPlayer(room, playerId);
      }
    }

    if (!result.accepted) {
      this.platform.socketManager?.emitToPlayer(room, playerId, 'game:error', {
        roomId: room.id,
        error: {
          code: 'E006',
          name: 'INVALID_ACTION',
          message: result.reason ?? 'That action is not allowed.',
        },
      });
    }

    return result;
  }

  startGame(room: Room, playerId: string): void {
    if (room.hostPlayerId !== playerId) {
      throw AppError.unauthorized('Only the host can start the match.');
    }
    if (!this.platform.lobbyManager.canStart(room)) {
      throw AppError.invalidAction(
        this.platform.lobbyManager.startBlockedReason(room) ?? 'The room is not ready.',
      );
    }
    this.platform.lifecycleManager.startCountdown(room);
  }

  /** Host-driven abort: returns everyone to the lobby. */
  leaveMatch(room: Room, playerId: string): void {
    const player = room.getPlayer(playerId);
    if (!player) throw AppError.unauthorized('You are not in this room.');

    if (room.status === 'PLAYING' || room.status === 'COUNTDOWN' || room.status === 'PAUSED') {
      this.platform.lifecycleManager.abandonMatch(room, 'forfeit');
    }
  }
}
