/**
 * Canonical Socket.IO event names.
 *
 * Both server and client MUST import names from here — never hardcode strings —
 * so the protocol stays in sync and typo-proof.
 */

export const CLIENT_EVENTS = {
  AUTHENTICATE: 'authenticate',
  RECONNECT_ATTEMPT: 'reconnect:attempt',
  ROOM_LIST: 'room:list',
  ROOM_CREATE: 'room:create',
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',
  ROOM_KICK: 'room:kick',
  ROOM_ADD_AI: 'room:add-ai',
  ROOM_REMOVE_AI: 'room:remove-ai',
  LOBBY_READY: 'lobby:ready',
  LOBBY_SELECT_GAME: 'lobby:select-game',
  LOBBY_SETTINGS: 'lobby:settings',
  GAME_START: 'game:start',
  GAME_ACTION: 'game:action',
  GAME_LEAVE: 'game:leave',
  REMATCH_REQUEST: 'rematch:request',
  REMATCH_CANCEL: 'rematch:cancel',
  CHAT_SEND: 'chat:send',
  CHAT_EMOTE: 'chat:emote',
  HEARTBEAT: 'heartbeat',
} as const;

export type ClientEventName = (typeof CLIENT_EVENTS)[keyof typeof CLIENT_EVENTS];

export const SERVER_EVENTS = {
  CONNECTION_ESTABLISHED: 'connection:established',
  AUTH_SUCCESS: 'auth:success',
  AUTH_FAILED: 'auth:failed',

  ROOM_LIST: 'room:list',
  ROOM_CREATED: 'room:created',
  ROOM_JOINED: 'room:joined',
  ROOM_UPDATED: 'room:updated',
  ROOM_CLOSED: 'room:closed',
  ROOM_PLAYER_JOINED: 'room:player-joined',
  ROOM_PLAYER_LEFT: 'room:player-left',
  ROOM_ERROR: 'room:error',

  LOBBY_PLAYER_READY: 'lobby:player-ready',
  LOBBY_ALL_READY: 'lobby:all-ready',

  GAME_COUNTDOWN: 'game:countdown',
  GAME_STARTED: 'game:started',
  GAME_STATE_UPDATE: 'game:state-update',
  GAME_PLAYER_ACTION: 'game:player-action',
  GAME_FINISHED: 'game:finished',
  GAME_ERROR: 'game:error',

  REMATCH_STATUS: 'rematch:status',
  REMATCH_STARTED: 'rematch:started',
  REMATCH_CANCELLED: 'rematch:cancelled',

  CHAT_MESSAGE: 'chat:message',
  CHAT_EMOTE: 'chat:emote',
  CHAT_SYSTEM: 'chat:system',
  CHAT_MUTED: 'chat:muted',

  PLAYER_DISCONNECTED: 'player:disconnected',
  PLAYER_RECONNECTED: 'player:reconnected',

  TIMER_TICK: 'timer:tick',
  TIMER_EXPIRED: 'timer:expired',

  ERROR: 'error',
  NOTIFICATION: 'notification',
} as const;

export type ServerEventName = (typeof SERVER_EVENTS)[keyof typeof SERVER_EVENTS];

export const TIMER_TYPES = ['countdown', 'gameDuration', 'turn', 'reconnect', 'rematch'] as const;
export type TimerType = (typeof TIMER_TYPES)[number];

export const CONNECTION_STATES = ['CONNECTED', 'CONNECTING', 'DISCONNECTED', 'RECONNECTING'] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];
