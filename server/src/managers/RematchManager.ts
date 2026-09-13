import { REMATCH_TIMEOUT_MS } from '@2play/shared';
import type { Platform } from '../core/Platform';
import type { Room } from '../rooms/Room';
import { AppError } from '../utils/errors';
import { createLogger } from '../utils/logger';

/**
 * RematchManager — server-authoritative rematch voting.
 *
 *  - every eligible connected human must vote YES,
 *  - votes are stored per player id (`rematchReady[playerId]` semantics),
 *  - starting a rematch is idempotent (guarded by `room.rematchStarting`),
 *  - a 60s timeout returns the room to the lobby,
 *  - the room, players, sockets and chat all survive (spec §18/§67).
 */
export class RematchManager {
  private readonly logger = createLogger('RematchManager');

  constructor(private readonly platform: Platform) {}

  get timeoutMs(): number {
    return this.platform.config?.rematchTimeoutMs ?? REMATCH_TIMEOUT_MS;
  }

  /**
   * Whether another match can be played in this room.
   *
   * Mirrors `LobbyManager.canStart`: the seat count that matters includes AI
   * opponents, and at least one connected human must be present to vote.
   * Comparing the *human voter* count against the game's `minPlayers` (which
   * counts AI seats) used to send every human-vs-AI match — Quick Play included
   * — straight back to the lobby at the finish line, wiping the result before
   * the player ever saw it.
   */
  canRematch(room: Room): boolean {
    const metadata = this.platform.registry.find(room.gameId)?.metadata;
    const minPlayers = metadata?.minPlayers ?? 2;
    if (room.players.size < minPlayers) return false;
    return room.rematchVoters.length > 0;
  }

  /** RESULT → REMATCH_WAITING and start the vote window (60s by default). */
  openVoting(room: Room): void {
    if (!['RESULT', 'GAME_FINISHED', 'REMATCH_WAITING'].includes(room.status)) return;

    if (!this.canRematch(room)) {
      this.platform.lifecycleManager.returnToLobby(room, 'Not enough players for a rematch.');
      return;
    }

    room.rematchVotes.clear();
    room.rematchStarting = false;
    if (room.status !== 'REMATCH_WAITING') {
      room.status = 'REMATCH_WAITING';
      room.bumpVersion();
    }
    room.rematchDeadline = Date.now() + this.timeoutMs;

    this.platform.timerManager.create({
      roomId: room.id,
      type: 'rematch',
      delayMs: 1000,
      intervalMs: 1000,
      durationMs: this.timeoutMs,
      key: 'vote',
      label: 'rematch-vote-window',
      onTick: ({ remainingMs }) => {
        room.rematchDeadline = Date.now() + remainingMs;
        this.platform.socketManager?.emitToRoom(room.id, 'timer:tick', {
          roomId: room.id,
          timerType: 'rematch',
          remainingMs,
          value: Math.ceil(remainingMs / 1000),
        });
      },
      onComplete: () => {
        if (room.status !== 'REMATCH_WAITING') return;
        this.logger.info('rematch window expired', { roomId: room.id });
        this.platform.socketManager?.emitToRoom(room.id, 'timer:expired', {
          roomId: room.id,
          timerType: 'rematch',
        });
        this.cancel(room, undefined, 'Rematch timed out — back to the lobby.');
      },
    });

    this.refreshStatus(room);
    this.logger.debug('rematch voting opened', {
      roomId: room.id,
      voters: room.rematchVoters.length,
      seats: room.players.size,
    });
  }

  /** Broadcasts the current vote tally. */
  refreshStatus(room: Room): void {
    if (!['RESULT', 'REMATCH_WAITING'].includes(room.status)) return;
    const voters = room.rematchVoters;
    const pending = voters.filter((player) => room.rematchVotes.get(player.id) !== true);
    this.platform.socketManager?.emitToRoom(room.id, 'rematch:status', {
      roomId: room.id,
      votes: Object.fromEntries(room.rematchVotes.entries()),
      pending: pending.map((player) => player.nickname),
      expiresAt: room.rematchDeadline,
      required: voters.length,
    });
    this.platform.socketManager?.broadcastRoomState(room);
  }

  vote(room: Room, playerId: string, value = true): void {
    if (room.status !== 'REMATCH_WAITING') {
      throw AppError.invalidAction('Rematch is not open right now.');
    }
    const player = room.getPlayer(playerId);
    if (!player) throw AppError.unauthorized('You are not in this room.');
    if (player.isAI) throw AppError.invalidAction('AI players do not vote.');
    if (!player.isConnected) throw AppError.connectionFailed('You are currently disconnected.');

    room.setRematchVote(playerId, value);
    this.logger.debug('rematch vote recorded', { roomId: room.id, playerId, value });

    if (value && room.allVotedYes() && !room.rematchStarting) {
      this.startRematch(room);
      return;
    }
    this.refreshStatus(room);
  }

  cancel(room: Room, playerId?: string, message = 'Rematch cancelled.'): void {
    if (playerId) {
      if (room.status !== 'REMATCH_WAITING') {
        throw AppError.invalidAction('Rematch is not open right now.');
      }
      const player = room.getPlayer(playerId);
      if (!player) throw AppError.unauthorized('You are not in this room.');
      if (room.rematchVotes.get(playerId) === true && room.rematchStarting) {
        throw AppError.invalidAction('The rematch is already starting.');
      }
      room.rematchVotes.delete(playerId);
      this.logger.debug('rematch vote withdrawn', { roomId: room.id, playerId });
      this.refreshStatus(room);
      return;
    }

    // No player id: the whole vote window is abandoned (timeout or not enough players).
    this.platform.timerManager.cancelByKey(room.id, 'rematch', 'vote');
    room.rematchDeadline = null;
    this.platform.eventBus.emit('rematch:cancelled', { room });
    this.platform.lifecycleManager.returnToLobby(room, message);
  }

  /** Starts a new match in the same room (idempotent). */
  startRematch(room: Room): void {
    if (room.rematchStarting) return;
    if (!this.canRematch(room)) {
      this.cancel(room, undefined, 'Not enough players for a rematch.');
      return;
    }

    room.rematchStarting = true;
    this.platform.timerManager.cancelByKey(room.id, 'rematch', 'vote');
    this.platform.timerManager.cancelByType(room.id, 'turn');
    this.platform.timerManager.cancelByType(room.id, 'gameDuration');

    room.clearRematchVotes();
    room.rematchStarting = true; // clearRematchVotes resets the guard
    room.matchNumber += 1;
    room.gameResult = null;
    room.gameStartedAt = null;

    for (const player of room.players.values()) player.resetForNewMatch();
    this.platform.gameManager.resetState(room);

    room.status = 'NEW_MATCH';
    room.bumpVersion();

    this.platform.eventBus.emit('rematch:started', { room, matchNumber: room.matchNumber });
    this.platform.socketManager?.emitToRoom(room.id, 'rematch:started', {
      roomId: room.id,
      matchNumber: room.matchNumber,
      room: this.publicSnapshot(room),
    });
    this.logger.info('rematch started', { roomId: room.id, matchNumber: room.matchNumber });

    this.platform.lifecycleManager.startCountdown(room);
  }

  private publicSnapshot(room: Room) {
    return room.toState(undefined, this.platform.gameManager.getPublicState(room));
  }
}
