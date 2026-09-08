import type { ApiError } from '../errors';
import type { ChatMessage, SystemEventType } from './chat';
import type { Emote } from '../constants';
import type { GameAction, GameConfig, GameResult } from './game';
import type { AIDifficulty, Player, SessionInfo } from './player';
import type { RoomState, RoomStatus, RoomSummary } from './room';
import type { ConnectionState, TimerType } from '../socket-events/event-names';

/* ------------------------------------------------------------------ */
/* Shared ack envelope                                                 */
/* ------------------------------------------------------------------ */

export interface AckResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: ApiError;
}

export type Ack<T = unknown> = (response: AckResponse<T>) => void;

/* ------------------------------------------------------------------ */
/* Client → Server payloads                                            */
/* ------------------------------------------------------------------ */

export interface AuthenticatePayload {
  nickname: string;
  avatar?: string;
  /** Present when restoring a previous session (refresh / reload). */
  sessionToken?: string;
}

export interface ReconnectAttemptPayload {
  roomId: string;
  sessionToken: string;
}

export interface RoomListPayload {
  gameId?: string;
  includePrivate?: boolean;
}

export interface RoomSettingsPayload {
  playerCount?: number;
  gridSize?: string;
  rounds?: number;
  aiDifficulty?: AIDifficulty;
  aiOpponents?: number;
}

export interface CreateRoomPayload {
  gameId: string;
  maxPlayers: number;
  isPrivate: boolean;
  settings?: RoomSettingsPayload;
}

export interface QuickPlayPayload {
  gameId: string;
  aiDifficulty?: AIDifficulty;
}

export interface JoinRoomPayload {
  roomId: string;
}

export interface KickPlayerPayload {
  playerId: string;
}

export interface AddAIPayload {
  difficulty?: AIDifficulty;
}

export interface RemoveAIPayload {
  playerId: string;
}

export interface ReadyPayload {
  isReady: boolean;
}

export interface SelectGamePayload {
  gameId: string;
}

export interface GameActionPayload {
  action: GameAction;
}

export interface ChatSendPayload {
  text: string;
}

export interface ChatEmotePayload {
  emote: Emote;
}

/* ------------------------------------------------------------------ */
/* Server → Client payloads                                            */
/* ------------------------------------------------------------------ */

export interface ConnectionEstablishedPayload {
  socketId: string;
  serverTime: number;
  appVersion: string;
}

export interface AuthSuccessPayload {
  session: SessionInfo;
  /** Present when the session was restored from a token. */
  restored: boolean;
}

export interface RoomListResultPayload {
  rooms: RoomSummary[];
}

export interface RoomJoinedPayload {
  room: RoomState;
  playerId: string;
}

export interface RoomCreatedPayload {
  room: RoomState;
  playerId: string;
}

export interface RoomClosedPayload {
  roomId: string;
  reason: 'empty' | 'lifetime' | 'host' | 'server';
}

export interface PlayerJoinedPayload {
  roomId: string;
  player: Player;
}

export interface PlayerLeftPayload {
  roomId: string;
  playerId: string;
  nickname: string;
  reason: 'leave' | 'kick' | 'timeout' | 'disconnect';
}

export interface PlayerReadyPayload {
  roomId: string;
  playerId: string;
  isReady: boolean;
  allReady: boolean;
}

export interface CountdownPayload {
  roomId: string;
  /** 3, 2, 1, then 0 for "GO". */
  value: number;
  secondsRemaining: number;
}

export interface GameStartedPayload {
  roomId: string;
  gameId: string;
  matchNumber: number;
  startedAt: number;
  config: GameConfig;
}

export interface GameStateUpdatePayload {
  roomId: string;
  gameId: string;
  state: unknown;
  stateVersion: number;
  updatedAt: number;
}

export interface GamePlayerActionPayload {
  roomId: string;
  playerId: string;
  action: GameAction;
  accepted: boolean;
}

export interface GameFinishedPayload {
  roomId: string;
  gameId: string;
  result: GameResult;
}

export interface RematchStatusPayload {
  roomId: string;
  votes: Record<string, boolean>;
  /** Nicknames that still have to vote. */
  pending: string[];
  expiresAt: number | null;
  required: number;
}

export interface RematchStartedPayload {
  roomId: string;
  matchNumber: number;
  room: RoomState;
}

export interface RematchCancelledPayload {
  roomId: string;
  /** Room falls back to the lobby. */
  room: RoomState;
}

export interface ChatMessagePayload {
  roomId: string;
  message: ChatMessage;
}

export interface ChatSystemPayload {
  roomId: string;
  message: ChatMessage;
  event: SystemEventType;
}

export interface ChatMutedPayload {
  roomId: string;
  playerId: string;
  until: number;
  reason: 'spam';
}

export interface PlayerDisconnectedPayload {
  roomId: string;
  playerId: string;
  nickname: string;
  reconnectDeadline: number;
  graceMs: number;
}

export interface PlayerReconnectedPayload {
  roomId: string;
  playerId: string;
  nickname: string;
}

export interface TimerTickPayload {
  roomId: string;
  timerType: TimerType;
  remainingMs: number;
  value?: number;
}

export interface TimerExpiredPayload {
  roomId: string;
  timerType: TimerType;
}

export interface NotificationPayload {
  roomId?: string;
  level: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  code?: string;
}

export interface ConnectionStatusPayload {
  state: ConnectionState;
  roomId?: string;
  reconnectDeadline?: number | null;
  message?: string;
}

export interface RoomErrorPayload {
  roomId?: string;
  error: ApiError;
}

/* ------------------------------------------------------------------ */
/* Typed Socket.IO maps                                                */
/* ------------------------------------------------------------------ */

export interface ServerToClientEvents {
  'connection:established': (payload: ConnectionEstablishedPayload) => void;
  'auth:success': (payload: AuthSuccessPayload) => void;
  'auth:failed': (payload: { error: ApiError }) => void;

  'room:list': (payload: RoomListResultPayload) => void;
  'room:created': (payload: RoomCreatedPayload) => void;
  'room:joined': (payload: RoomJoinedPayload) => void;
  'room:updated': (payload: { room: RoomState }) => void;
  'room:closed': (payload: RoomClosedPayload) => void;
  'room:player-joined': (payload: PlayerJoinedPayload) => void;
  'room:player-left': (payload: PlayerLeftPayload) => void;
  'room:error': (payload: RoomErrorPayload) => void;

  'lobby:player-ready': (payload: PlayerReadyPayload) => void;
  'lobby:all-ready': (payload: { roomId: string; canStart: boolean }) => void;

  'game:countdown': (payload: CountdownPayload) => void;
  'game:started': (payload: GameStartedPayload) => void;
  'game:state-update': (payload: GameStateUpdatePayload) => void;
  'game:player-action': (payload: GamePlayerActionPayload) => void;
  'game:finished': (payload: GameFinishedPayload) => void;
  'game:error': (payload: { roomId?: string; error: ApiError }) => void;

  'rematch:status': (payload: RematchStatusPayload) => void;
  'rematch:started': (payload: RematchStartedPayload) => void;
  'rematch:cancelled': (payload: RematchCancelledPayload) => void;

  'chat:message': (payload: ChatMessagePayload) => void;
  'chat:emote': (payload: ChatMessagePayload) => void;
  'chat:system': (payload: ChatSystemPayload) => void;
  'chat:muted': (payload: ChatMutedPayload) => void;

  'player:disconnected': (payload: PlayerDisconnectedPayload) => void;
  'player:reconnected': (payload: PlayerReconnectedPayload) => void;

  'timer:tick': (payload: TimerTickPayload) => void;
  'timer:expired': (payload: TimerExpiredPayload) => void;

  error: (payload: { error: ApiError }) => void;
  notification: (payload: NotificationPayload) => void;

  /** Disconnect reasons are provided by Socket.IO itself. */
  disconnect: (reason: string) => void;
}

export interface ClientToServerEvents {
  authenticate: (payload: AuthenticatePayload, ack?: Ack<AuthSuccessPayload>) => void;
  'reconnect:attempt': (
    payload: ReconnectAttemptPayload,
    ack?: Ack<{ room: RoomState; playerId: string }>,
  ) => void;
  'room:list': (payload: RoomListPayload, ack?: Ack<RoomListResultPayload>) => void;
  'room:create': (payload: CreateRoomPayload, ack?: Ack<RoomCreatedPayload>) => void;
  'room:quick-play': (payload: QuickPlayPayload, ack?: Ack<RoomCreatedPayload>) => void;
  'room:join': (payload: JoinRoomPayload, ack?: Ack<RoomJoinedPayload>) => void;
  'room:leave': (payload: Record<string, never>, ack?: Ack<{ left: boolean }>) => void;
  'room:kick': (payload: KickPlayerPayload, ack?: Ack<{ kicked: boolean }>) => void;
  'room:add-ai': (payload: AddAIPayload, ack?: Ack<{ playerId: string }>) => void;
  'room:remove-ai': (payload: RemoveAIPayload, ack?: Ack<{ removed: boolean }>) => void;
  'lobby:ready': (payload: ReadyPayload, ack?: Ack<{ isReady: boolean }>) => void;
  'lobby:select-game': (payload: SelectGamePayload, ack?: Ack<{ gameId: string }>) => void;
  'lobby:settings': (payload: RoomSettingsPayload, ack?: Ack<RoomSettingsPayload>) => void;
  'game:start': (payload: Record<string, never>, ack?: Ack<{ started: boolean }>) => void;
  'game:action': (payload: GameActionPayload, ack?: Ack<{ accepted: boolean }>) => void;
  'game:leave': (payload: Record<string, never>, ack?: Ack<{ left: boolean }>) => void;
  'rematch:request': (payload: Record<string, never>, ack?: Ack<RematchStatusPayload>) => void;
  'rematch:cancel': (payload: Record<string, never>, ack?: Ack<RematchStatusPayload>) => void;
  'chat:send': (payload: ChatSendPayload, ack?: Ack<{ sent: boolean }>) => void;
  'chat:emote': (payload: ChatEmotePayload, ack?: Ack<{ sent: boolean }>) => void;
  heartbeat: (payload: Record<string, never>, ack?: Ack<{ serverTime: number }>) => void;
}

export type { RoomStatus };
