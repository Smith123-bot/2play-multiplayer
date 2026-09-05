import { z } from 'zod';
import {
  MAX_PLAYERS_PER_ROOM,
  MIN_PLAYERS_PER_ROOM,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from '../constants';
import { aiDifficultySchema } from './player';

const roomCodePattern = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export const roomCodeSchema = z
  .string()
  .min(1, 'Room code is required.')
  .transform((value) => value.trim().toUpperCase())
  .refine((value) => roomCodePattern.test(value), {
    message: `Room code must be ${ROOM_CODE_LENGTH} characters (A-Z, 2-9).`,
  });

export const gameIdSchema = z
  .string()
  .min(1, 'Game id is required.')
  .max(64, 'Game id is too long.')
  .regex(/^[a-z0-9-]+$/, 'Invalid game id.');

export const playerCountSchema = z.coerce
  .number()
  .int('Player count must be a whole number.')
  .min(MIN_PLAYERS_PER_ROOM, `At least ${MIN_PLAYERS_PER_ROOM} players are required.`)
  .max(MAX_PLAYERS_PER_ROOM, `At most ${MAX_PLAYERS_PER_ROOM} players are allowed.`);

export const playerIdSchema = z.string().min(8, 'Invalid player id.').max(128, 'Invalid player id.');

export const roomSettingsSchema = z
  .object({
    playerCount: playerCountSchema.optional(),
    gridSize: z.string().max(16).optional(),
    rounds: z.coerce.number().int().min(1).max(20).optional(),
    aiDifficulty: aiDifficultySchema.optional(),
    aiOpponents: z.coerce.number().int().min(0).max(MAX_PLAYERS_PER_ROOM - 1).optional(),
  })
  .strict();

export const createRoomSchema = z
  .object({
    gameId: gameIdSchema,
    maxPlayers: playerCountSchema,
    isPrivate: z.boolean().default(false),
    settings: roomSettingsSchema.optional(),
  })
  .strict();

export const joinRoomSchema = z
  .object({
    roomId: roomCodeSchema,
  })
  .strict();

export const kickPlayerSchema = z
  .object({
    playerId: playerIdSchema,
  })
  .strict();

export const addAISchema = z
  .object({
    difficulty: aiDifficultySchema.default('medium'),
  })
  .strict();

export const removeAISchema = z
  .object({
    playerId: playerIdSchema,
  })
  .strict();

export const readySchema = z
  .object({
    isReady: z.boolean(),
  })
  .strict();

export const selectGameSchema = z
  .object({
    gameId: gameIdSchema,
  })
  .strict();

export const roomListSchema = z
  .object({
    gameId: gameIdSchema.optional(),
    includePrivate: z.boolean().optional(),
  })
  .strict();

export const reconnectSchema = z
  .object({
    roomId: roomCodeSchema,
    sessionToken: z.string().min(16).max(256),
  })
  .strict();
