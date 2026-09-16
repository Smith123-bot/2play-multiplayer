import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, BarChart3, Heart, LogIn, Plus, RefreshCw, Sparkles, Users, Zap } from 'lucide-react';
import { GameCard } from '../components/game/GameCard';
import { PublicRoomsModal } from '../components/room/PublicRoomsModal';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { GamesLoadError } from '../components/game/GamesLoadError';
import { useGameStore } from '../stores/gameStore';
import { useFavoritesStore } from '../stores/favoritesStore';
import { useStatisticsStore } from '../stores/statisticsStore';
import { usePopularityStore } from '../stores/popularityStore';
import { useSessionStore } from '../stores/sessionStore';
import { useRoomActions } from '../hooks/useRoomActions';
import { usePublicRooms } from '../hooks/usePublicRooms';
import { useIdentityGate } from '../hooks/useIdentityGate';
import { APP_CONFIG } from '../core/config';
import { useConnectionStore } from '../stores/connectionStore';
import { formatCategory } from '../utils/format';
import { cn } from '../utils/cn';

/**
 * Canonical Featured Games order on Home. The `featured` metadata flag decides
 * *membership*; this list decides *position* so the required games always
 * appear in the required order near the top of the page.
 */
export const FEATURED_HOME_ORDER = [
  'draw-guess-battle',
  'rock-paper-scissors',
  'sim',
  'uno',
  'chess',
  'ludo',
  'arrow-puzzle',
  'snake-battle',
  'couple-sync',
  'couple-memory',
  'connect-four',
  'pattern-memory-battle',
  'sos-game',
] as const;

export function HomeScreen() {
  const navigate = useNavigate();
  const gate = useIdentityGate();
  const games = useGameStore((store) => store.games);
  const gamesLoading = useGameStore((store) => store.loading);
  const gamesError = useGameStore((store) => store.error);
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
  const { joinRoom } = useRoomActions();
  /** Live public listing: server pushes keep it fresh, no polling needed. */
  const { rooms: publicRooms, loading: roomsLoading, refresh: refreshRooms } = usePublicRooms();
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const [roomsOpen, setRoomsOpen] = useState(false);

  useEffect(() => {
    void loadGames();
    void loadFavorites();
    void loadStatistics();
    void loadPopularity();
  }, [loadGames, loadFavorites, loadStatistics, loadPopularity]);

  /**
   * Joins a public room straight from Home using the existing Join Room logic,
   * then opens the room — never a detour through the generic Join screen.
   */
  const joinPublicRoom = useCallback(
    (roomId: string) => {
      gate(async () => {
        setJoiningRoomId(roomId);
        try {
          const room = await joinRoom({ roomId });
          if (room) navigate(`/room/${room.id}`);
        } finally {
          setJoiningRoomId((current) => (current === roomId ? null : current));
        }
      });
    },
    [gate, joinRoom, navigate],
  );

  /**
   * Featured games in the canonical order. No game appears in two visible
   * sections: "Popular right now" below explicitly excludes these ids.
   */
  const featured = useMemo(() => {
    const byId = new Map(games.map((game) => [game.id, game]));
    const ordered = FEATURED_HOME_ORDER.map((id) => byId.get(id)).filter(
      (game): game is NonNullable<typeof game> => Boolean(game),
    );
    if (ordered.length > 0) return ordered;
    return games.filter((game) => game.featured);
  }, [games]);
  const featuredIds = useMemo(() => new Set(featured.map((game) => game.id)), [featured]);

  /**
   * "Popular right now" is backed by the platform's real completed-match counts
   * (`/api/games/popularity`). Until the server has recorded any matches there
   * is nothing honest to rank, so it falls back to non-featured catalogue picks
   * and says so — the numbers are never fabricated, and featured games are
   * never duplicated into this section.
   */
  const popular = useMemo(() => {
    const byId = new Map(popularity.map((entry) => [entry.gameId, entry]));
    const ranked = games
      .filter((game) => !featuredIds.has(game.id))
      .filter((game) => (byId.get(game.id)?.playCount ?? 0) > 0)
      .sort((a, b) => (byId.get(b.id)?.playCount ?? 0) - (byId.get(a.id)?.playCount ?? 0))
      .slice(0, 4);
    if (ranked.length > 0) {
      return { games: ranked, counts: byId, real: true };
    }
    return {
      games: games.filter((game) => !featuredIds.has(game.id)).slice(0, 4),
      counts: byId,
      real: false,
    };
  }, [games, popularity, featuredIds]);

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
      <PublicRoomsModal
        open={roomsOpen}
        onClose={() => setRoomsOpen(false)}
        rooms={publicRooms}
        loading={roomsLoading}
        connected={connection === 'CONNECTED'}
        joiningRoomId={joiningRoomId}
        onRefresh={() => void refreshRooms()}
        onJoin={joinPublicRoom}
        onCreateRoom={quickPlay}
      />

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
              variant="create"
              onClick={() => gate(() => navigate('/create'))}
              icon={<Plus className="h-4 w-4" />}
            >
              Create room
            </Button>
            <Button
              size="lg"
              variant="join"
              onClick={() => gate(() => navigate('/join'))}
              icon={<LogIn className="h-4 w-4" />}
            >
              Join room
            </Button>
            <Button
              size="lg"
              variant="rooms"
              onClick={() => setRoomsOpen(true)}
              icon={<Users className="h-4 w-4" />}
            >
              Public rooms
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

      {gamesError && games.length === 0 ? (
        // Without the catalogue every game rail below would silently vanish,
        // so say what happened and offer a retry instead.
        <GamesLoadError
          message={gamesError}
          busy={gamesLoading}
          onRetry={() => void loadGames(true)}
        />
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

      {/* PUBLIC ROOMS — the live lobby list sits directly under the featured
          games: joining an open room is the fastest path into a match. */}
      <section aria-label="Public rooms">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <Users className="h-5 w-5 text-primary-300" /> Public rooms
            {publicRooms.length > 0 ? (
              <span className="rounded-full bg-primary-500/20 px-2 py-0.5 text-xs font-bold text-primary-200">
                {publicRooms.length}
              </span>
            ) : null}
          </h2>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refreshRooms()}
            icon={<RefreshCw className={roomsLoading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />}
          >
            Refresh
          </Button>
        </div>
        {publicRooms.length === 0 ? (
          <Card className="text-center">
            <EmptyState
              icon="🚪"
              title="No public rooms right now"
              description="Create a room and it shows up here for everyone to join."
              action={
                <Button onClick={quickPlay} icon={<Plus className="h-4 w-4" />}>
                  Create a room
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {publicRooms.slice(0, 6).map((room) => (
              <Card key={room.id} hoverable className="flex items-center justify-between gap-3">
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
                        room.playerCount >= room.maxPlayers ? 'text-amber-300' : 'text-emerald-300',
                      )}
                    >
                      {room.playerCount}/{room.maxPlayers}
                    </span>{' '}
                    players · {room.status === 'LOBBY' ? 'Open' : room.status === 'READY' ? 'Starting soon' : 'Waiting'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={joiningRoomId === room.id}
                  onClick={() => joinPublicRoom(room.id)}
                >
                  Join
                </Button>
              </Card>
            ))}
          </div>
        )}
      </section>

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
                  <Badge>{formatCategory(game.category)}</Badge>
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
