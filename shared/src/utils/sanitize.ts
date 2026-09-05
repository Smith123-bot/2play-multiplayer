/**
 * Text sanitisation helpers shared by client and server.
 *
 * Rule of thumb:
 *  - Nicknames are *rejected* when they contain markup (not silently escaped).
 *  - Chat text is stripped of markup and control characters.
 *  - Clients must render text with React (auto-escaping) — never dangerouslySetInnerHTML.
 */

/* eslint-disable no-control-regex -- sanitising input is the point here */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;
const HTML_TAG = /<\/?[^>]*>/g;

export function stripControlCharacters(value: string): string {
  return value.replace(CONTROL_CHARS, '');
}
/* eslint-enable no-control-regex */

export function containsHtml(value: string): boolean {
  return HTML_TAG.test(value) || /[<>&#;]/.test(value);
}

export function stripHtml(value: string): string {
  return value.replace(HTML_TAG, '');
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function sanitizeText(value: string, maxLength?: number): string {
  let out = stripControlCharacters(value ?? '');
  out = stripHtml(out);
  out = collapseWhitespace(out);
  if (typeof maxLength === 'number' && out.length > maxLength) {
    out = out.slice(0, maxLength);
  }
  return out;
}

/** Nicknames allow letters (any script), digits, spaces and a few separators. */
export function isSafeNickname(value: string): boolean {
  return /^[\p{L}\p{N}][\p{L}\p{N} _.'-]*$/u.test(value);
}

export function normalizeRoomCode(value: string): string {
  return (value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
