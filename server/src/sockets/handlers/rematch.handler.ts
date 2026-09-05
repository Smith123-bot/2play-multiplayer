import type { RematchStatusPayload } from '@2play/shared';
import { requireRoomAndPlayer, safeHandler, type HandlerContext } from './context';

function statusPayload(context: HandlerContext): RematchStatusPayload {
  const { room } = requireRoomAndPlayer(context);
  const voters = room.rematchVoters;
  const pending = voters.filter((player) => room.rematchVotes.get(player.id) !== true);
  return {
    roomId: room.id,
    votes: Object.fromEntries(room.rematchVotes.entries()),
    pending: pending.map((player) => player.nickname),
    expiresAt: room.rematchDeadline,
    required: voters.length,
  };
}

/** `rematch:request` — vote YES for another match. */
const request = safeHandler<Record<string, never>, RematchStatusPayload>(async function (
  this: HandlerContext,
) {
  const { room, player } = requireRoomAndPlayer(this);
  this.platform.rematchManager.vote(room, player.id, true);
  return statusPayload(this);
});

/** `rematch:cancel` — withdraw your vote. */
const cancel = safeHandler<Record<string, never>, RematchStatusPayload>(async function (
  this: HandlerContext,
) {
  const { room, player } = requireRoomAndPlayer(this);
  this.platform.rematchManager.cancel(room, player.id);
  return statusPayload(this);
});

export function registerRematchHandlers(context: HandlerContext): void {
  context.socket.on('rematch:request', request.bind(context));
  context.socket.on('rematch:cancel', cancel.bind(context));
}
