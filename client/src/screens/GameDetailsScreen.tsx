import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Crown, Gamepad2, Heart, KeyRound, Users, Zap } from 'lucide-react';
import { SITE_NAME, buildGameIntro, buildGameSeo, buildNotFoundSeo, gameModesFor, relatedGamesFor } from '@2play/shared';
import { GameCard } from '../components/game/GameCard';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { LoadingBlock } from '../components/ui/Spinner';
import { GamesLoadError } from '../components/game/GamesLoadError';
import { EmptyState } from '../components/ui/EmptyState';
import { useGameStore } from '../stores/gameStore';
import { useFavoritesStore } from '../stores/favoritesStore';
import { useIdentityGate } from '../hooks/useIdentityGate';
import { useRoomActions } from '../hooks/useRoomActions';
import { usePageSeo } from '../seo/usePageSeo';
import { formatCategory, formatDuration } from '../utils/format';

export function GameDetailsScreen() {
  const { gameId = '' } = useParams();
  const navigate = useNavigate();
  const gate = useIdentityGate();
  const games = useGameStore((store) => store.games);
  const gamesError = useGameStore((store) => store.error);
  const load = useGameStore((store) => store.load);
  const favorites = useFavoritesStore((store) => store.favorites);
  const toggleFavorite = useFavoritesStore((store) => store.toggle);
  const { quickPlay } = useRoomActions();
  const [loading, setLoading] = useState(true);
  const [startingAI, setStartingAI] = useState(false);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  const game = games.find((entry) => entry.id === gameId);

  /**
   * Per-page head tags. While the catalogue is still on the wire the head is
   * left untouched (null), so crawlers never see a transient noindex; an
   * invalid id settles on a noindexed "not found" head matching the body.
   */
  const pageSeo = useMemo(() => {
    if (game) return buildGameSeo(game);
    if (loading) return null;
    return buildNotFoundSeo('Game');
  }, [game, loading]);
  usePageSeo(pageSeo);

  if (loading) return <LoadingBlock message="Loading game…" />;

  // Distinguish "that id does not exist" from "the catalogue never arrived",
  // otherwise a network failure reads as a broken deep link.
  if (!game && gamesError) {
    return (
      <GamesLoadError message={gamesError} onRetry={() => void load(true)} />
    );
  }

  if (!game) {
    return (
      <EmptyState
        icon="🎮"
        title="Game not found"
        description={`We could not find a game with id "${gameId}".`}
        action={
          <Link to="/games" className="btn-primary">
            Browse games
          </Link>
        }
      />
    );
  }

  const related = relatedGamesFor(game, games, 3);
  const modes = gameModesFor(game);
  // Structured steps exist for some games; the flat rules are always there.
  const steps = game.howToPlay?.steps ?? null;

  const playWithAI = () =>
    gate(async () => {
      setStartingAI(true);
      const room = await quickPlay({ gameId: game.id });
      setStartingAI(false);
      if (room) navigate(`/room/${room.id}`);
    });

  return (
    <article className="space-y-6" aria-label={`${game.name} on DuoPlay`}>
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
        <Link to="/games" className="inline-flex items-center gap-2 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> All games
        </Link>
        <span aria-hidden>/</span>
        <Link
          to={`/games?category=${game.category}`}
          className="hover:text-white"
          aria-label={`Browse ${formatCategory(game.category)} games`}
        >
          {formatCategory(game.category)} games
        </Link>
        <span aria-hidden>/</span>
        <span className="text-slate-500" aria-current="page">{game.name}</span>
      </nav>

      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-primary-600/25 via-surface/80 to-secondary-500/20 p-6 sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <span
            className="grid h-24 w-24 shrink-0 place-items-center rounded-3xl bg-white/10 text-5xl"
            aria-hidden
          >
            {game.thumbnail}
          </span>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-black text-white">{game.name}</h1>
              <Badge tone="primary">{formatCategory(game.category)}</Badge>
              {game.featured ? <Badge tone="accent">Featured</Badge> : null}
            </div>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">{game.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge icon={<Users className="h-3 w-3" />}>
                {game.minPlayers === game.maxPlayers
                  ? `${game.minPlayers} players`
                  : `${game.minPlayers}-${game.maxPlayers} players`}
              </Badge>
              <Badge icon={<Clock className="h-3 w-3" />}>{formatDuration(game.estimatedDuration)}</Badge>
              <Badge icon={<Gamepad2 className="h-3 w-3" />}>{game.difficulty}</Badge>
              {game.hasAI ? <Badge tone="success">AI opponents</Badge> : null}
            </div>
          </div>
        </div>

        {/*
          Button hierarchy (spec §3/§14): Play with AI is the primary,
          visually strongest action; Create Room and Join Room are secondary.
          Play with AI never routes through Create Room — it starts a real AI
          match directly via the same architecture as Quick Play.
        */}
        <div className="mt-6 flex flex-col gap-3">
          {game.hasAI ? (
            <Button
              size="lg"
              fullWidth
              onClick={playWithAI}
              loading={startingAI}
              icon={<Zap className="h-5 w-5" />}
              className="text-base font-bold shadow-primary-500/40 sm:w-auto"
            >
              Play with AI
            </Button>
          ) : (
            <div
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-500 sm:w-auto"
              aria-disabled="true"
              title={`${game.name} does not have an AI opponent yet.`}
            >
              <Zap className="h-4 w-4" /> Play with AI unavailable
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Button
              size="lg"
              variant="secondary"
              onClick={() => gate(() => navigate(`/create?game=${game.id}`))}
              icon={<Users className="h-4 w-4" />}
            >
              Create room
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => gate(() => navigate(`/join?game=${game.id}`))}
              icon={<KeyRound className="h-4 w-4" />}
            >
              Join room
            </Button>
            <Button
              size="lg"
              variant="ghost"
              onClick={() => void toggleFavorite(game.id)}
              icon={
                <Heart
                  className={favorites.includes(game.id) ? 'h-4 w-4 fill-accent text-accent' : 'h-4 w-4'}
                />
              }
            >
              {favorites.includes(game.id) ? 'Favorited' : 'Favorite'}
            </Button>
          </div>
        </div>
      </section>

      {/* Unique introduction — same metadata that feeds the meta description
          and the JSON-LD, so page, snippet and structured data always agree. */}
      <section
        aria-labelledby={`about-${game.id}`}
        className="rounded-3xl border border-white/10 bg-surface/60 p-6 sm:p-8"
      >
        <h2 id={`about-${game.id}`} className="text-lg font-bold text-white">
          About {game.name}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">
          {buildGameIntro(game)}
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="How to play"
              subtitle={game.howToPlay?.objective ?? game.controls}
            />
            <ol className="space-y-2 text-sm text-slate-300">
              {(steps ?? game.rules).map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-500/20 text-xs font-bold text-primary-200">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </Card>

          {/* The flat rules only repeat the steps when a game ships structured
              steps of its own — showing both then would duplicate content. */}
          {steps ? (
            <Card>
              <CardHeader title="Rules" />
              <ul className="list-disc space-y-2 pl-5 text-sm text-slate-300">
                {game.rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Controls" icon={<Gamepad2 className="h-4 w-4" />} />
            <dl className="space-y-2.5 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Mobile / touch
                </dt>
                <dd className="text-slate-300">{game.howToPlay?.controls?.mobile ?? game.controls}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Desktop
                </dt>
                <dd className="text-slate-300">{game.howToPlay?.controls?.desktop ?? game.controls}</dd>
              </div>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Scoring" />
            <p className="text-sm text-slate-300">{game.scoring}</p>
          </Card>
          <Card>
            <CardHeader title="Win condition" icon={<Crown className="h-4 w-4" />} />
            <p className="text-sm text-slate-300">{game.winCondition}</p>
          </Card>
          <Card>
            <CardHeader title="Game modes" icon={<Users className="h-4 w-4" />} />
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-300">
              {modes.map((mode) => (
                <li key={mode}>{mode}</li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Details" />
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">Category</dt>
                <dd className="font-medium text-white">{formatCategory(game.category)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">Player count</dt>
                <dd className="font-medium text-white">
                  {game.minPlayers === game.maxPlayers
                    ? `${game.minPlayers} players`
                    : `${game.minPlayers}–${game.maxPlayers} players`}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">Supported players</dt>
                <dd className="font-medium text-white">{game.supportedPlayerCounts.join(', ')}</dd>
              </div>
              {game.hasAI ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">AI difficulty</dt>
                  <dd className="font-medium text-white">{game.aiDifficulties.join(', ')}</dd>
                </div>
              ) : null}
              {game.gridOptions ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-400">Board sizes</dt>
                  <dd className="font-medium text-white">{game.gridOptions.join(', ')}</dd>
                </div>
              ) : null}
            </dl>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {game.tags.map((tag) => (
                <Badge key={tag}>#{tag}</Badge>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {related.length > 0 ? (
        <section aria-labelledby="related-games-heading">
          <h2 id="related-games-heading" className="mb-2 text-xl font-bold text-white">
            Related games
          </h2>
          <p className="mb-4 text-sm text-slate-400">
            More {formatCategory(game.category).toLowerCase()} games and other {SITE_NAME}{' '}
            titles you can start in seconds.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((entry) => (
              <GameCard
                key={entry.id}
                game={entry}
                favorite={favorites.includes(entry.id)}
                onToggleFavorite={(id) => void toggleFavorite(id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Last leg of the internal linking chain: game page → real gameplay.
          Descriptive anchors (the hero buttons are actions, not links). */}
      <nav
        aria-label={`Play ${game.name}`}
        className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-3xl border border-white/10 bg-surface/60 p-6 text-sm sm:p-8"
      >
        <span className="font-semibold text-white">Start playing {game.name}:</span>
        <Link
          to={`/create?game=${game.id}`}
          className="font-medium text-primary-300 hover:underline"
        >
          Create a {game.name} room
        </Link>
        <Link
          to={`/join?game=${game.id}`}
          className="font-medium text-primary-300 hover:underline"
        >
          Join a {game.name} room with a code
        </Link>
        <Link to="/games" className="font-medium text-primary-300 hover:underline">
          Explore all games
        </Link>
      </nav>
    </article>
  );
}

export default GameDetailsScreen;
