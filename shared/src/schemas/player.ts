import { z } from 'zod';
import { AVATARS, DIFFICULTIES, NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from '../constants';
import { containsHtml, isSafeNickname } from '../utils/sanitize';

export const nicknameSchema = z
  .string({ required_error: 'Nickname is required.' })
  .min(1, 'Nickname is required.')
  .max(NICKNAME_MAX_LENGTH * 2, 'Nickname is too long.')
  .transform((value) => value.trim())
  .superRefine((value, ctx) => {
    if (value.length < NICKNAME_MIN_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Nickname must be at least ${NICKNAME_MIN_LENGTH} characters.`,
      });
      return;
    }
    if (value.length > NICKNAME_MAX_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Nickname must be at most ${NICKNAME_MAX_LENGTH} characters.`,
      });
      return;
    }
    if (containsHtml(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Nickname cannot contain HTML.' });
      return;
    }
    if (!isSafeNickname(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Nickname may only contain letters, numbers, spaces and . _ - characters.',
      });
    }
  });

export const avatarSchema = z
  .string()
  .max(16, 'Avatar is too long.')
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined))
  .refine((value) => value === undefined || (AVATARS as readonly string[]).includes(value), {
    message: 'Unknown avatar.',
  });

export const sessionTokenSchema = z
  .string()
  .min(16, 'Invalid session token.')
  .max(256, 'Invalid session token.');

export const aiDifficultySchema = z.enum(DIFFICULTIES);

export const authenticateSchema = z
  .object({
    nickname: nicknameSchema,
    avatar: avatarSchema,
    sessionToken: sessionTokenSchema.optional(),
  })
  .strict();
