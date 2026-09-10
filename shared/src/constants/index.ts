/**
 * 2PLAY — shared constants.
 *
 * These values are the single source of truth for both the server (authoritative)
 * and the client (UI + optimistic behaviour). Never duplicate a magic number in a
 * game module: import it from here instead.
 */

/* ------------------------------------------------------------------ */
/* Platform                                                            */
/* ------------------------------------------------------------------ */

export const APP_NAME = '2PLAY';
export const APP_TAGLINE = 'Play Together, Anywhere.';
export const APP_VERSION = '2.1.0';

/* ------------------------------------------------------------------ */
/* Players                                                             */
/* ------------------------------------------------------------------ */

export const NICKNAME_MIN_LENGTH = 3;
export const NICKNAME_MAX_LENGTH = 20;

export const MIN_PLAYERS_PER_ROOM = 2;
export const MAX_PLAYERS_PER_ROOM = 4;

export const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🦉', '🐧', '🐳', '🦄', '🐝', '🐺', '🐷'] as const;
export const DEFAULT_AVATAR: string = AVATARS[0];

/* ------------------------------------------------------------------ */
/* Rooms                                                               */
/* ------------------------------------------------------------------ */

export const ROOM_CODE_LENGTH = 6;
/** Ambiguous characters (I/O/0/1) are removed so codes can be read out loud. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const DEFAULT_MAX_PLAYERS = 2;
export const DEFAULT_MAX_ROOMS = 1000;

/** Empty room is destroyed after this long. */
export const ROOM_EMPTY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
/** Hard cap on room lifetime regardless of activity. */
export const ROOM_MAX_LIFETIME_MS = 4 * 60 * 60 * 1000; // 4 hours
/** How often the server sweeps rooms for cleanup. */
export const ROOM_CLEANUP_INTERVAL_MS = 30 * 1000;

/* ------------------------------------------------------------------ */
/* Lifecycle timings                                                   */
/* ------------------------------------------------------------------ */

export const COUNTDOWN_SECONDS = 3;
export const COUNTDOWN_STEP_MS = 1000;

/** Reconnection grace period granted to a disconnected player. */
export const RECONNECT_GRACE_MS = 120 * 1000; // 120 seconds
/** Interval at which reconnect deadlines are checked. */
export const RECONNECT_CHECK_INTERVAL_MS = 5 * 1000;

/** Rematch vote window. */
export const REMATCH_TIMEOUT_MS = 60 * 1000;
/** Interval at which the rematch timer ticks UI countdowns. */
export const REMATCH_TICK_MS = 1000;

/** Fixed simulation step used by game modules that need `update(dt)`. */
export const GAME_TICK_MS = 250;

/** Broadcast throttle for high-frequency game state updates. */
export const GAME_STATE_BROADCAST_THROTTLE_MS = 100;

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

export const CHAT_MIN_LENGTH = 1;
export const CHAT_MAX_LENGTH = 200;
export const CHAT_COOLDOWN_MS = 200;
export const CHAT_RATE_LIMIT_PER_SEC = 5;
export const CHAT_HISTORY_LIMIT = 100;
/** Identical messages in a row before the player gets muted. */
export const CHAT_SPAM_REPEAT_THRESHOLD = 10;
export const CHAT_MUTE_DURATION_MS = 60 * 1000;

export const EMOTES = ['👍', '👋', '😄', '🎉', '🔥', '🤔'] as const;
export type Emote = (typeof EMOTES)[number];

/* ------------------------------------------------------------------ */
/* Rate limits (server side)                                           */
/* ------------------------------------------------------------------ */

export const ACTION_RATE_LIMIT_PER_SEC = 20;
export const ROOM_CREATE_RATE_LIMIT_PER_MIN = 20;
export const ROOM_JOIN_RATE_LIMIT_PER_MIN = 60;
export const AUTH_RATE_LIMIT_PER_MIN = 60;
export const HTTP_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const HTTP_RATE_LIMIT_MAX = 300;

/* ------------------------------------------------------------------ */
/* Anti-cheat / physics                                                */
/* ------------------------------------------------------------------ */

/** Fastest reaction a human can plausibly produce. Faster => rejected. */
export const MIN_HUMAN_REACTION_MS = 150;

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

export const HISTORY_PAGE_SIZE = 20;
export const HISTORY_MAX_ITEMS = 100;

/* ------------------------------------------------------------------ */
/* UI                                                                  */
/* ------------------------------------------------------------------ */

export const COLORS = {
  primary: '#6366f1',
  secondary: '#8b5cf6',
  accent: '#ec4899',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  background: '#0f0f1a',
  surface: '#1a1a2e',
} as const;

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export const GAME_CATEGORIES = ['reflex', 'memory', 'word', 'strategy', 'math', 'coop'] as const;
