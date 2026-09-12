import type { SessionInfo } from '@2play/shared';
import { AUTH_RATE_LIMIT_PER_MIN, DEFAULT_AVATAR } from '@2play/shared';
import type { Platform } from '../core/Platform';
import { AppError } from '../utils/errors';
import { createId, createSessionToken } from '../utils/ids';
import { createLogger } from '../utils/logger';

export interface Session {
  token: string;
  userId: string;
  playerId: string;
  nickname: string;
  avatar: string;
  socketId: string | null;
  roomId: string | null;
  createdAt: number;
  lastSeenAt: number;
}

export interface AuthenticateInput {
  nickname: string;
  avatar?: string;
  sessionToken?: string;
  socketId: string;
  /** Rate-limit key: the socket's IP (falls back to the socket id). */
  clientKey: string;
}

/**
 * Owns player sessions (identity + token + socket binding).
 *
 * The session token is the only credential a client stores; it is minted here,
 * kept server-side, and never derivable from a player id.
 */
export class ConnectionManager {
  private readonly sessionsByToken = new Map<string, Session>();
  private readonly tokenBySocket = new Map<string, string>();
  private readonly tokenByPlayer = new Map<string, string>();
  private readonly logger = createLogger('ConnectionManager');

  constructor(private readonly platform: Platform) {}

  async authenticate(
    input: AuthenticateInput,
  ): Promise<{ session: SessionInfo; restored: boolean }> {
    const limit = this.platform.rateLimiter.consume(
      `auth:${input.clientKey}`,
      AUTH_RATE_LIMIT_PER_MIN,
      60_000,
    );
    if (!limit.allowed) {
      throw AppError.rateLimited('Too many connection attempts. Try again in a minute.');
    }

    const avatar = input.avatar ?? DEFAULT_AVATAR;

    if (input.sessionToken) {
      const existing = this.sessionsByToken.get(input.sessionToken);
      if (existing) {
        // Re-bind the session to the new socket (refresh / network switch).
        this.bindSocket(existing.token, input.socketId);
        existing.nickname = input.nickname;
        existing.avatar = avatar;
        existing.lastSeenAt = Date.now();
        this.logger.info('session restored', { userId: existing.userId });
        void this.platform.database.updateUser(existing.userId, {
          nickname: input.nickname,
          avatar,
        });
        return { session: this.toSessionInfo(existing), restored: true };
      }
      // Unknown token: treat as a new session rather than failing the user.
      this.logger.warn('unknown session token supplied — minting a new session');
    }

    const token = createSessionToken();
    const user = await this.platform.database.upsertUser({
      sessionToken: token,
      nickname: input.nickname,
      avatar,
    });

    const session: Session = {
      token,
      userId: user?.id ?? createId(),
      playerId: user?.id ?? createId(),
      nickname: input.nickname,
      avatar,
      socketId: input.socketId,
      roomId: null,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    };
    session.playerId = session.userId;

    this.sessionsByToken.set(token, session);
    this.tokenByPlayer.set(session.playerId, token);
    this.tokenBySocket.set(input.socketId, token);
    this.logger.info('session created', { userId: session.userId, nickname: session.nickname });

    return { session: this.toSessionInfo(session), restored: false };
  }

  bindSocket(token: string, socketId: string): void {
    const session = this.sessionsByToken.get(token);
    if (!session) return;
    if (session.socketId && session.socketId !== socketId) {
      // Duplicate connection for the same session: the newest socket wins.
      this.tokenBySocket.delete(session.socketId);
    }
    session.socketId = socketId;
    session.lastSeenAt = Date.now();
    this.tokenBySocket.set(socketId, token);
  }

  getSessionByToken(token: string): Session | undefined {
    return this.sessionsByToken.get(token);
  }

  getSessionByPlayer(playerId: string): Session | undefined {
    const token = this.tokenByPlayer.get(playerId);
    return token ? this.sessionsByToken.get(token) : undefined;
  }

  getSessionBySocket(socketId: string): Session | undefined {
    const token = this.tokenBySocket.get(socketId);
    if (!token) return undefined;
    return this.sessionsByToken.get(token);
  }

  setRoom(token: string, roomId: string | null): void {
    const session = this.sessionsByToken.get(token);
    if (!session) return;
    session.roomId = roomId;
    session.lastSeenAt = Date.now();
  }

  touch(socketId: string): void {
    const session = this.getSessionBySocket(socketId);
    if (session) session.lastSeenAt = Date.now();
  }

  /** Called on socket disconnect: keeps the session so the player can reconnect. */
  unbindSocket(socketId: string): Session | undefined {
    const token = this.tokenBySocket.get(socketId);
    if (!token) return undefined;
    this.tokenBySocket.delete(socketId);
    const session = this.sessionsByToken.get(token);
    if (session) {
      session.socketId = null;
      session.lastSeenAt = Date.now();
    }
    return session;
  }

  dropSession(token: string): void {
    const session = this.sessionsByToken.get(token);
    if (session?.socketId) this.tokenBySocket.delete(session.socketId);
    if (session) this.tokenByPlayer.delete(session.playerId);
    this.sessionsByToken.delete(token);
  }

  toSessionInfo(session: Session): SessionInfo {
    return {
      userId: session.userId,
      sessionToken: session.token,
      playerId: session.playerId,
      nickname: session.nickname,
      avatar: session.avatar,
      createdAt: session.createdAt,
    };
  }

  get activeSessions(): number {
    return this.sessionsByToken.size;
  }

  get boundSockets(): number {
    return this.tokenBySocket.size;
  }

  /** Removes sessions idle for longer than `maxIdleMs` (keeps memory bounded). */
  prune(maxIdleMs: number): number {
    const cutoff = Date.now() - maxIdleMs;
    let removed = 0;
    for (const session of [...this.sessionsByToken.values()]) {
      if (session.socketId === null && session.lastSeenAt < cutoff && session.roomId === null) {
        this.dropSession(session.token);
        removed += 1;
      }
    }
    if (removed > 0) this.logger.info('pruned idle sessions', { removed });
    return removed;
  }
}
