import type { ChatMessage, Emote } from '@2play/shared';
import {
  CHAT_COOLDOWN_MS,
  CHAT_HISTORY_LIMIT,
  CHAT_MUTE_DURATION_MS,
  CHAT_RATE_LIMIT_PER_SEC,
  CHAT_SPAM_REPEAT_THRESHOLD,
} from '@2play/shared';
import type { Platform } from '../core/Platform';
import { CHAT_MESSAGE_TYPES } from '@2play/shared';
import { AppError } from '../utils/errors';
import { createId } from '../utils/ids';
import { createLogger } from '../utils/logger';
import type { Room } from '../rooms/Room';
import type { ServerPlayer } from '../rooms/ServerPlayer';

interface PlayerChatState {
  lastMessageAt: number;
  lastText: string;
  repeatCount: number;
  mutedUntil: number;
}

/**
 * Player chat.
 *
 * The transcript holds ONLY what players actually said: validated text
 * messages and explicitly sent emotes. Room/match lifecycle events ("Match
 * finished", "Rematch accepted", "The match is starting", joins/leaves …)
 * are deliberately NOT written here — they are status information and are
 * surfaced by the room UI (status banners, player list, result screen), not
 * as fake chat lines. Everything is validated, rate limited and spam
 * filtered server-side. Clients render text as plain text (React escaping) —
 * HTML is never accepted.
 */
export class ChatManager {
  private readonly states = new Map<string, PlayerChatState>();
  private readonly logger = createLogger('ChatManager');

  constructor(private readonly platform: Platform) {
    // NOTE: no system/lifecycle subscribers any more. Lifecycle events never
    // enter the chat transcript (removed deliberately — see class docs).
  }


  private stateFor(playerId: string): PlayerChatState {
    let state = this.states.get(playerId);
    if (!state) {
      state = { lastMessageAt: 0, lastText: '', repeatCount: 0, mutedUntil: 0 };
      this.states.set(playerId, state);
    }
    return state;
  }

  isMuted(playerId: string): boolean {
    const state = this.states.get(playerId);
    if (!state) return false;
    if (state.mutedUntil > Date.now()) return true;
    if (state.mutedUntil !== 0) state.mutedUntil = 0;
    return false;
  }

  muteRemaining(playerId: string): number {
    const state = this.states.get(playerId);
    if (!state) return 0;
    return Math.max(0, state.mutedUntil - Date.now());
  }

  private assertAllowed(room: Room, player: ServerPlayer, text: string): void {
    const state = this.stateFor(player.id);

    if (this.isMuted(player.id)) {
      throw AppError.rateLimited('You are temporarily muted for spamming.');
    }

    const now = Date.now();
    if (now - state.lastMessageAt < CHAT_COOLDOWN_MS) {
      throw AppError.rateLimited('You are typing too fast.');
    }

    const limit = this.platform.rateLimiter.consume(
      `chat:${room.id}:${player.id}`,
      this.platform.config.chatRateLimitPerSec || CHAT_RATE_LIMIT_PER_SEC,
      1000,
    );
    if (!limit.allowed) {
      throw AppError.rateLimited('Slow down a little.');
    }

    // Spam heuristic: identical repeated messages trigger a temporary mute.
    const normalized = text.trim().toLowerCase();
    if (normalized.length > 0 && normalized === state.lastText) {
      state.repeatCount += 1;
      if (state.repeatCount >= CHAT_SPAM_REPEAT_THRESHOLD) {
        state.mutedUntil = now + CHAT_MUTE_DURATION_MS;
        state.repeatCount = 0;
        const until = state.mutedUntil;
        this.platform.socketManager?.emitToRoom(room.id, 'chat:muted', {
          roomId: room.id,
          playerId: player.id,
          until,
          reason: 'spam',
        });
        this.logger.warn('player muted for chat spam', { roomId: room.id, playerId: player.id });
        throw AppError.rateLimited('You were muted for 60 seconds for repeating messages.');
      }
    } else {
      state.repeatCount = 1;
      state.lastText = normalized;
    }

    state.lastMessageAt = now;
  }

  sendMessage(room: Room, player: ServerPlayer, text: string): ChatMessage {
    this.assertAllowed(room, player, text);
    const message: ChatMessage = {
      id: createId(),
      roomId: room.id,
      type: 'message',
      playerId: player.id,
      nickname: player.nickname,
      avatar: player.avatar,
      text,
      emote: null,
      systemEvent: null,
      createdAt: Date.now(),
    };
    room.addChatMessage(message);
    this.platform.socketManager?.emitToRoom(room.id, 'chat:message', {
      roomId: room.id,
      message,
    });
    this.afterTranscriptChange(room);
    return message;
  }

  sendEmote(room: Room, player: ServerPlayer, emote: Emote): ChatMessage {
    const state = this.stateFor(player.id);
    if (this.isMuted(player.id)) {
      throw AppError.rateLimited('You are temporarily muted for spamming.');
    }
    const now = Date.now();
    if (now - state.lastMessageAt < CHAT_COOLDOWN_MS) {
      throw AppError.rateLimited('You are emoting too fast.');
    }
    const limit = this.platform.rateLimiter.consume(
      `chat:${room.id}:${player.id}`,
      this.platform.config.chatRateLimitPerSec || CHAT_RATE_LIMIT_PER_SEC,
      1000,
    );
    if (!limit.allowed) throw AppError.rateLimited('Slow down a little.');
    state.lastMessageAt = now;
    state.lastText = '';
    state.repeatCount = 0;

    const message: ChatMessage = {
      id: createId(),
      roomId: room.id,
      type: 'emote',
      playerId: player.id,
      nickname: player.nickname,
      avatar: player.avatar,
      text: '',
      emote,
      systemEvent: null,
      createdAt: Date.now(),
    };
    room.addChatMessage(message);
    this.platform.socketManager?.emitToRoom(room.id, 'chat:emote', { roomId: room.id, message });
    this.afterTranscriptChange(room);
    return message;
  }


  /**
   * Schedules the (throttled) room snapshot that carries the new transcript.
   *
   * Clients render chat from the authoritative room snapshot, so a transcript
   * change must reach them even when nothing else in the room changed — in a
   * quiet lobby a message used to stay invisible until the next unrelated
   * state change. `broadcastRoomState` coalesces bursts, and the snapshot
   * includes the chat array exactly once per change (see SocketManager).
   */
  private afterTranscriptChange(room: Room): void {
    this.platform.socketManager?.broadcastRoomState(room);
  }

  clearPlayerState(playerId: string): void {
    this.states.delete(playerId);
  }

  clearRoomStates(room: Room): void {
    for (const player of room.players.values()) {
      this.states.delete(player.id);
      this.platform.rateLimiter.reset(`chat:${room.id}:${player.id}`);
    }
  }

  get trackedPlayers(): number {
    return this.states.size;
  }

  static get maxHistory(): number {
    return CHAT_HISTORY_LIMIT;
  }

  static get supportedTypes(): readonly string[] {
    return CHAT_MESSAGE_TYPES;
  }

}
