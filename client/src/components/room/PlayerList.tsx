import { Crown, UserMinus, WifiOff } from 'lucide-react';
import type { Player } from '@2play/shared';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { cn } from '../../utils/cn';

export interface PlayerListProps {
  players: Player[];
  myPlayerId: string | null;
  hostPlayerId: string;
  canKick: boolean;
  onKick?: (playerId: string) => void;
  showScore?: boolean;
  currentTurnPlayerId?: string | null;
  className?: string;
}

export function PlayerList({
  players,
  myPlayerId,
  canKick,
  onKick,
  showScore = false,
  currentTurnPlayerId,
  className,
}: PlayerListProps) {
  return (
    <ul className={cn('grid gap-2', className)} aria-label="Players in room">
      {players.map((player) => {
        const isTurn = currentTurnPlayerId === player.id;
        return (
          <li
            key={player.id}
            className={cn(
              'flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors',
              isTurn
                ? 'border-primary-400/60 bg-primary-500/10'
                : 'border-white/5 bg-white/[0.03]',
            )}
          >
            <Avatar emoji={player.avatar} nickname={player.nickname} ring={isTurn} />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate font-medium text-white">
                  {player.nickname}
                  {player.id === myPlayerId ? <span className="ml-1 text-xs text-slate-400">(you)</span> : null}
                </span>
                {player.isHost ? (
                  <Badge tone="warning" icon={<Crown className="h-3 w-3" />}>
                    Host
                  </Badge>
                ) : null}
                {player.isAI ? <Badge tone="accent">AI {player.aiDifficulty ?? ''}</Badge> : null}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs">
                {player.isDisconnected ? (
                  <span className="inline-flex items-center gap-1 text-danger">
                    <WifiOff className="h-3 w-3" aria-hidden />
                    Reconnecting…
                  </span>
                ) : showScore ? (
                  <span className="tabular-nums text-slate-400">{player.score} pts</span>
                ) : (
                  <span className={player.isReady ? 'text-success' : 'text-slate-400'}>
                    {player.isAI ? 'Always ready' : player.isReady ? 'Ready' : 'Not ready'}
                  </span>
                )}
              </div>
            </div>

            {showScore ? (
              <span className="text-lg font-bold tabular-nums text-white">{player.score}</span>
            ) : null}

            {canKick && !player.isHost && onKick ? (
              <button
                type="button"
                onClick={() => onKick(player.id)}
                aria-label={`Remove ${player.nickname}`}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 transition hover:bg-danger/10 hover:text-danger"
              >
                <UserMinus className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
