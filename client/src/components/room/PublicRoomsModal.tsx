import { RefreshCw, Users } from 'lucide-react';
import type { RoomSummary } from '@2play/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Spinner } from '../ui/Spinner';
import { cn } from '../../utils/cn';

export interface PublicRoomsModalProps {
  open: boolean;
  onClose: () => void;
  /** Live public listing (server pushes) — public summaries only, never private rooms. */
  rooms: RoomSummary[];
  loading: boolean;
  connected: boolean;
  joiningRoomId: string | null;
  onRefresh: () => void;
  onJoin: (roomId: string) => void;
  onCreateRoom: () => void;
}

function statusLabel(status: RoomSummary['status']): string {
  if (status === 'LOBBY') return 'Open';
  if (status === 'READY') return 'Starting soon';
  return 'Waiting';
}

export function PublicRoomsModal({
  open,
  onClose,
  rooms,
  loading,
  connected,
  joiningRoomId,
  onRefresh,
  onJoin,
  onCreateRoom,
}: PublicRoomsModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary-300" aria-hidden />
          Public rooms
          {rooms.length > 0 ? (
            <span className="rounded-full bg-primary-500/20 px-2 py-0.5 text-xs font-bold text-primary-200">
              {rooms.length}
            </span>
          ) : null}
        </span>
      }
      description="Open rooms anyone can join. The list updates live — no refresh needed."
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            icon={<RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />}
          >
            Refresh
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {!connected ? (
        <EmptyState
          icon="📡"
          title="Connection lost"
          description="The live room list needs a server connection. Check your network and retry."
          action={<Button onClick={onRefresh}>Retry</Button>}
        />
      ) : loading && rooms.length === 0 ? (
        <div className="grid place-items-center gap-3 py-10 text-center">
          <Spinner />
          <p className="text-sm text-slate-400">Finding open rooms…</p>
        </div>
      ) : rooms.length === 0 ? (
        <EmptyState
          icon="🚪"
          title="No public rooms right now"
          description="Create a room and it shows up here for everyone to join."
          action={<Button onClick={onCreateRoom}>Create a room</Button>}
        />
      ) : (
        <ul className="space-y-3">
          {rooms.map((room) => (
            <li
              key={room.id}
              className="card flex items-center justify-between gap-3 !p-3"
              data-testid={`public-room-${room.id}`}
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-white">{room.gameName}</p>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                  <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] tracking-wider text-slate-300">
                    {room.id.slice(0, 6).toUpperCase()}
                  </span>
                  <span className="truncate">Host {room.hostNickname}</span>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  <span
                    className={cn(
                      'font-semibold',
                      room.playerCount >= room.maxPlayers
                        ? 'text-amber-300'
                        : 'text-emerald-300',
                    )}
                  >
                    {room.playerCount}/{room.maxPlayers}
                  </span>{' '}
                  players · {statusLabel(room.status)}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                loading={joiningRoomId === room.id}
                onClick={() => onJoin(room.id)}
              >
                Join
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
