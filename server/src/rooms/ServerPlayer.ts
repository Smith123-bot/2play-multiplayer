import type { AIDifficulty, Player } from '@2play/shared';

export interface ServerPlayerOptions {
  id: string;
  sessionToken: string;
  nickname: string;
  avatar: string;
  seatIndex: number;
  isHost?: boolean;
  isAI?: boolean;
  aiDifficulty?: AIDifficulty | null;
  userId?: string | null;
}

/**
 * Server-side player record.
 *
 * IMPORTANT: `sessionToken` and `socketId` are server-only and are stripped by
 * `toPublic()` before anything is serialised to clients.
 */
export class ServerPlayer {
  public readonly id: string;
  public readonly sessionToken: string;
  public nickname: string;
  public avatar: string;
  public isHost: boolean;
  public isReady = false;
  public isAI: boolean;
  public aiDifficulty: AIDifficulty | null;
  public userId: string | null;
  public seatIndex: number;
  public score: number;
  public role: 'player' | 'spectator';

  public socketId: string | null = null;
  public isConnected = false;
  public disconnectedAt: number | null = null;
  public reconnectDeadline: number | null = null;
  public joinedAt: number;
  public lastSeenAt: number;

  constructor(options: ServerPlayerOptions) {
    this.id = options.id;
    this.sessionToken = options.sessionToken;
    this.nickname = options.nickname;
    this.avatar = options.avatar;
    this.seatIndex = options.seatIndex;
    this.isHost = options.isHost ?? false;
    this.isAI = options.isAI ?? false;
    this.aiDifficulty = options.aiDifficulty ?? null;
    this.userId = options.userId ?? null;
    this.score = 0;
    this.role = 'player';
    this.joinedAt = Date.now();
    this.lastSeenAt = Date.now();
    if (this.isAI) {
      // AI players are always "present" — they live on the server.
      this.isConnected = true;
    }
  }

  get isDisconnected(): boolean {
    return !this.isConnected && this.disconnectedAt !== null;
  }

  get isActive(): boolean {
    return this.isConnected || this.isDisconnected;
  }

  markConnected(socketId: string): void {
    this.socketId = socketId;
    this.isConnected = true;
    this.disconnectedAt = null;
    this.reconnectDeadline = null;
    this.lastSeenAt = Date.now();
  }

  markDisconnected(deadline: number | null): void {
    this.isConnected = false;
    this.socketId = null;
    this.disconnectedAt = Date.now();
    this.reconnectDeadline = deadline;
  }

  resetForNewMatch(): void {
    this.score = 0;
    this.isReady = false;
  }

  toPublic(): Player {
    return {
      id: this.id,
      nickname: this.nickname,
      avatar: this.avatar,
      isHost: this.isHost,
      isReady: this.isReady,
      isConnected: this.isConnected,
      isAI: this.isAI,
      aiDifficulty: this.aiDifficulty,
      score: this.score,
      seatIndex: this.seatIndex,
      joinedAt: this.joinedAt,
      isDisconnected: this.isDisconnected,
      reconnectDeadline: this.reconnectDeadline,
      disconnectedAt: this.disconnectedAt,
      role: this.role,
    };
  }
}
