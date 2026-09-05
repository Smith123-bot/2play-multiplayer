import { motion } from 'framer-motion';
import { Crown, Medal, Trophy } from 'lucide-react';
import type { GameResult, Player } from '@2play/shared';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cn } from '../../utils/cn';
import { formatDuration } from '../../utils/format';

export function ResultPanel({
  result,
  players,
  myPlayerId,
  className,
}: {
  result: GameResult;
  players: Player[];
  myPlayerId: string | null;
  className?: string;
}) {
  if (!result) return null;

  const myRanking = result.rankings.find((entry) => entry.playerId === myPlayerId);
  const isWinner = result.winners.includes(myPlayerId ?? '');
  const headline = result.isDraw
    ? 'Draw!'
    : isWinner
      ? 'You win!'
      : `${result.rankings.find((entry) => entry.playerId === result.winners[0])?.nickname ?? 'Someone'} wins!`;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('card overflow-hidden', className)}
      aria-label="Match result"
    >
      <div
        className={cn(
          'px-5 py-6 text-center',
          result.isDraw
            ? 'bg-gradient-to-br from-slate-600/30 to-slate-800/30'
            : isWinner
              ? 'bg-gradient-to-br from-success/25 to-primary-500/20'
              : 'bg-gradient-to-br from-secondary-500/20 to-slate-800/30',
        )}
      >
        <div className="mx-auto mb-2 grid h-14 w-14 place-items-center rounded-2xl bg-white/10 text-3xl" aria-hidden>
          {result.isDraw ? '🤝' : isWinner ? <Trophy className="h-7 w-7 text-amber-300" /> : '🎮'}
        </div>
        <h2 className="text-2xl font-bold text-white">{headline}</h2>
        <p className="mt-1 text-sm text-slate-300">
          Match #{result.matchNumber} · {formatDuration(result.durationSeconds)}
          {myRanking ? ` · You finished ${myRanking.rank}${myRanking.rank === 1 ? 'st' : myRanking.rank === 2 ? 'nd' : myRanking.rank === 3 ? 'rd' : 'th'}` : ''}
        </p>
      </div>

      <ol className="divide-y divide-white/5">
        {result.rankings.map((entry, index) => (
          <li key={entry.playerId} className="flex items-center gap-3 px-4 py-3">
            <span
              className={cn(
                'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-bold',
                index === 0
                  ? 'bg-amber-400/20 text-amber-300'
                  : index === 1
                    ? 'bg-slate-300/20 text-slate-200'
                    : index === 2
                      ? 'bg-orange-500/20 text-orange-300'
                      : 'bg-white/5 text-slate-400',
              )}
              aria-label={`Rank ${entry.rank}`}
            >
              {index === 0 ? <Crown className="h-4 w-4" /> : <Medal className="h-4 w-4" />}
            </span>
            <Avatar emoji={entry.avatar} nickname={entry.nickname} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {entry.nickname}
                {entry.playerId === myPlayerId ? <span className="ml-1 text-xs text-slate-400">(you)</span> : null}
              </p>
              <p className="text-xs text-slate-400">
                {entry.isAI ? 'AI opponent · ' : ''}
                {Object.entries(entry.stats)
                  .slice(0, 3)
                  .map(([key, value]) => `${key.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${value}`)
                  .join(' · ') || 'No extra stats'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold tabular-nums text-white">{entry.score}</p>
              {entry.isWinner ? <Badge tone="success">Winner</Badge> : null}
              {entry.isDraw && !result.isDraw ? null : null}
            </div>
          </li>
        ))}
      </ol>

      {players.length === 0 ? null : (
        <div className="border-t border-white/5 px-4 py-3 text-xs text-slate-400">
          Rankings are computed by the server — clients never decide the winner.
        </div>
      )}
    </motion.section>
  );
}

export function ResultActions({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="flex flex-col gap-2 sm:flex-row">{children}</div>;
}

export { Button };
