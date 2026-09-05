import type { RoomSettings } from '@2play/shared';
import { MAX_PLAYERS_PER_ROOM } from '@2play/shared';
import type { Platform } from '../core/Platform';
import type { Room } from '../rooms/Room';
import type { ServerPlayer } from '../rooms/ServerPlayer';
import { AppError } from '../utils/errors';
import { createLogger } from '../utils/logger';

/**
 * LobbyManager — readiness, game selection, room options and AI seats.
 * All operations are host-gated where the rules require it.
 */
export class LobbyManager {
  private readonly logger = createLogger('LobbyManager');

  constructor(private readonly platform: Platform) {}

  private assertHost(room: Room, playerId: string): ServerPlayer {
    const player = room.getPlayer(playerId);
    if (!player) throw AppError.unauthorized('You are not in this room.');
    if (room.hostPlayerId !== playerId) throw AppError.unauthorized('Only the host can do that.');
    return player;
  }

  private assertLobby(room: Room): void {
    if (!['WAITING', 'LOBBY', 'READY'].includes(room.status)) {
      throw AppError.invalidAction('The room options can only be changed in the lobby.');
    }
  }

  /* ---------------------------------------------------------------- */
  /* Ready                                                             */
  /* ---------------------------------------------------------------- */

  setReady(room: Room, playerId: string, isReady: boolean): boolean {
    const player = room.getPlayer(playerId);
    if (!player) throw AppError.unauthorized('You are not in this room.');
    if (player.isAI) throw AppError.invalidAction('AI players are always ready.');
    if (!['WAITING', 'LOBBY', 'READY'].includes(room.status)) {
      throw AppError.invalidAction('You can only change readiness in the lobby.');
    }

    player.isReady = isReady;
    room.bumpVersion();
    this.platform.gameManager.playerReady(room, playerId);
    this.evaluateReadiness(room);
    this.logger.debug('player ready changed', { roomId: room.id, playerId, isReady });
    return player.isReady;
  }

  /** Recomputes room status (LOBBY ↔ READY) and emits `lobby:all-ready`. */
  evaluateReadiness(room: Room): boolean {
    const allReady = this.canStart(room);
    if (allReady && room.status === 'LOBBY') {
      room.setStatus('READY');
    } else if (!allReady && room.status === 'READY') {
      room.setStatus('LOBBY');
    }
    if (allReady) {
      this.platform.eventBus.emit('lobby:all-ready', { room });
    }
    this.platform.eventBus.emit('room:state-changed', { room });
    return allReady;
  }

  /**
   * The room can start when the seat count meets the game minimum
   * (AI opponents count as seats) and every connected human is ready.
   */
  canStart(room: Room): boolean {
    if (!['WAITING', 'LOBBY', 'READY'].includes(room.status)) return false;
    const metadata = this.platform.registry.find(room.gameId)?.metadata;
    if (!metadata) return false;
    if (room.players.size < metadata.minPlayers) return false;
    const humans = room.humanPlayers.filter((player) => player.isConnected);
    if (humans.length === 0) return false;
    return humans.every((player) => player.isReady);
  }

  startBlockedReason(room: Room): string | null {
    if (this.canStart(room)) return null;
    const metadata = this.platform.registry.find(room.gameId)?.metadata;
    const humans = room.humanPlayers.filter((player) => player.isConnected);
    if (!metadata) return 'This game is not available.';
    if (room.players.size < metadata.minPlayers) {
      const missing = metadata.minPlayers - room.players.size;
      return metadata.hasAI
        ? `Add ${missing} more player${missing > 1 ? 's' : ''} or AI opponent${missing > 1 ? 's' : ''}.`
        : `At least ${metadata.minPlayers} players are required.`;
    }
    const notReady = humans.filter((player) => !player.isReady);
    if (notReady.length > 0) {
      return `Waiting for ${notReady.map((player) => player.nickname).join(', ')} to ready up.`;
    }
    return 'The room is not ready to start.';
  }

  /* ---------------------------------------------------------------- */
  /* Game selection + settings                                         */
  /* ---------------------------------------------------------------- */

  selectGame(room: Room, playerId: string, gameId: string): void {
    this.assertHost(room, playerId);
    this.assertLobby(room);
    const metadata = this.platform.registry.get(gameId).metadata;

    const previousGameId = room.gameId;
    if (previousGameId === gameId) return;

    // Keep the room playable: clamp the seat count to the new game's rules.
    if (!metadata.supportedPlayerCounts.includes(room.maxPlayers)) {
      room.maxPlayers = Math.min(
        metadata.maxPlayers,
        Math.max(metadata.minPlayers, room.maxPlayers),
      );
      if (!metadata.supportedPlayerCounts.includes(room.maxPlayers)) {
        room.maxPlayers = metadata.supportedPlayerCounts[metadata.supportedPlayerCounts.length - 1];
      }
    }
    if (room.players.size > room.maxPlayers) {
      throw AppError.invalidInput(
        `Too many players for ${metadata.name}. Remove players first.`,
      );
    }

    // AI seats that the new game cannot provide are dropped.
    if (!metadata.hasAI) {
      for (const ai of room.aiPlayers) room.removePlayer(ai.id);
    }

    room.gameId = gameId;
    room.settings.playerCount = room.maxPlayers;
    for (const player of room.players.values()) player.isReady = false;
    room.gameResult = null;
    this.platform.gameManager.cleanup(room);

    this.platform.eventBus.emit('room:game-changed', { room, previousGameId });
    this.platform.eventBus.emit('room:state-changed', { room });
    this.logger.info('game changed', { roomId: room.id, from: previousGameId, to: gameId });
  }

  updateSettings(room: Room, playerId: string, patch: Partial<RoomSettings>): RoomSettings {
    this.assertHost(room, playerId);
    this.assertLobby(room);
    const metadata = this.platform.registry.get(room.gameId).metadata;

    if (patch.playerCount !== undefined) {
      if (!metadata.supportedPlayerCounts.includes(patch.playerCount)) {
        throw AppError.invalidInput(
          `${metadata.name} supports ${metadata.supportedPlayerCounts.join(', ')} players.`,
        );
      }
      if (patch.playerCount < room.players.size) {
        throw AppError.invalidInput('Cannot shrink the room below the current number of players.');
      }
      room.maxPlayers = Math.min(patch.playerCount, MAX_PLAYERS_PER_ROOM);
      room.settings.playerCount = room.maxPlayers;
    }

    if (patch.aiDifficulty !== undefined) {
      if (!metadata.hasAI) throw AppError.invalidAction('This game has no AI opponents.');
      if (!metadata.aiDifficulties.includes(patch.aiDifficulty)) {
        throw AppError.invalidInput('Unsupported AI difficulty.');
      }
      room.settings.aiDifficulty = patch.aiDifficulty;
      for (const ai of room.aiPlayers) ai.aiDifficulty = patch.aiDifficulty;
    }

    if (patch.aiOpponents !== undefined) {
      if (!metadata.hasAI) throw AppError.invalidAction('This game has no AI opponents.');
      const desired = Math.max(0, Math.min(patch.aiOpponents, room.maxPlayers - room.humanPlayers.length));
      room.settings.aiOpponents = desired;
      const current = room.aiPlayers.length;
      if (desired > current) {
        for (let i = 0; i < desired - current && !room.isFull; i += 1) {
          this.platform.roomManager.addAI(room, playerId, room.settings.aiDifficulty);
        }
      } else if (desired < current) {
        const removable = room.aiPlayers.slice(current - desired);
        for (const ai of removable) this.platform.roomManager.removeAI(room, playerId, ai.id);
      }
    }

    if (patch.gridSize !== undefined) {
      const allowed = metadata.gridOptions;
      if (allowed && allowed.length > 0 && !allowed.includes(patch.gridSize)) {
        throw AppError.invalidInput(`Unsupported grid size for ${metadata.name}.`);
      }
      room.settings.gridSize = patch.gridSize;
    }

    if (patch.rounds !== undefined) {
      room.settings.rounds = Math.max(1, Math.min(20, Math.round(patch.rounds)));
    }

    room.bumpVersion();
    this.platform.eventBus.emit('room:state-changed', { room });
    return { ...room.settings };
  }

  /* ---------------------------------------------------------------- */
  /* Reset between matches                                             */
  /* ---------------------------------------------------------------- */

  resetReadiness(room: Room): void {
    for (const player of room.players.values()) {
      player.isReady = false;
    }
    if (room.status === 'READY') room.setStatus('LOBBY');
    room.bumpVersion();
  }
}
