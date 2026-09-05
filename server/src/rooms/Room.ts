import type {
  ChatMessage,
  GameResult,
  Player,
  RoomSettings,
  RoomState,
  RoomStatus,
  RoomSummary,
} from '@2play/shared';
import { CHAT_HISTORY_LIMIT, ROOM_TRANSITIONS } from '@2play/shared';
import { ServerPlayer } from './ServerPlayer';

export interface RoomOptions {
  id: string;
  gameId: string;
  maxPlayers: number;
  isPrivate: boolean;
  hostPlayerId: string;
  settings?: Partial<RoomSettings>;
}

/**
 * A room owns players, chat and the opaque game state blob.
 *
 * Rooms survive game completion: nothing in this class disconnects sockets or
 * clears chat when a match ends — that is what makes rematch work.
 */
export class Room {
  public readonly id: string;
  public gameId: string;
  public hostPlayerId: string;
  public maxPlayers: number;
  public isPrivate: boolean;
  public readonly players = new Map<string, ServerPlayer>();
  public status: RoomStatus = 'LOBBY';

  /** Opaque, game-module-owned state. Never serialised raw to clients. */
  public gameState: unknown = null;
  public gameResult: GameResult | null = null;

  public readonly chat: ChatMessage[] = [];
  public readonly rematchVotes = new Map<string, boolean>();
  public rematchDeadline: number | null = null;
  public countdownValue = 0;
  public matchNumber = 1;

  public readonly createdAt: number = Date.now();
  public updatedAt: number = Date.now();
  public gameStartedAt: number | null = null;
  public lastActivityAt: number = Date.now();
  /** Set when the room has no human players left; used by the cleanup sweep. */
  public emptyAt: number | null = null;
  /** Idempotency guard: only one rematch may start per match. */
  public rematchStarting = false;

  public settings: RoomSettings;
  public stateVersion = 0;

  private aiCounter = 0;

  constructor(options: RoomOptions) {
    this.id = options.id;
    this.gameId = options.gameId;
    this.maxPlayers = options.maxPlayers;
    this.isPrivate = options.isPrivate;
    this.hostPlayerId = options.hostPlayerId;
    this.settings = {
      playerCount: options.settings?.playerCount ?? options.maxPlayers,
      aiOpponents: options.settings?.aiOpponents ?? 0,
      aiDifficulty: options.settings?.aiDifficulty ?? 'medium',
      ...(options.settings?.gridSize ? { gridSize: options.settings.gridSize } : {}),
      ...(options.settings?.rounds ? { rounds: options.settings.rounds } : {}),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Players                                                           */
  /* ---------------------------------------------------------------- */

  addPlayer(player: ServerPlayer): void {
    this.players.set(player.id, player);
    this.emptyAt = null;
    this.touch();
  }

  removePlayer(playerId: string): ServerPlayer | undefined {
    const player = this.players.get(playerId);
    if (!player) return undefined;
    this.players.delete(playerId);
    this.rematchVotes.delete(playerId);
    this.touch();
    if (this.humanPlayers.length === 0) {
      this.emptyAt = Date.now();
    }
    return player;
  }

  getPlayer(playerId: string): ServerPlayer | undefined {
    return this.players.get(playerId);
  }

  getPlayerBySession(sessionToken: string): ServerPlayer | undefined {
    for (const player of this.players.values()) {
      if (!player.isAI && player.sessionToken === sessionToken) return player;
    }
    return undefined;
  }

  getPlayerBySocket(socketId: string): ServerPlayer | undefined {
    for (const player of this.players.values()) {
      if (player.socketId === socketId) return player;
    }
    return undefined;
  }

  /** Players ordered by seat so every client renders the same order. */
  get orderedPlayers(): ServerPlayer[] {
    return [...this.players.values()].sort((a, b) => a.seatIndex - b.seatIndex);
  }

  get humanPlayers(): ServerPlayer[] {
    return this.orderedPlayers.filter((player) => !player.isAI);
  }

  get aiPlayers(): ServerPlayer[] {
    return this.orderedPlayers.filter((player) => player.isAI);
  }

  get connectedPlayers(): ServerPlayer[] {
    return this.orderedPlayers.filter((player) => player.isConnected);
  }

  /** Humans that are still part of the match (connected or within grace). */
  get activeHumans(): ServerPlayer[] {
    return this.humanPlayers.filter((player) => player.isActive);
  }

  get isFull(): boolean {
    return this.players.size >= this.maxPlayers;
  }

  get nextSeatIndex(): number {
    const used = new Set(this.orderedPlayers.map((player) => player.seatIndex));
    let index = 0;
    while (used.has(index)) index += 1;
    return index;
  }

  nextAIName(): string {
    this.aiCounter += 1;
    const names = ['Nova', 'Pixel', 'Echo', 'Quark'];
    const base = names[(this.aiCounter - 1) % names.length];
    const suffix = Math.floor((this.aiCounter - 1) / names.length);
    return suffix === 0 ? `${base} AI` : `${base} AI ${suffix + 1}`;
  }

  promoteNewHost(): ServerPlayer | null {
    const candidate = this.humanPlayers.find((player) => player.isActive) ?? this.humanPlayers[0];
    if (!candidate) return null;
    for (const player of this.players.values()) player.isHost = false;
    candidate.isHost = true;
    this.hostPlayerId = candidate.id;
    return candidate;
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle helpers                                                 */
  /* ---------------------------------------------------------------- */

  canTransition(to: RoomStatus): boolean {
    return ROOM_TRANSITIONS[this.status]?.includes(to) ?? false;
  }

  setStatus(status: RoomStatus): void {
    this.status = status;
    this.touch();
  }

  touch(): void {
    this.updatedAt = Date.now();
    this.lastActivityAt = this.updatedAt;
    this.stateVersion += 1;
  }

  /** Bumps stateVersion without touching activity (used for broadcasts). */
  bumpVersion(): void {
    this.stateVersion += 1;
    this.updatedAt = Date.now();
  }

  /* ---------------------------------------------------------------- */
  /* Chat                                                              */
  /* ---------------------------------------------------------------- */

  addChatMessage(message: ChatMessage): void {
    this.chat.push(message);
    if (this.chat.length > CHAT_HISTORY_LIMIT) {
      this.chat.splice(0, this.chat.length - CHAT_HISTORY_LIMIT);
    }
    this.bumpVersion();
  }

  /* ---------------------------------------------------------------- */
  /* Rematch                                                           */
  /* ---------------------------------------------------------------- */

  setRematchVote(playerId: string, vote: boolean): void {
    this.rematchVotes.set(playerId, vote);
    this.bumpVersion();
  }

  clearRematchVotes(): void {
    this.rematchVotes.clear();
    this.rematchDeadline = null;
    this.rematchStarting = false;
    this.bumpVersion();
  }

  /** Eligible voters: connected humans (players who left cannot vote). */
  get rematchVoters(): ServerPlayer[] {
    return this.humanPlayers.filter((player) => player.isConnected);
  }

  allVotedYes(): boolean {
    const voters = this.rematchVoters;
    if (voters.length === 0) return false;
    return voters.every((player) => this.rematchVotes.get(player.id) === true);
  }

  /* ---------------------------------------------------------------- */
  /* Serialisation                                                     */
  /* ---------------------------------------------------------------- */

  toState(viewerId?: string, gamePublicState?: unknown): RoomState {
    return {
      id: this.id,
      gameId: this.gameId,
      hostPlayerId: this.hostPlayerId,
      maxPlayers: this.maxPlayers,
      isPrivate: this.isPrivate,
      status: this.status,
      players: this.orderedPlayers.map((player) => player.toPublic()),
      countdownValue: this.countdownValue,
      matchNumber: this.matchNumber,
      gameStartedAt: this.gameStartedAt,
      gameResult: this.gameResult,
      gameState: gamePublicState === undefined ? null : gamePublicState,
      rematchVotes: Object.fromEntries(this.rematchVotes.entries()),
      rematchDeadline: this.rematchDeadline,
      settings: { ...this.settings },
      chat: [...this.chat],
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      stateVersion: this.stateVersion,
    };
  }

  toSummary(gameName: string): RoomSummary {
    const host = this.players.get(this.hostPlayerId);
    return {
      id: this.id,
      gameId: this.gameId,
      gameName,
      hostNickname: host?.nickname ?? 'Host',
      playerCount: this.players.size,
      maxPlayers: this.maxPlayers,
      isPrivate: this.isPrivate,
      status: this.status,
      createdAt: this.createdAt,
    };
  }

  toPlayerList(): Player[] {
    return this.orderedPlayers.map((player) => player.toPublic());
  }
}
