import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, BarChart3, Heart, Plus, Sparkles, Users, Zap } from 'lucide-react';
import { GameCard } from '../components/game/GameCard';
import { ActiveRoomPrompt } from '../components/room/ActiveRoomPrompt';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { useGameStore } from '../stores/gameStore';
import { useFavoritesStore } from '../stores/favoritesStore';
import { useStatisticsStore } from '../stores/statisticsStore';
import { usePopularityStore } from '../stores/popularityStore';
import { useSessionStore } from '../stores/sessionStore';
import { useRoomActions } from '../hooks/useRoomActions';
import { useIdentityGate } from '../hooks/useIdentityGate';
import type { RoomSummary } from '@2play/shared';
import { APP_CONFIG } from '../core/config';
import { useConnectionStore } from '../stores/connectionStore';

export function HomeScreen() {
  const navigate = useNavigate();
  const gate = useIdentityGate();
  const games = useGameStore((store) => store.games);
  const loadGames = useGameStore((store) => store.load);
  const favorites = useFavoritesStore((store) => store.favorites);
  const loadFavorites = useFavoritesStore((store) => store.load);
  const toggleFavorite = useFavoritesStore((store) => store.toggle);
  const recentlyPlayed = useSessionStore((store) => store.recentlyPlayed);
  const summary = useStatisticsStore((store) => store.summary);
  const loadStatistics = useStatisticsStore((store) => store.load);
  const popularity = usePopularityStore((store) => store.popularity);
  const loadPopularity = usePopularityStore((store) => store.load);
  const connection = useConnectionStore((store) => store.state);
  const { listRooms } = useRoomActions();
  const [publicRooms, setPublicRooms] = useState<RoomSummary[]>([]);

  useEffect(() => {
    void loadGames();
    void loadFavorites();
    void loadStatistics();
    void loadPopularity();
  }, [loadGames, loadFavorites, loadStatistics, loadPopularity]);

  useEffect(() => {
    let active = true;
    void listRooms().then((rooms) => {
      if (active) setPublicRooms(rooms);
    });
    return () => {
      active = false;
    };
  }, [listRooms]);

  const featured = games.filter((game) => game.featured);

  /**
   * "Popular right now" is backed by the platform's real completed-match counts
   * (`/api/games/popularity`). Until the server has recorded any matches there
   * is nothing honest to rank, so it falls back to the featured picks and says
   * so — the numbers are never fabricated.
   */
  const popular = useMemo(() => {
    const byId = new Map(popularity.map((entry) => [entry.gameId, entry]));
    const ranked = games
      .filter((game) => (byId.get(game.id)?.playCount ?? 0) > 0)
      .sort((a, b) => (byId.get(b.id)?.playCount ?? 0) - (byId.get(a.id)?.playCount ?? 0))
      .slice(0, 4);
    if (ranked.length > 0) {
      return { games: ranked, counts: byId, real: true };
    }
    return {
      games: (featured.length > 0 ? featured : games).slice(0, 4),
      counts: byId,
      real: false,
    };
  }, [games, popularity, featured]);

  const recent = recentlyPlayed
    .map((gameId) => games.find((game) => game.id === gameId))
    .filter((game): game is NonNullable<typeof game> => Boolean(game));
  const favoriteGames = games.filter((game) => favorites.includes(game.id));

  const quickPlay = () =>
    gate(() => {
      const target = featured[0] ?? games[0];
      if (target) navigate(`/create?game=${target.id}`);
    });

  return (
    <div className="space-y-10">
      <ActiveRoomPrompt />

      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-primary-600/25 via-surface/70 to-accent-500/20 p-6 sm:p-10">
        <div className="grid-glow absolute inset-0 opacity-40" aria-hidden />
        <div className="relative max-w-2xl">
          <Badge tone="primary" icon={<Sparkles className="h-3 w-3" />}>
            {APP_CONFIG.name} v{APP_CONFIG.version}
          </Badge>
          <h1 className="mt-4 text-4xl font-black leading-tight text-white sm:text-5xl">
            Play Together,
            <span className="text-gradient"> Anywhere.</span>
          </h1>
          <p className="mt-3 max-w-xl text-base text-slate-300">
            Instant 2D multiplayer games for two to four players. Create a room, share the six
            character code and play in the browser — no installs, no downloads.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button size="lg" onClick={quickPlay} icon={<Zap className="h-4 w-4" />}>
              Play now
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => gate(() => navigate('/create'))}
              icon={<Plus className="h-4 w-4" />}
            >
              Create room
            </Button>
            <Button size="lg" variant="ghost" onClick={() => gate(() => navigate('/join'))}>
              Join room
            </Button>
          </div>

          <p className="mt-4 text-xs text-slate-400">
            Status:{' '}
            <span className={connection === 'CONNECTED' ? 'text-success' : 'text-warning'}>
              {connection === 'CONNECTED' ? 'Connected to the game server' : 'Connecting…'}
            </span>
          </p>
        </div>
      </section>

      {summary && summary.totalPlayed > 0 ? (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Matches', value: summary.totalPlayed },
            { label: 'Wins', value: summary.wins },
            { label: 'Win rate', value: `${summary.winRate}%` },
            { label: 'Draws', value: summary.draws },
          ].map((stat) => (
            <Card key={stat.label} className="text-center">
              <p className="stat-value">{stat.value}</p>
              <p className="stat-label">{stat.label}</p>
            </Card>
          ))}
        </section>
      ) : null}

      {featured.length > 0 ? (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">Featured games</h2>
            <Link to="/games" className="inline-flex items-center gap-1 text-sm text-primary-300 hover:underline">
              All games <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((game, index) => (
              <motion.div
                key={game.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <GameCard
                  game={game}
                  favorite={favorites.includes(game.id)}
                  onToggleFavorite={(gameId) => void toggleFavorite(gameId)}
                />
              </motion.div>
            ))}
          </div>
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section>
          <h2 className="mb-4 text-xl font-bold text-white">Recently played</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {recent.slice(0, 4).map((game) => (
              <GameCard
                key={game.id}
                game={game}
                favorite={favorites.includes(game.id)}
                onToggleFavorite={(gameId) => void toggleFavorite(gameId)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {favoriteGames.length > 0 ? (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-xl font-bold text-white">
              <Heart className="h-5 w-5 text-accent" /> Favorites
            </h2>
            <Link to="/favorites" className="text-sm text-primary-300 hover:underline">
              See all
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {favoriteGames.slice(0, 4).map((game) => (
              <GameCard
                key={game.id}
                game={game}
                favorite
                onToggleFavorite={(gameId) => void toggleFavorite(gameId)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {publicRooms.length > 0 ? (
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-white">
            <Users className="h-5 w-5 text-primary-300" /> Public rooms
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {publicRooms.slice(0, 6).map((room) => (
              <Card key={room.id} hoverable className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white">{room.gameName}</p>
                  <p className="text-xs text-slate-400">
                    Host {room.hostNickname} · {room.playerCount}/{room.maxPlayers}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => gate(() => navigate(`/join?code=${room.id}`))}
                >
                  Join
                </Button>
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader
            title="Popular right now"
            subtitle={
              popular.real ? 'Most played across 2PLAY' : 'Hand-picked quick matches'
            }
          />
          <ul className="space-y-2">
            {popular.games.map((game) => (
              <li key={game.id} className="flex items-center justify-between gap-3">
                <Link to={`/games/${game.id}`} className="flex min-w-0 items-center gap-2">
                  <span className="text-xl" aria-hidden>
                    {game.icon}
                  </span>
                  <span className="truncate text-sm text-slate-200">{game.name}</span>
                </Link>
                {popular.real ? (
                  <Badge tone="primary">
                    {popular.counts.get(game.id)?.playCount ?? 0} played
                  </Badge>
                ) : (
                  <Badge>{game.category}</Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Your stats" subtitle="Win rates across every game" />
          {summary ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Total matches</span>
                <span className="font-semibold text-white">{summary.totalPlayed}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Wins</span>
                <span className="font-semibold text-success">{summary.wins}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Losses</span>
                <span className="font-semibold text-danger">{summary.losses}</span>
              </div>
              <Link to="/stats" className="btn-secondary w-full">
                <BarChart3 className="h-4 w-4" /> Open statistics
              </Link>
            </div>
          ) : (
            <EmptyState
              icon="📊"
              title="No matches yet"
              description="Play your first match to start tracking statistics."
            />
          )}
        </Card>
      </section>
    </div>
  );
}

export default HomeScreen;
