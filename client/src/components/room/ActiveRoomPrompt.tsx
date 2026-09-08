import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { LogOut, Users } from 'lucide-react';
import type { RoomStatus } from '@2play/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useRoomStore } from '../../stores/roomStore';
import { useGameStore } from '../../stores/gameStore';
import { useRoomActions } from '../../hooks/useRoomActions';

/** Every room status except `CLOSED` — matches `ROOM_STATUSES` in shared. */
const ACTIVE_STATUSES: RoomStatus[] = [
  'WAITING',
  'LOBBY',
  'READY',
  'COUNTDOWN',
  'PLAYING',
  'PAUSED',
  'GAME_FINISHED',
  'RESULT',
  'REMATCH_WAITING',
  'NEW_MATCH',
];

/**
 * Home-page "you are still in a room" popup (spec §6/§7/§8).
 *
 * The room store is the single, server-authoritative source of truth here:
 * it is only ever populated by real server events (`room:created`,
 * `room:joined`, `room:updated`), including the automatic re-join the server
 * performs on `authenticate` when a session still has a live room. This
 * component never invents room state of its own — it renders nothing when
 * `room` is null and disappears the moment the room is actually left.
 */
export function ActiveRoomPrompt() {
  const navigate = useNavigate();
  const room = useRoomStore((store) => store.room);
  const clearRoom = useRoomStore((store) => store.clearRoom);
  const games = useGameStore((store) => store.games);
  const { leaveRoom } = useRoomActions();
  const [leaving, setLeaving] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const active = Boolean(room && ACTIVE_STATUSES.includes(room.status) && room.id !== dismissed);
  const game = room ? games.find((entry) => entry.id === room.gameId) : undefined;

  const returnToRoom = () => {
    if (!room) return;
    // Reuses the existing room state / socket connection — RoomScreen already
    // knows how to pick this room straight back up, no new room and no new
    // socket connection are created here.
    navigate(`/room/${room.id}`);
  };

  const leave = async () => {
    if (!room) return;
    setLeaving(true);
    const ok = await leaveRoom();
    setLeaving(false);
    if (ok) {
      // Belt-and-braces: leaveRoom() already clears the store on success, but
      // an explicit clear here means the popup can never linger even if the
      // ack shape ever changes.
      clearRoom();
      setDismissed(room.id);
    }
  };

  if (!room) return null;

  return (
    <Modal
      open={active}
      onClose={() => setDismissed(room.id)}
      closeOnBackdrop={false}
      title="You are in a room"
      description={`Room code: ${room.id}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => void leave()} loading={leaving} icon={<LogOut className="h-4 w-4" />}>
            Leave room
          </Button>
          <Button onClick={returnToRoom}>Return to room</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
          <span className="text-slate-400">Game</span>
          <span className="font-medium text-white">{game?.name ?? room.gameId}</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
          <span className="text-slate-400">Players</span>
          <Badge tone="primary" icon={<Users className="h-3 w-3" />}>
            {room.players.length}/{room.maxPlayers}
          </Badge>
        </div>
      </div>
    </Modal>
  );
}

export default ActiveRoomPrompt;
