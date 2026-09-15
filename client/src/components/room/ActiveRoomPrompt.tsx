import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { DoorOpen, LogOut, Users } from 'lucide-react';
import type { RoomStatus } from '@2play/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
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

function statusLabel(status: RoomStatus): string {
  switch (status) {
    case 'WAITING':
    case 'LOBBY':
      return 'Open lobby';
    case 'READY':
      return 'Ready to start';
    case 'COUNTDOWN':
    case 'NEW_MATCH':
      return 'Starting';
    case 'PLAYING':
      return 'Match in progress';
    case 'PAUSED':
      return 'Paused';
    case 'GAME_FINISHED':
    case 'RESULT':
      return 'Match finished';
    case 'REMATCH_WAITING':
      return 'Rematch vote';
    default:
      return status;
  }
}

/**
 * Home-page "you are still in a room" popup (spec §6/§7/§8).
 *
 * The room store is the single, server-authoritative source of truth here:
 * it is only ever populated by real server events (`room:created`,
 * `room:joined`, `room:updated`), including the automatic re-join the server
 * performs on `authenticate` when a session still has a live room. This
 * component never invents room state of its own — it renders nothing when
 * `room` is null and disappears the moment the room is actually left.
 *
 * Persistence: while the room stays active this prompt is ALWAYS available on
 * Home. Closing the dialog only minimises it to a persistent banner with the
 * same Return / Leave actions, so a refresh, a revisit or reopening Home can
 * never strand the player without a way back. Only an intentional Leave (or
 * the room actually closing) removes it.
 */
export function ActiveRoomPrompt() {
  const navigate = useNavigate();
  const room = useRoomStore((store) => store.room);
  const clearRoom = useRoomStore((store) => store.clearRoom);
  const games = useGameStore((store) => store.games);
  const { leaveRoom } = useRoomActions();
  const [leaving, setLeaving] = useState(false);
  const [minimised, setMinimised] = useState<string | null>(null);

  // A new room always starts expanded, even if a previous one was minimised.
  useEffect(() => {
    if (room && minimised && room.id !== minimised) setMinimised(null);
  }, [room, minimised]);

  const stillActive = Boolean(room && ACTIVE_STATUSES.includes(room.status));
  const showDialog = Boolean(stillActive && room && room.id !== minimised);
  const game = room ? games.find((entry) => entry.id === room.gameId) : undefined;

  const returnToRoom = () => {
    if (!room) return;
    // Reuses the existing room state / socket connection — RoomScreen already
    // knows how to pick this room straight back up (restoring via
    // `reconnect:attempt` when needed), so no new room and no new socket
    // connection are created here.
    navigate(`/room/${room.id}`);
  };

  const leave = async () => {
    if (!room) return;
    setLeaving(true);
    const ok = await leaveRoom();
    setLeaving(false);
    if (ok) {
      // Belt-and-braces: leaveRoom() already clears the store on success, but
      // an explicit clear here means the prompt can never linger even if the
      // ack shape ever changes.
      clearRoom();
      setMinimised(room.id);
    }
  };

  if (!room || !stillActive) return null;

  // Minimised but still present: the persistent banner keeps Return / Leave
  // one tap away for as long as the room stays active.
  if (!showDialog) {
    return (
      <Card
        className="flex flex-wrap items-center justify-between gap-3 border-primary-500/30 bg-primary-500/10"
        data-testid="active-room-banner"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-500/20 text-lg">
            🚪
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              You are in room <span className="font-mono tracking-wider">{room.id}</span>
            </p>
            <p className="truncate text-xs text-slate-300">
              {game?.name ?? room.gameId} · {room.players.length}/{room.maxPlayers} players ·{' '}
              {statusLabel(room.status)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setMinimised(null)}
            icon={<DoorOpen className="h-4 w-4" />}
          >
            Details
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void leave()}
            loading={leaving}
            icon={<LogOut className="h-4 w-4" />}
          >
            Leave room
          </Button>
          <Button size="sm" onClick={returnToRoom}>
            Return to room
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Modal
      open={showDialog}
      onClose={() => setMinimised(room.id)}
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
          <span className="text-slate-400">Room code</span>
          <span className="font-mono font-semibold tracking-widest text-white">{room.id}</span>
        </div>
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
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
          <span className="text-slate-400">Status</span>
          <Badge tone={room.status === 'PLAYING' ? 'success' : 'default'}>
            {statusLabel(room.status)}
          </Badge>
        </div>
        {room.players.length > 0 ? (
          <p className="truncate px-1 text-xs text-slate-400">
            {room.players.map((player) => player.nickname).join(' · ')}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

export default ActiveRoomPrompt;
