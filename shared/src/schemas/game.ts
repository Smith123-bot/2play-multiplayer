import { z } from 'zod';

/**
 * Generic action envelope. Game-specific payloads are validated by the game
 * module itself (`validateAction`) — this layer only guarantees the envelope is
 * well formed and bounded, which protects the server from malformed floods.
 */
const primitivePayload = z.union([z.string().max(256), z.number(), z.boolean(), z.null()]);
const objectPayload = z.record(primitivePayload);

export const gameActionSchema = z
  .object({
    type: z
      .string()
      .min(1, 'Action type is required.')
      .max(48, 'Action type is too long.')
      .regex(/^[a-zA-Z0-9_.:-]+$/, 'Invalid action type.'),
    // Bounded nesting so games like Draw & Guess can send stroke points
    // without opening the envelope to unbounded JSON.
    payload: z
      .record(
        z.union([
          primitivePayload,
          objectPayload,
          z.array(primitivePayload).max(64),
          z.array(objectPayload).max(48),
        ]),
      )
      .optional(),
  })
  .strict();

export const gameActionPayloadSchema = z
  .object({
    action: gameActionSchema,
  })
  .strict();
