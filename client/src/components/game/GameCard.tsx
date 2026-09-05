import { Link } from 'react-router-dom';
import { Heart, Users, Clock, Gauge } from 'lucide-react';
import type { GameMetadata } from '@2play/shared';
import { Badge } from '../ui/Badge';
import { cn } from '../../utils/cn';
import { formatDuration } from '../../utils/format';

export function GameCard({
  game,
  favorite = false,
  onToggleFavorite,
  className,
}: {
  game: GameMetadata;
  favorite?: boolean;
  onToggleFavorite?: (gameId: string) => void;
  className?: string;
}) {
  return (
    <Link
      to={`/games/${game.id}`}
      className={cn('group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface/80 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary-400/60 hover:shadow-lg hover:shadow-primary-500/10', className)}
      aria-label={`Open ${game.name}`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <span
          className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-primary-500/30 via-secondary-500/20 to-accent-500/20 text-3xl transition-transform duration-200 group-hover:scale-110"
          aria-hidden
        >
          {game.thumbnail}
        </span>
        {onToggleFavorite ? (
          <button
            type="button"
            aria-label={favorite ? `Remove ${game.name} from favorites` : `Add ${game.name} to favorites`}
            aria-pressed={favorite}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleFavorite(game.id);
            }}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/10 hover:text-accent"
          >
            <Heart className={cn('h-5 w-5', favorite && 'fill-accent text-accent')} aria-hidden />
          </button>
        ) : null}
      </div>

      <h3 className="text-base font-semibold text-white">{game.name}</h3>
      <p className="mt-1 line-clamp-2 flex-1 text-xs text-slate-400">{game.description}</p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge tone="primary">{game.category}</Badge>
        <Badge icon={<Users className="h-3 w-3" />}>
          {game.minPlayers === game.maxPlayers
            ? `${game.minPlayers}`
            : `${game.minPlayers}-${game.maxPlayers}`}
        </Badge>
        <Badge icon={<Clock className="h-3 w-3" />}>{formatDuration(game.estimatedDuration)}</Badge>
        <Badge icon={<Gauge className="h-3 w-3" />}>{game.difficulty}</Badge>
      </div>
    </Link>
  );
}
