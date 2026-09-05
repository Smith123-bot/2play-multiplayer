import { z } from 'zod';
import { CHAT_MAX_LENGTH, CHAT_MIN_LENGTH, EMOTES } from '../constants';
import { containsHtml, sanitizeText } from '../utils/sanitize';

export const chatTextSchema = z
  .string()
  .min(CHAT_MIN_LENGTH, 'Message cannot be empty.')
  .max(CHAT_MAX_LENGTH * 4, 'Message is too long.')
  .transform((value) => sanitizeText(value, CHAT_MAX_LENGTH))
  .superRefine((value, ctx) => {
    if (value.length < CHAT_MIN_LENGTH) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Message cannot be empty.' });
    }
  });

export const chatSendSchema = z
  .object({
    text: chatTextSchema,
  })
  .strict();

export const emoteSchema = z.enum(EMOTES);

export const chatEmoteSchema = z
  .object({
    emote: emoteSchema,
  })
  .strict();

/** Extra guard used by the chat manager (spam heuristics). */
export function isSuspiciousText(value: string): boolean {
  return containsHtml(value) || value.length > CHAT_MAX_LENGTH;
}
