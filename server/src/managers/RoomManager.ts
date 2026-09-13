import type { RoomSettings, RoomStatus, RoomSummary } from '@2play/shared';
import { ROOM_EMPTY_TIMEOUT_MS, ROOM_MAX_LIFETIME_MS } from '@2play/shared';
import type { Platform } from '../core/Platform';
import { Room } from '../rooms/Room';
import { ServerPlayer } from '../rooms/ServerPlayer';
import { AppError } from '../utils/errors';
import { createId, createRoomCode } from '../utils/ids';
import { createLogger } from '../utils/logger';

export interface PlayerIdentity {
  playerId: string;
  sessionToken: string;
  nickname: string;
  avatar: string;
  userId: string | null;
  socketId: string | null;
}

export interface CreateRoomInput {
  gameId: string;
  maxPlayers: number;
  isPrivate: boolean;
  settings?: Partial<RoomSettings>;
  host: PlayerIdentity;
  /** Solo "Quick Play vs AI" match — never listed publicly, no room code UX. */
  isQuickPlay?: boolean;
}

export interface QuickPlayInput {
  gameId: string;
  aiDifficulty: 'easy' | 'medium' | 'hard';
  host: PlayerIdentity;
}

export interface JoinRoomInput {
  roomId: string;
  player: PlayerIdentity;
}

export const JOINABLE_STATUSES: RoomStatus[] = ['WAITING', 'LOBBY', 'READY'];

/**
 * RoomManager — creation, joining, leaving, kicking, listing and cleanup.
 *
 * Contains zero game-specific logic: everything game related goes through
 * GameManager + the registry (spec §42).
 */
export class RoomManager {
  private readonly logger = createLogger('RoomManager');

  constructor(private readonly platform: Platform) {}

  get size(): number {
    return this.platform.roomStore.size;
  }

  getRoom(roomId: string): Room | undefined {
    return this.platform.roomStore.get(roomId);
  }

  requireRoom(roomId: string): Room {
    const room = this.platform.roomStore.get(roomId);
    // Generic, code-free message: echoing the attempted code back gives a room
    // scanner a per-code signal and reflects unvalidated input into the
    // response. Every unknown code now fails identically.
    if (!room) throw AppError.roomNotFound('Room not found or no longer available.');
    return room;
  }

  /* ---------------------------------------------------------------- */
  /* Creation                                                          */
  /* ---------------------------------------------------------------- */

  createRoom(input: CreateRoomInput): Room {
    const game = this.platform.registry.get(input.gameId);

    if (!game.metadata.supportedPlayerCounts.includes(input.maxPlayers)) {
      throw AppError.invalidInput(
        `${game.metadata.name} supports ${game.metadata.supportedPlayerCounts.join(', ')} players.`,
      );
    }
    if (this.platform.roomStore.size >= this.platform.config.maxRooms) {
      throw AppError.rateLimited('The server is at full capacity. Try again later.');
    }
    if (input.host.playerId && this.findRoomOfPlayer(input.host.playerId)) {
      throw AppError.invalidAction(
        'You are already in a room. Leave it before creating a new one.',
      );
    }

    const id = this.generateRoomCode();
    const room = new Room({
      id,
      gameId: input.gameId,
      maxPlayers: input.maxPlayers,
      isPrivate: input.isPrivate,
      hostPlayerId: input.host.playerId,
      isQuickPlay: input.isQuickPlay ?? false,
      settings: {
        playerCount: input.maxPlayers,
        aiOpponents: input.settings?.aiOpponents ?? 0,
        aiDifficulty: input.settings?.aiDifficulty ?? 'medium',
        ...(input.settings?.gridSize ? { gridSize: input.settings.gridSize } : {}),
        ...(input.settings?.rounds ? { rounds: input.settings.rounds } : {}),
      },
    });

    const host = new ServerPlayer({
      id: input.host.playerId,
      sessionToken: input.host.sessionToken,
      nickname: input.host.nickname,
      avatar: input.host.avatar,
      seatIndex: 0,
      isHost: true,
      userId: input.host.userId,
    });
    if (input.host.socketId) host.markConnected(input.host.socketId);
    room.addPlayer(host);
    room.setStatus('LOBBY');

    this.platform.roomStore.set(room);
    this.platform.connectionManager.setRoom(input.host.sessionToken, room.id);
    this.platform.eventBus.emit('room:created', { room });
    this.platform.eventBus.emit('room:player-joined', { room, player: host });

    this.logger.info('room created', {
      roomId: room.id,
      gameId: room.gameId,
      maxPlayers: room.maxPlayers,
      isPrivate: room.isPrivate,
    });
    return room;
  }

  /**
   * "Quick Play vs AI" — the fast path from the spec: no room code, no lobby,
   * no visible multiplayer room. Reuses the exact same room/game lifecycle as
   * a normal match (RoomManager + LobbyManager + GameLifecycleManager) so
   * every existing rule (validation, timers, rematch, statistics) still
   * applies; the room is simply private and flagged `isQuickPlay`.
   */
  createQuickPlayMatch(input: QuickPlayInput): Room {
    const game = this.platform.registry.get(input.gameId);
    if (!game.metadata.hasAI) {
      throw AppError.invalidAction(`${game.metadata.name} has no AI opponent available.`);
    }

    const maxPlayers = game.metadata.supportedPlayerCounts.includes(2)
      ? 2
      : game.metadata.minPlayers;

    const room = this.createRoom({
      gameId: input.gameId,
      maxPlayers,
      isPrivate: true,
      isQuickPlay: true,
      settings: { aiOpponents: maxPlayers - 1, aiDifficulty: input.aiDifficulty },
      host: input.host,
    });

    for (let seat = room.players.size; seat < maxPlayers; seat += 1) {
      this.addAI(room, input.host.playerId, input.aiDifficulty);
    }

    const host = room.getPlayer(input.host.playerId);
    if (host) host.isReady = true;

    return room;
  }

  private generateRoomCode(): string {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const code = createRoomCode();
      if (!this.platform.roomStore.has(code)) return code;
    }
    throw AppError.internal('Could not allocate a unique room code.');
  }

  /* ---------------------------------------------------------------- */
  /* Joining                                                           */
  /* ---------------------------------------------------------------- */

  joinRoom(input: JoinRoomInput): { room: Room; player: ServerPlayer; rejoined: boolean } {
    const room = this.requireRoom(input.roomId);

    if (room.status === 'CLOSED') {
      throw AppError.roomNotFound('This room has been closed.');
    }

    // Same session re-joining (duplicate connect / refresh) is idempotent.
    const existing = room.getPlayerBySession(input.player.sessionToken);
    if (existing) {
      if (!existing.isConnected) {
        if (existing.reconnectDeadline === null || Date.now() > existing.reconnectDeadline) {
          throw AppError.connectionFailed('The reconnection window has expired.');
        }
        this.platform.timerManager.cancelByKey(room.id, 'reconnect', `player:${existing.id}`);
      }
      if (input.player.socketId) existing.markConnected(input.player.socketId);
      existing.nickname = input.player.nickname;
      existing.avatar = input.player.avatar;
      this.platform.connectionManager.setRoom(input.player.sessionToken, room.id);
      this.platform.eventBus.emit('room:state-changed', { room });
      return { room, player: existing, rejoined: true };
    }

    if (!JOINABLE_STATUSES.includes(room.status)) {
      throw AppError.invalidAction('This match is already in progress.');
    }
    if (room.isFull) {
      throw AppError.roomFull('This room is full.');
    }
    if (this.findRoomOfPlayer(input.player.playerId)) {
      throw AppError.invalidAction('You are already in another room.');
    }

    const player = new ServerPlayer({
      id: input.player.playerId,
      sessionToken: input.player.sessionToken,
      nickname: input.player.nickname,
      avatar: input.player.avatar,
      seatIndex: room.nextSeatIndex,
      userId: input.player.userId,
    });
    if (input.player.socketId) player.markConnected(input.player.socketId);

    room.addPlayer(player);
    this.platform.connectionManager.setRoom(input.player.sessionToken, room.id);

    if (room.gameState !== null && room.gameState !== undefined) {
      this.platform.gameManager.playerJoined(room, player);
    }

    this.platform.eventBus.emit('room:player-joined', { room, player });
    this.logger.info('player joined room', {
      roomId: room.id,
      playerId: player.id,
      players: room.players.size,
    });

    return { room, player, rejoined: false };
  }

  findRoomOfPlayer(playerId: string): Room | undefined {
    const session = this.platform.connectionManager.getSessionByPlayer(playerId);
    if (session) return session.roomId ? this.platform.roomStore.get(session.roomId) : undefined;
    // Defensive fallback for test fixtures and non-session identities.
    return this.platform.roomStore.all().find((room) => room.players.has(playerId));
  }

  findRoomOfSocket(socketId: string): Room | undefined {
    const roomId = this.platform.connectionManager.getSessionBySocket(socketId)?.roomId;
    if (roomId) return this.platform.roomStore.get(roomId);
    return undefined;
  }

  /* ---------------------------------------------------------------- */
  /* Leaving                                                           */
  /* ---------------------------------------------------------------- */

  leaveRoom(
    room: Room,
    playerId: string,
    reason: 'leave' | 'kick' | 'timeout' | 'disconnect' = 'leave',
  ): void {
    const player = room.getPlayer(playerId);
    if (!player) return;

    if (room.gameState !== null && room.gameState !== undefined) {
      this.platform.gameManager.playerLeft(
        room,
        playerId,
        reason === 'disconnect' ? 'disconnect' : reason,
      );
    }

    room.removePlayer(playerId);
    this.platform.connectionManager.setRoom(player.sessionToken, null);
    this.platform.chatManager.clearPlayerState(playerId);
    this.platform.eventBus.emit('room:player-left', { room, player, reason });

    if (room.players.size === 0) {
      room.emptyAt = Date.now();
      this.closeRoom(room, 'empty');
      return;
    }

    // Host migration.
    if (player.isHost) {
      const newHost = room.promoteNewHost();
      if (newHost) {
        this.platform.eventBus.emit('room:host-changed', { room, player: newHost });
      }
    }

    this.handleDepartureEffects(room);
    this.platform.eventBus.emit('room:state-changed', { room });
    this.logger.info('player left room', { roomId: room.id, playerId, reason });
  }

  kickPlayer(room: Room, hostPlayerId: string, targetPlayerId: string): void {
    if (room.hostPlayerId !== hostPlayerId) {
      throw AppError.unauthorized('Only the host can remove players.');
    }
    if (hostPlayerId === targetPlayerId) {
      throw AppError.invalidInput('The host cannot remove themselves.');
    }
    const target = room.getPlayer(targetPlayerId);
    if (!target) throw AppError.invalidInput('That player is not in this room.');
    if (target.isAI) {
      this.removeAI(room, hostPlayerId, targetPlayerId);
      return;
    }
    const targetSocketId = target.socketId;
    this.leaveRoom(room, targetPlayerId, 'kick');
    // A removed member must not remain subscribed to room-wide chat/lifecycle
    // events. Disconnect after removing the seat so disconnect handling cannot
    // create a fresh reconnection grace period.
    if (targetSocketId) {
      this.platform.socketManager?.disconnectSocket?.(
        targetSocketId,
        'You were removed from the room.',
      );
    }
  }

  /** Abandons/returns to lobby when a departure invalidates the match. */
  private handleDepartureEffects(room: Room): void {
    const metadata = this.platform.registry.find(room.gameId)?.metadata;
    const minPlayers = metadata?.minPlayers ?? 2;
    // Seats still in the room — AI opponents count, exactly like the lobby's
    // `canStart`. Using the *human* count here wrongly abandoned matches that
    // still had a full board (e.g. 1 human + 2 AI after a player left).
    const seats = room.players.size;
    const humans = room.activeHumans.length;

    if (humans === 0) {
      room.emptyAt = Date.now();
      if (room.status !== 'CLOSED') this.closeRoom(room, 'empty');
      return;
    }

    if (
      room.status === 'REMATCH_WAITING' ||
      room.status === 'RESULT' ||
      room.status === 'GAME_FINISHED'
    ) {
      // Rematch may continue with the remaining players if the minimum is met.
      if (!this.platform.rematchManager.canRematch(room)) {
        this.platform.lifecycleManager.returnToLobby(room, 'Not enough players for a rematch.');
      } else {
        room.clearRematchVotes();
        this.platform.rematchManager.refreshStatus(room);
      }
      return;
    }

    if (
      (room.status === 'PLAYING' || room.status === 'COUNTDOWN' || room.status === 'PAUSED') &&
      seats < minPlayers
    ) {
      this.platform.lifecycleManager.abandonMatch(room, 'abandoned');
    }
  }

  /* ---------------------------------------------------------------- */
  /* AI players                                                        */
  /* ---------------------------------------------------------------- */

  addAI(room: Room, hostPlayerId: string, difficulty: 'easy' | 'medium' | 'hard'): ServerPlayer {
    const metadata = this.platform.registry.get(room.gameId).metadata;
    if (!metadata.hasAI) throw AppError.invalidAction(`${metadata.name} has no AI opponent.`);
    if (room.hostPlayerId !== hostPlayerId)
      throw AppError.unauthorized('Only the host can add AI players.');
    if (!['WAITING', 'LOBBY', 'READY'].includes(room.status)) {
      throw AppError.invalidAction('AI players can only be added in the lobby.');
    }
    if (room.isFull) throw AppError.roomFull('The room is full.');

    const ai = new ServerPlayer({
      id: createId(),
      sessionToken: `ai:${createId()}`,
      nickname: room.nextAIName(),
      avatar: '🤖',
      seatIndex: room.nextSeatIndex,
      isAI: true,
      aiDifficulty: metadata.aiDifficulties.includes(difficulty)
        ? difficulty
        : (metadata.aiDifficulties[0] ?? 'medium'),
    });
    ai.isReady = true;
    room.addPlayer(ai);
    this.platform.eventBus.emit('room:player-joined', { room, player: ai });
    this.logger.info('ai player added', { roomId: room.id, playerId: ai.id, difficulty });
    return ai;
  }

  removeAI(room: Room, hostPlayerId: string, playerId: string): void {
    const player = room.getPlayer(playerId);
    if (!player?.isAI) throw AppError.invalidInput('That player is not an AI.');
    if (room.hostPlayerId !== hostPlayerId)
      throw AppError.unauthorized('Only the host can remove AI players.');
    if (room.status === 'PLAYING' || room.status === 'COUNTDOWN') {
      throw AppError.invalidAction('AI players cannot be removed during a match.');
    }
    room.removePlayer(playerId);
    this.platform.eventBus.emit('room:player-left', { room, player, reason: 'kick' });
    this.platform.eventBus.emit('room:state-changed', { room });
  }

  /* ---------------------------------------------------------------- */
  /* Listing / cleanup                                                 */
  /* ---------------------------------------------------------------- */

  listRooms(filter: { gameId?: string } = {}): RoomSummary[] {
    return this.platform.roomStore
      .all()
      .filter((room) => room.status !== 'CLOSED')
      .filter((room) => JOINABLE_STATUSES.includes(room.status))
      .filter((room) => !room.isPrivate && !room.isQuickPlay)
      .filter((room) => (filter.gameId ? room.gameId === filter.gameId : true))
      .filter((room) => !room.isFull)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((room) =>
        room.toSummary(this.platform.registry.find(room.gameId)?.metadata.name ?? room.gameId),
      );
  }

  closeRoom(room: Room, reason: 'empty' | 'lifetime' | 'server' | 'host'): void {
    if (room.status === 'CLOSED') return;
    room.setStatus('CLOSED');

    this.platform.timerManager.cancelAllForRoom(room.id);
    this.platform.gameManager.cleanup(room);
    this.platform.chatManager.clearRoomStates(room);

    for (const player of room.players.values()) {
      if (!player.isAI) this.platform.connectionManager.setRoom(player.sessionToken, null);
    }

    this.platform.socketManager?.emitToRoom(room.id, 'room:closed', { roomId: room.id, reason });
    this.platform.socketManager?.clearRoom(room.id);

    this.platform.roomStore.delete(room.id);
    this.platform.eventBus.emit('room:closed', { room, reason });
    this.logger.info('room closed', {
      roomId: room.id,
      reason,
      lifetimeMs: Date.now() - room.createdAt,
    });
  }

  /**
   * Periodic housekeeping: closes empty and expired rooms and prunes caches.
   * Driven by a TimerManager system timer — no stray intervals anywhere.
   */
  sweep(): { closed: number; prunedRateLimits: number; prunedSessions: number } {
    const now = Date.now();
    let closed = 0;

    for (const room of this.platform.roomStore.all()) {
      const emptyFor = room.emptyAt ? now - room.emptyAt : 0;
      const age = now - room.createdAt;
      const emptyTimeoutMs = this.platform.config?.roomTimeoutMs ?? ROOM_EMPTY_TIMEOUT_MS;
      if (room.players.size === 0 || (room.emptyAt !== null && emptyFor > emptyTimeoutMs)) {
        this.closeRoom(room, 'empty');
        closed += 1;
        continue;
      }
      if (age > (this.platform.config?.roomMaxLifetimeMs ?? ROOM_MAX_LIFETIME_MS)) {
        this.closeRoom(room, 'lifetime');
        closed += 1;
      }
    }

    const prunedRateLimits = this.platform.rateLimiter.prune();
    const prunedSessions = this.platform.connectionManager.prune(30 * 60 * 1000);
    void this.platform.database.ensureHealthy();
    return { closed, prunedRateLimits, prunedSessions };
  }
}
