import type { ChatEmotePayload, ChatSendPayload } from '@2play/shared';
import { chatEmoteSchema, chatSendSchema } from '@2play/shared';
import { parseOrThrow } from '../../utils/validate';
import { requireRoomAndPlayer, safeHandler, type HandlerContext } from './context';

/** `chat:send` — validated, rate limited, spam filtered. */
const send = safeHandler<ChatSendPayload, { sent: boolean }>(async function (
  this: HandlerContext,
  payload,
) {
  const input = parseOrThrow(chatSendSchema, payload, 'chat payload');
  const { room, player } = requireRoomAndPlayer(this);
  this.platform.chatManager.sendMessage(room, player, input.text);
  return { sent: true };
});

/** `chat:emote` — one of the six allowed emotes. */
const emote = safeHandler<ChatEmotePayload, { sent: boolean }>(async function (
  this: HandlerContext,
  payload,
) {
  const input = parseOrThrow(chatEmoteSchema, payload, 'emote payload');
  const { room, player } = requireRoomAndPlayer(this);
  this.platform.chatManager.sendEmote(room, player, input.emote);
  return { sent: true };
});

export function registerChatHandlers(context: HandlerContext): void {
  context.socket.on('chat:send', send.bind(context));
  context.socket.on('chat:emote', emote.bind(context));
}
