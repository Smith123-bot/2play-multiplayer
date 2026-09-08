import type {
  AddAIPayload,
  CreateRoomPayload,
  JoinRoomPayload,
  KickPlayerPayload,
  QuickPlayPayload,
  RemoveAIPayload,
  RoomCreatedPayload,
  RoomJoinedPayload,
  RoomListPayload,
  RoomListResultPayload,
  RoomState,
  RoomSettingsPayload,
} from '@2play/shared';
import {
  ROOM_CREATE_RATE_LIMIT_PER_MIN,
  ROOM_JOIN_RATE_LIMIT_PER_MIN,
  addAISchema,
  createRoomSchema,
  joinRoomSchema,
  kickPlayerSchema,
  quickPlaySchema,
  removeAISchema,
  roomListSchema,
} from '@2play/shared';
import type { Platform } from '../../core/Platform';
import { AppError } from '../../utils/errors';
import { parseOrThrow } from '../../utils/validate';
import { joinSocketRoom, requireSession, safeHandler, type HandlerContext } from './context';

function rateLimit(platform: Platform, key: string, limit: number, message: string): void {
  const result = platform.rateLimiter.consume(key, limit, 60_000);
  if (!result.allowed) throw AppError.rateLimited(message);
}

/** `room:list` — public rooms available to join. */
const list = safeHandler<RoomListPayload, RoomListResultPayload>(async function (
  this: HandlerContext,
  payload,
) {
  const input = parseOrThrow(roomListSchema, payload ?? {}, 'room list payload');
  requireSession(this);
  const rooms = this.platform.roomManager.listRooms({
    ...(input.gameId ? { gameId: input.gameId } : {}),
    includePrivate: input.includePrivate ?? false,
  });
  return { rooms };
});

/** `room:create` — host creates a room and gets a 6 character code. */
const create = safeHandler<CreateRoomPayload, RoomCreatedPayload>(async function (
  this: HandlerContext,
  payload,
) {
  const input = parseOrThrow(createRoomSchema, payload, 'create room payload');
  const session = requireSession(this);
  rateLimit(
    this.platform,
    `room-create:${this.socket.data.clientKey}`,
    ROOM_CREATE_RATE_LIMIT_PER_MIN,
    'You are creating rooms too quickly. Try again shortly.',
  );

  const room = this.platform.roomManager.createRoom({
    gameId: input.gameId,
    maxPlayers: input.maxPlayers,
    isPrivate: input.isPrivate,
    ...(input.settings ? { settings: input.settings } : {}),
    host: {
      playerId: session.playerId,
      sessionToken: session.token,
      nickname: session.nickname,
      avatar: session.avatar,
      userId: session.userId,
      socketId: this.socket.id,
    },
  });

  joinSocketRoom(this, room.id);
  this.platform.socketManager?.broadcastRoomState(room, true);

  return {
    room: room.toState(session.playerId, this.platform.gameManager.getPublicState(room, session.playerId)),
    playerId: session.playerId,
  };
});

/**
 * `room:quick-play` — instant AI match: no room code, no lobby, no visible
 * multiplayer room. Reuses the exact same room/game lifecycle as a normal
 * match (spec: Quick Play must be real, not faked, and must stay separate
 * from the public/private room flow).
 */
const quickPlay = safeHandler<QuickPlayPayload, RoomCreatedPayload>(async function (
  this: HandlerContext,
  payload,
) {
  const input = parseOrThrow(quickPlaySchema, payload, 'quick play payload');
  const session = requireSession(this);
  rateLimit(
    this.platform,
    `room-create:${this.socket.data.clientKey}`,
    ROOM_CREATE_RATE_LIMIT_PER_MIN,
    'You are creating matches too quickly. Try again shortly.',
  );

  const room = this.platform.roomManager.createQuickPlayMatch({
    gameId: input.gameId,
    aiDifficulty: input.aiDifficulty ?? 'medium',
    host: {
      playerId: session.playerId,
      sessionToken: session.token,
      nickname: session.nickname,
      avatar: session.avatar,
      userId: session.userId,
      socketId: this.socket.id,
    },
  });

  joinSocketRoom(this, room.id);
  this.platform.multiplayerManager.startGame(room, session.playerId);
  this.platform.socketManager?.broadcastRoomState(room, true);

  return {
    room: room.toState(session.playerId, this.platform.gameManager.getPublicState(room, session.playerId)),
    playerId: session.playerId,
  };
});

/** `room:join` — join an existing room by code. */
const join = safeHandler<JoinRoomPayload, RoomJoinedPayload>(async function (
  this: HandlerContext,
  payload,
) {
  const input = parseOrThrow(joinRoomSchema, payload, 'join room payload');
  const session = requireSession(this);
  rateLimit(
    this.platform,
    `room-join:${this.socket.data.clientKey}`,
    ROOM_JOIN_RATE_LIMIT_PER_MIN,
    'You are joining rooms too quickly. Try again shortly.',
  );

  const { room, player } = this.platform.roomManager.joinRoom({
    roomId: input.roomId,
    player: {
      playerId: session.playerId,
      sessionToken: session.token,
      nickname: session.nickname,
      avatar: session.avatar,
      userId: session.userId,
      socketId: this.socket.id,
    },
  });

  joinSocketRoom(this, room.id);
  this.platform.socketManager?.broadcastRoomState(room, true);
  this.socket.emit('room:joined', {
    room: room.toState(player.id, this.platform.gameManager.getPublicState(room, player.id)),
    playerId: player.id,
  });

  return {
    room: room.toState(player.id, this.platform.gameManager.getPublicState(room, player.id)),
    playerId: player.id,
  };
});

/** `room:leave` — leave the current room (room stays alive for the others). */
const leave = safeHandler<Record<string, never>, { left: boolean }>(async function (
  this: HandlerContext,
) {
  const session = requireSession(this);
  const roomId = session.roomId;
  if (!roomId) return { left: false };
  const room = this.platform.roomStore.get(roomId);
  const player = room?.getPlayerBySession(session.token);
  if (room && player) {
    this.platform.roomManager.leaveRoom(room, player.id, 'leave');
  }
  void this.socket.leave(roomId);
  return { left: true };
});

/** `room:kick` — host removes a player. */
const kick = safeHandler<KickPlayerPayload, { kicked: boolean }>(async function (
  this: HandlerContext,
  payload,
) {
  const input = parseOrThrow(kickPlayerSchema, payload, 'kick payload');
  const { room, player } = (() => {
    const session = requireSession(this);
    const roomId = session.roomId;
    if (!roomId) throw AppError.roomNotFound('You are not in a room.');
    const found = this.platform.roomStore.get(roomId);
    if (!found) throw AppError.roomNotFound('This room no longer exists.');
    const foundPlayer = found.getPlayerBySession(session.token);
    if (!foundPlayer) throw AppError.unauthorized('You are not a member of this room.');
    return { room: found, player: foundPlayer };
  })();

  this.platform.roomManager.kickPlayer(room, player.id, input.playerId);
  return { kicked: true };
});

/** `room:add-ai` — host adds an AI opponent (games with AI only). */
const addAI = safeHandler<AddAIPayload, { playerId: string }>(async function (
  this: HandlerContext,
  payload,
) {
  const input = parseOrThrow(addAISchema, payload ?? {}, 'add ai payload');
  const session = requireSession(this);
  const roomId = session.roomId;
  if (!roomId) throw AppError.roomNotFound('You are not in a room.');
  const room = this.platform.roomStore.get(roomId);
  if (!room) throw AppError.roomNotFound('This room no longer exists.');
  const player = room.getPlayerBySession(session.token);
  if (!player) throw AppError.unauthorized('You are not a member of this room.');

  const ai = this.platform.roomManager.addAI(room, player.id, input.difficulty);
  this.platform.socketManager?.broadcastRoomState(room, true);
  return { playerId: ai.id };
});

/** `room:remove-ai` — host removes an AI opponent. */
const removeAI = safeHandler<RemoveAIPayload, { removed: boolean }>(async function (
  this: HandlerContext,
  payload,
) {
  const input = parseOrThrow(removeAISchema, payload, 'remove ai payload');
  const session = requireSession(this);
  const roomId = session.roomId;
  if (!roomId) throw AppError.roomNotFound('You are not in a room.');
  const room = this.platform.roomStore.get(roomId);
  if (!room) throw AppError.roomNotFound('This room no longer exists.');
  const player = room.getPlayerBySession(session.token);
  if (!player) throw AppError.unauthorized('You are not a member of this room.');

  this.platform.roomManager.removeAI(room, player.id, input.playerId);
  this.platform.socketManager?.broadcastRoomState(room, true);
  return { removed: true };
});

export function registerRoomHandlers(context: HandlerContext): void {
  context.socket.on('room:list', list.bind(context));
  context.socket.on('room:create', create.bind(context));
  context.socket.on('room:quick-play', quickPlay.bind(context));
  context.socket.on('room:join', join.bind(context));
  context.socket.on('room:leave', leave.bind(context));
  context.socket.on('room:kick', kick.bind(context));
  context.socket.on('room:add-ai', addAI.bind(context));
  context.socket.on('room:remove-ai', removeAI.bind(context));
}

export type { RoomSettingsPayload, RoomState };
