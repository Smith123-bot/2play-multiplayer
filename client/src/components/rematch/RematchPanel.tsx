import { Clock, RotateCcw, X } from 'lucide-react';
import type { Player, RoomState } from '@2play/shared';
import { Button } from '../ui/Button';
import { Avatar } from '../ui/Avatar';
import { useServerDeadline } from '../../hooks/useCountdown';
import { cn } from '../../utils/cn';

export interface RematchPanelProps {
  room: RoomState;
  myPlayerId: string | null;
  onRequest: () => void;
  onCancel: () => void;
  onLeave: () => void;
  busy?: boolean;
}

/**
 * Server-authoritative rematch voting: every connected player must vote YES,
 * the 60 second window is driven by the server timer.
 */
export function RematchPanel({ room, myPlayerId, onRequest, onCancel, onLeave, busy }: RematchPanelProps) {
  const voters = room.players.filter((player) => !player.isAI && player.isConnected);
  const myVote = myPlayerId ? room.rematchVotes[myPlayerId] : undefined;
  const remaining = useServerDeadline(room.rematchDeadline);
  const seconds = Math.ceil(remaining / 1000);
  const yesCount = voters.filter((player) => room.rematchVotes[player.id] === true).length;

  return (
    <section className="card p-4 sm:p-5" aria-label="Rematch">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Play again?</h3>
          <p className="mt-0.5 text-sm text-slate-400">
            {yesCount}/{voters.length} players ready
            {room.rematchDeadline ? (
              <span className="ml-2 inline-flex items-center gap-1 tabular-nums text-slate-400">
                <Clock className="h-3.5 w-3.5" aria-hidden />
                {seconds}s
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {myVote === true ? (
            <Button variant="secondary" onClick={onCancel} disabled={busy} icon={<X className="h-4 w-4" />}>
              Cancel vote
            </Button>
          ) : (
            <Button onClick={onRequest} disabled={busy} icon={<RotateCcw className="h-4 w-4" />}>
              Rematch
            </Button>
          )}
          <Button variant="ghost" onClick={onLeave} disabled={busy}>
            Leave room
          </Button>
        </div>
      </div>

      <ul className="mt-4 flex flex-wrap gap-2" aria-label="Rematch votes">
        {voters.map((player: Player) => {
          const voted = room.rematchVotes[player.id] === true;
          return (
            <li
              key={player.id}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors',
                voted ? 'border-success/50 bg-success/10 text-emerald-300' : 'border-white/10 bg-white/5 text-slate-400',
              )}
            >
              <Avatar emoji={player.avatar} nickname={player.nickname} size="sm" className="h-6 w-6 text-xs" />
              <span className="font-medium text-slate-200">{player.nickname}</span>
              <span aria-label={voted ? 'voted yes' : 'waiting'}>{voted ? '✓' : '…'}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
