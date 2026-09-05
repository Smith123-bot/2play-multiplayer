import { Clock } from 'lucide-react';
import type { Player } from '@2play/shared';
import { Avatar } from '../ui/Avatar';
import { useServerDeadline } from '../../hooks/useCountdown';
import { cn } from '../../utils/cn';

export interface GameHUDProps {
  players: Player[];
  myPlayerId: string | null;
  currentTurnPlayerId?: string | null;
  /** Server deadline (ms) for the current round/question. */
  deadline?: number | null;
  label?: string;
  className?: string;
}

/** Shared HUD: live scores, turn indicator and the server-owned timer. */
export function GameHUD({
  players,
  myPlayerId,
  currentTurnPlayerId,
  deadline = null,
  label,
  className,
}: GameHUDProps) {
  const remaining = useServerDeadline(deadline);
  const seconds = deadline ? Math.ceil(remaining / 1000) : null;
  const urgent = seconds !== null && seconds <= 5;

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {players.map((player) => {
          const isTurn = currentTurnPlayerId === player.id;
          return (
            <div
              key={player.id}
              className={cn(
                'flex min-w-[132px] flex-1 items-center gap-2 rounded-xl border px-3 py-2 transition-colors',
                isTurn ? 'border-primary-400/60 bg-primary-500/10' : 'border-white/5 bg-white/[0.03]',
                player.isDisconnected && 'opacity-60',
              )}
            >
              <Avatar emoji={player.avatar} nickname={player.nickname} size="sm" ring={isTurn} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-slate-200">
                  {player.nickname}
                  {player.id === myPlayerId ? ' (you)' : ''}
                </p>
                <p className="text-lg font-bold leading-tight tabular-nums text-white">{player.score}</p>
              </div>
              {player.isDisconnected ? (
                <span className="text-[10px] text-danger">offline</span>
              ) : isTurn ? (
                <span className="text-[10px] uppercase tracking-wide text-primary-300">turn</span>
              ) : null}
            </div>
          );
        })}
      </div>

      {seconds !== null ? (
        <div
          className={cn(
            'flex items-center justify-between gap-2 rounded-xl border px-3 py-2',
            urgent ? 'border-danger/50 bg-danger/10' : 'border-white/5 bg-white/[0.03]',
          )}
          role="timer"
          aria-live="off"
        >
          <span className="text-xs text-slate-400">{label ?? 'Time left'}</span>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums',
              urgent ? 'text-danger' : 'text-slate-200',
            )}
          >
            <Clock className="h-4 w-4" aria-hidden />
            {seconds}s
          </span>
        </div>
      ) : null}
    </div>
  );
}
