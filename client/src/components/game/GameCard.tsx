import { Link } from 'react-router-dom';
import { Heart, Users, Clock, Gauge, Zap, Home, Link2, ChevronDown } from 'lucide-react';
import type { GameMetadata } from '@2play/shared';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cn } from '../../utils/cn';
import { formatDuration } from '../../utils/format';

export interface GameCardProps {
  game: GameMetadata;
  favorite?: boolean;
  onToggleFavorite?: (gameId: string) => void;
  className?: string;
  /**
   * Inline-expansion mode (spec: "2PLAY — FINAL GAME UX FIX"). When provided,
   * the card renders as a button that expands in place instead of navigating
   * to a separate Game Details page — clicking a game must never require a
   * second "choose a game" step anywhere downstream.
   */
  expanded?: boolean;
  onToggleExpand?: (gameId: string) => void;
  onQuickPlay?: (gameId: string) => void;
  onCreateRoom?: (gameId: string) => void;
  onJoinRoom?: (gameId: string) => void;
  quickPlayBusy?: boolean;
}

export function GameCard({
  game,
  favorite = false,
  onToggleFavorite,
  className,
  expanded,
  onToggleExpand,
  onQuickPlay,
  onCreateRoom,
  onJoinRoom,
  quickPlayBusy = false,
}: GameCardProps) {
  const inlineMode = typeof onToggleExpand === 'function';

  const favoriteButton = onToggleFavorite ? (
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
  ) : null;

  const body = (
    <>
      <div className="mb-3 flex items-start justify-between gap-2">
        <span
          className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-primary-500/30 via-secondary-500/20 to-accent-500/20 text-3xl transition-transform duration-200 group-hover:scale-110"
          aria-hidden
        >
          {game.thumbnail}
        </span>
        <div className="flex items-center gap-1">
          {favoriteButton}
          {inlineMode ? (
            <ChevronDown
              className={cn('h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200', expanded && 'rotate-180 text-primary-300')}
              aria-hidden
            />
          ) : null}
        </div>
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
    </>
  );

  if (!inlineMode) {
    return (
      <Link
        to={`/games/${game.id}`}
        className={cn(
          'group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface/80 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary-400/60 hover:shadow-lg hover:shadow-primary-500/10',
          className,
        )}
        aria-label={`Open ${game.name}`}
      >
        {body}
      </Link>
    );
  }

  return (
    <div
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl border transition-all duration-200',
        expanded
          ? 'border-primary-400/70 bg-surface shadow-lg shadow-primary-500/10'
          : 'border-white/10 bg-surface/80 hover:-translate-y-0.5 hover:border-primary-400/60 hover:shadow-lg hover:shadow-primary-500/10',
        className,
      )}
    >
      <button
        type="button"
        className="flex flex-1 flex-col p-4 text-left"
        aria-expanded={expanded}
        aria-label={expanded ? `Collapse ${game.name}` : `Expand ${game.name}`}
        onClick={() => onToggleExpand(game.id)}
      >
        {body}
      </button>

      {expanded ? (
        <div className="border-t border-white/10 bg-white/[0.02] p-4">
          {game.hasAI && onQuickPlay ? (
            <Button
              size="lg"
              fullWidth
              onClick={() => onQuickPlay(game.id)}
              loading={quickPlayBusy}
              icon={<Zap className="h-5 w-5" />}
              className="mb-3 text-base font-bold shadow-primary-500/40"
            >
              ⚡ QUICK PLAY
            </Button>
          ) : (
            <div
              className="mb-3 flex min-h-touch w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-500"
              aria-disabled="true"
              title={`${game.name} does not have an AI opponent yet.`}
            >
              <Zap className="h-4 w-4" /> Quick Play unavailable
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Button variant="secondary" size="md" onClick={() => onCreateRoom?.(game.id)} icon={<Home className="h-4 w-4" />}>
              🏠 CREATE ROOM
            </Button>
            <Button variant="outline" size="md" onClick={() => onJoinRoom?.(game.id)} icon={<Link2 className="h-4 w-4" />}>
              🔗 JOIN ROOM
            </Button>
          </div>

          <Link
            to={`/games/${game.id}`}
            className="mt-3 inline-block text-xs text-slate-400 underline-offset-2 hover:text-primary-300 hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            How to play →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
