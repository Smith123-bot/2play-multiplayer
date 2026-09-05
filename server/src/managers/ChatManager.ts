import type { ChatMessage, Emote, SystemEventType } from '@2play/shared';
import {
  CHAT_COOLDOWN_MS,
  CHAT_HISTORY_LIMIT,
  CHAT_MUTE_DURATION_MS,
  CHAT_RATE_LIMIT_PER_SEC,
  CHAT_SPAM_REPEAT_THRESHOLD,
} from '@2play/shared';
import type { Platform } from '../core/Platform';
import { CHAT_MESSAGE_TYPES, SYSTEM_EVENTS } from '@2play/shared';
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

const SYSTEM_TEXT: Record<SystemEventType, (name: string) => string> = {
  player_joined: (name) => `${name} joined the room.`,
  player_left: (name) => `${name} left the room.`,
  player_kicked: (name) => `${name} was removed by the host.`,
  game_started: () => 'The match is starting!',
  game_finished: (name) => `Match finished. ${name}`,
  rematch_requested: (name) => `${name} wants a rematch.`,
  rematch_started: () => 'Rematch accepted — new match starting!',
  rematch_cancelled: () => 'Rematch cancelled — back to the lobby.',
  player_disconnected: (name) => `${name} lost connection and can reconnect.`,
  player_reconnected: (name) => `${name} reconnected.`,
  host_changed: (name) => `${name} is the new host.`,
  game_changed: (name) => `Game changed to ${name}.`,
};

/**
 * Chat + system messages.
 *
 * Everything is validated, rate limited and spam filtered server-side. Clients
 * render text as plain text (React escaping) — HTML is never accepted.
 */
export class ChatManager {
  private readonly states = new Map<string, PlayerChatState>();
  private readonly logger = createLogger('ChatManager');

  constructor(private readonly platform: Platform) {
    this.registerSystemSubscribers();
  }

  private registerSystemSubscribers(): void {
    const bus = this.platform.eventBus;

    bus.on('room:player-joined', ({ room, player }) => {
      this.system(room, 'player_joined', player.nickname);
    });

    bus.on('room:player-left', ({ room, player, reason }) => {
      if (reason === 'kick') this.system(room, 'player_kicked', player.nickname);
      else if (reason === 'timeout') this.system(room, 'player_left', `${player.nickname} (timed out)`);
      else this.system(room, 'player_left', player.nickname);
    });

    bus.on('room:host-changed', ({ room, player }) => {
      this.system(room, 'host_changed', player.nickname);
    });

    bus.on('room:game-changed', ({ room }) => {
      this.system(room, 'game_changed', this.gameName(room.gameId));
    });

    bus.on('player:disconnected', ({ room, player }) => {
      this.system(room, 'player_disconnected', player.nickname);
    });

    bus.on('player:reconnected', ({ room, player }) => {
      this.system(room, 'player_reconnected', player.nickname);
    });

    bus.on('game:started', ({ room }) => {
      this.system(room, 'game_started', '');
    });

    bus.on('game:finished', ({ room, result }) => {
      const winner =
        result.winners.length > 0
          ? result.rankings
              .filter((entry) => result.winners.includes(entry.playerId))
              .map((entry) => entry.nickname)
              .join(', ')
          : 'No winner';
      this.system(room, 'game_finished', result.isDraw ? 'It is a draw!' : `${winner} wins!`);
    });

    bus.on('rematch:started', ({ room }) => {
      this.system(room, 'rematch_started', '');
    });

    bus.on('rematch:cancelled', ({ room }) => {
      this.system(room, 'rematch_cancelled', '');
    });
  }

  private gameName(gameId: string): string {
    return this.platform.registry.find(gameId)?.metadata.name ?? gameId;
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
      CHAT_RATE_LIMIT_PER_SEC,
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
      CHAT_RATE_LIMIT_PER_SEC,
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
    return message;
  }

  system(room: Room, event: SystemEventType, subject: string): ChatMessage {
    const message: ChatMessage = {
      id: createId(),
      roomId: room.id,
      type: 'system',
      playerId: null,
      nickname: 'System',
      avatar: '🎮',
      text: SYSTEM_TEXT[event]?.(subject) ?? subject,
      emote: null,
      systemEvent: event,
      createdAt: Date.now(),
    };
    room.addChatMessage(message);
    this.platform.socketManager?.emitToRoom(room.id, 'chat:system', {
      roomId: room.id,
      message,
      event,
    });
    return message;
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

  static get systemEvents(): readonly string[] {
    return SYSTEM_EVENTS;
  }
}
