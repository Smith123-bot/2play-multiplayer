import type { GameFinishReason } from '@2play/shared';
import {
  COUNTDOWN_SECONDS,
  GAME_TICK_MS,
  ROOM_CLEANUP_INTERVAL_MS,
} from '@2play/shared';
import type { Platform } from '../core/Platform';
import type { Room } from '../rooms/Room';
import { AppError } from '../utils/errors';
import { createLogger } from '../utils/logger';

const DEFAULT_MAX_MATCH_MS = 15 * 60 * 1000;

/**
 * GameLifecycleManager — the single authority for room/match state transitions.
 *
 * WAITING → LOBBY → READY → COUNTDOWN → PLAYING → GAME_FINISHED → RESULT →
 * REMATCH_WAITING → NEW_MATCH → COUNTDOWN → PLAYING
 *
 * Critical rules enforced here:
 *  - finishing a match never disconnects sockets, never destroys the room and
 *    never clears chat (spec §17/§66);
 *  - every timer used by the lifecycle is created through TimerManager;
 *  - transitions are validated and idempotent (no double countdowns).
 */
export class GameLifecycleManager {
  private readonly logger = createLogger('GameLifecycleManager');

  constructor(private readonly platform: Platform) {}

  /** Starts the platform housekeeping timer (room sweep). */
  startMaintenance(): void {
    this.platform.timerManager.create({
      roomId: 'system',
      type: 'gameDuration',
      delayMs: ROOM_CLEANUP_INTERVAL_MS,
      intervalMs: ROOM_CLEANUP_INTERVAL_MS,
      key: 'room-sweep',
      label: 'system:room-sweep',
      onComplete: undefined,
      onTick: () => {
        try {
          this.platform.roomManager.sweep();
        } catch (error) {
          this.logger.error('room sweep failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    });
    this.logger.debug('maintenance timer started');
  }

  private transition(room: Room, to: Room['status']): void {
    if (room.status === to) return;
    if (!room.canTransition(to)) {
      throw AppError.invalidAction(`Cannot change room from ${room.status} to ${to}.`);
    }
    room.setStatus(to);
  }

  /* ---------------------------------------------------------------- */
  /* Countdown                                                         */
  /* ---------------------------------------------------------------- */

  startCountdown(room: Room): void {
    if (!['LOBBY', 'READY', 'NEW_MATCH', 'WAITING'].includes(room.status)) {
      throw AppError.invalidAction('A countdown cannot start right now.');
    }
    if (this.platform.timerManager.has(room.id, 'countdown', 'start')) {
      throw AppError.invalidAction('A countdown is already running.');
    }

    // Fresh state for a fresh match (players/chat/room all preserved).
    this.platform.gameManager.createState(room);
    for (const player of room.players.values()) player.resetForNewMatch();
    room.gameResult = null;
    room.clearRematchVotes();

    this.transition(room, 'COUNTDOWN');
    room.countdownValue = COUNTDOWN_SECONDS;

    const durationMs = (COUNTDOWN_SECONDS + 1) * 1000;
    this.platform.timerManager.create({
      roomId: room.id,
      type: 'countdown',
      delayMs: 1000,
      intervalMs: 1000,
      durationMs,
      key: 'start',
      label: 'match-countdown',
      onTick: ({ remainingMs }) => {
        const value = Math.max(1, Math.ceil(remainingMs / 1000) - 1);
        room.countdownValue = value;
        this.platform.socketManager?.emitToRoom(room.id, 'game:countdown', {
          roomId: room.id,
          value,
          secondsRemaining: Math.max(0, Math.ceil(remainingMs / 1000)),
        });
      },
      onComplete: ({ cancelled }) => {
        if (cancelled || room.status !== 'COUNTDOWN') return;
        // The "GO" moment.
        room.countdownValue = 0;
        this.platform.socketManager?.emitToRoom(room.id, 'game:countdown', {
          roomId: room.id,
          value: 0,
          secondsRemaining: 0,
        });
        this.startMatch(room);
      },
    });

    this.platform.socketManager?.broadcastRoomState(room);
    this.logger.info('countdown started', { roomId: room.id, matchNumber: room.matchNumber });
  }

  /* ---------------------------------------------------------------- */
  /* Playing                                                           */
  /* ---------------------------------------------------------------- */

  startMatch(room: Room): void {
    if (room.status === 'PLAYING') return;
    this.transition(room, 'PLAYING');
    room.gameStartedAt = Date.now();
    room.countdownValue = 0;

    const game = this.platform.registry.get(room.gameId);
    this.platform.gameManager.start(room);

    this.platform.socketManager?.emitToRoom(room.id, 'game:started', {
      roomId: room.id,
      gameId: room.gameId,
      matchNumber: room.matchNumber,
      startedAt: room.gameStartedAt,
      config: this.platform.gameManager.buildConfig(room),
    });
    this.platform.eventBus.emit('game:started', { room });

    if (game.needsUpdateLoop) {
      this.platform.timerManager.create({
        roomId: room.id,
        type: 'turn',
        delayMs: GAME_TICK_MS,
        intervalMs: GAME_TICK_MS,
        key: 'update-loop',
        label: 'game-update-loop',
        onTick: () => {
          if (room.status !== 'PLAYING') return;
          this.platform.gameManager.update(room, GAME_TICK_MS);
          // Forced, not throttled: the throttle exists to coalesce *bursts* of
          // player actions, and a tick is not a burst — ticks are already
          // spaced GAME_TICK_MS apart, so this cannot exceed the broadcast
          // volume the loop already produced. Without `force`, a tick landing
          // inside the throttle window of a recent action had its snapshot
          // deferred to the trailing timer, so eliminations, captures and hits
          // resolved by the simulation reached players up to a throttle window
          // late.
          this.platform.socketManager?.broadcastRoomState(room, true);
        },
      });
    }

    // Hard cap so a stuck match can never hold a room forever.
    const maxDuration = game.maxDurationMs ?? DEFAULT_MAX_MATCH_MS;
    this.platform.timerManager.create({
      roomId: room.id,
      type: 'gameDuration',
      delayMs: maxDuration,
      key: 'max-duration',
      label: 'match-max-duration',
      onComplete: () => {
        if (room.status === 'PLAYING') {
          this.logger.warn('match hit the maximum duration', { roomId: room.id });
          this.finishMatch(room, 'timeout');
        }
      },
    });

    this.platform.gameManager.requestAITurns(room);
    this.platform.socketManager?.broadcastRoomState(room);
    this.logger.info('match started', {
      roomId: room.id,
      gameId: room.gameId,
      matchNumber: room.matchNumber,
      players: room.players.size,
    });
  }

  pauseMatch(room: Room): void {
    if (room.status !== 'PLAYING') return;
    this.transition(room, 'PAUSED');
    this.platform.socketManager?.broadcastRoomState(room);
  }

  resumeMatch(room: Room): void {
    if (room.status !== 'PAUSED') return;
    this.transition(room, 'PLAYING');
    this.platform.socketManager?.broadcastRoomState(room);
  }

  /* ---------------------------------------------------------------- */
  /* Finishing                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Ends the match. Sockets stay connected, the room stays alive, chat is kept
   * and players keep their seats — this is what makes rematch work.
   */
  finishMatch(room: Room, reason: GameFinishReason): void {
    if (!['PLAYING', 'PAUSED'].includes(room.status)) return;

    // Stop every gameplay timer, but keep reconnect timers alive.
    this.platform.timerManager.cancelByType(room.id, 'turn');
    this.platform.timerManager.cancelByType(room.id, 'countdown');
    this.platform.timerManager.cancelByType(room.id, 'gameDuration');

    const result = this.platform.gameManager.buildResult(room, reason);
    room.gameResult = result;
    room.gameStartedAt = room.gameStartedAt ?? Date.now();

    for (const player of room.players.values()) {
      const ranking = result.rankings.find((entry) => entry.playerId === player.id);
      if (ranking) player.score = ranking.score;
    }

    this.transition(room, 'GAME_FINISHED');
    this.platform.eventBus.emit('game:finished', { room, result });
    this.platform.socketManager?.emitToRoom(room.id, 'game:finished', {
      roomId: room.id,
      gameId: room.gameId,
      result,
    });

    this.transition(room, 'RESULT');
    this.platform.socketManager?.broadcastRoomState(room);

    this.logger.info('match finished', {
      roomId: room.id,
      gameId: room.gameId,
      reason: result.reason,
      winners: result.winners.length,
      duration: result.durationSeconds,
    });

    // Open rematch voting (RESULT → REMATCH_WAITING).
    this.platform.rematchManager.openVoting(room);
  }

  /** Not enough players / host aborted: end early and go back to the lobby. */
  abandonMatch(room: Room, reason: GameFinishReason): void {
    if (['PLAYING', 'PAUSED', 'COUNTDOWN'].includes(room.status)) {
      this.platform.timerManager.cancelByType(room.id, 'countdown');
      if (room.gameState !== null && room.gameState !== undefined) {
        this.finishMatch(room, reason);
      } else {
        this.returnToLobby(room, 'The match was cancelled.');
      }
      return;
    }
    this.returnToLobby(room, 'The match was cancelled.');
  }

  /* ---------------------------------------------------------------- */
  /* Back to lobby                                                     */
  /* ---------------------------------------------------------------- */

  returnToLobby(room: Room, message?: string): void {
    this.platform.timerManager.cancelByType(room.id, 'turn');
    this.platform.timerManager.cancelByType(room.id, 'countdown');
    this.platform.timerManager.cancelByType(room.id, 'gameDuration');
    this.platform.timerManager.cancelByType(room.id, 'rematch');

    room.clearRematchVotes();
    room.rematchStarting = false;
    this.platform.gameManager.cleanup(room);
    room.gameResult = null;
    room.gameStartedAt = null;
    room.countdownValue = 0;
    for (const player of room.players.values()) player.resetForNewMatch();

    // RESULT/REMATCH_WAITING/PLAYING all fall back to LOBBY.
    if (['PLAYING', 'PAUSED', 'GAME_FINISHED', 'RESULT', 'REMATCH_WAITING', 'NEW_MATCH', 'COUNTDOWN'].includes(room.status)) {
      room.status = 'LOBBY';
      room.bumpVersion();
    }

    if (message) {
      this.platform.socketManager?.emitToRoom(room.id, 'notification', {
        roomId: room.id,
        level: 'info',
        title: 'Back to lobby',
        message,
      });
    }

    this.platform.socketManager?.broadcastRoomState(room);
    this.logger.info('room returned to lobby', { roomId: room.id });
  }
}
