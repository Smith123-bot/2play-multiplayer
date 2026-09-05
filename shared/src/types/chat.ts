import type { Emote } from '../constants';

export const CHAT_MESSAGE_TYPES = ['message', 'emote', 'system'] as const;
export type ChatMessageType = (typeof CHAT_MESSAGE_TYPES)[number];

export const SYSTEM_EVENTS = [
  'player_joined',
  'player_left',
  'player_kicked',
  'game_started',
  'game_finished',
  'rematch_requested',
  'rematch_started',
  'rematch_cancelled',
  'player_disconnected',
  'player_reconnected',
  'host_changed',
  'game_changed',
] as const;
export type SystemEventType = (typeof SYSTEM_EVENTS)[number];

export interface ChatMessage {
  id: string;
  roomId: string;
  type: ChatMessageType;
  /** Null for system messages. */
  playerId: string | null;
  nickname: string;
  avatar: string;
  text: string;
  emote: Emote | null;
  systemEvent: SystemEventType | null;
  createdAt: number;
}
