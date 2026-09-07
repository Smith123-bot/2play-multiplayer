import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Flame, Search, Sparkles, SlidersHorizontal, Heart, Gamepad2 } from 'lucide-react';
import type { GameCategory, GameDifficulty, GameMetadata } from '@2play/shared';
import { GAME_CATEGORIES } from '@2play/shared';
import { GameCard } from '../components/game/GameCard';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Badge } from '../components/ui/Badge';
import { LoadingBlock } from '../components/ui/Spinner';
import { useGameStore } from '../stores/gameStore';
import { useFavoritesStore } from '../stores/favoritesStore';
import { usePopularityStore } from '../stores/popularityStore';
import { useRoomActions } from '../hooks/useRoomActions';
import { useIdentityGate } from '../hooks/useIdentityGate';
import { cn } from '../utils/cn';

type SortKey = 'featured' | 'name' | 'duration' | 'players';

/**
 * A single game grid, reused by every section so "click to expand inline"
 * behaves identically everywhere (spec: only one card expanded at a time).
 */
function GameGrid({
  games,
  favorites,
  onToggleFavorite,
  expandedGameId,
  onToggleExpand,
  onQuickPlay,
  onCreateRoom,
  onJoinRoom,
  quickPlayBusyId,
}: {
  games: GameMetadata[];
  favorites: string[];
  onToggleFavorite: (gameId: string) => void;
  expandedGameId: string | null;
  onToggleExpand: (gameId: string) => void;
  onQuickPlay: (gameId: string) => void;
  onCreateRoom: (gameId: string) => void;
  onJoinRoom: (gameId: string) => void;
  quickPlayBusyId: string | null;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {games.map((game) => (
        <GameCard
          key={game.id}
          game={game}
          favorite={favorites.includes(game.id)}
          onToggleFavorite={onToggleFavorite}
          expanded={expandedGameId === game.id}
          onToggleExpand={onToggleExpand}
          onQuickPlay={onQuickPlay}
          onCreateRoom={onCreateRoom}
          onJoinRoom={onJoinRoom}
          quickPlayBusy={quickPlayBusyId === game.id}
          className={expandedGameId === game.id ? 'sm:col-span-2 lg:col-span-2' : undefined}
        />
      ))}
    </div>
  );
}

export function GameBrowserScreen() {
  const navigate = useNavigate();
  const gate = useIdentityGate();
  const games = useGameStore((store) => store.games);
  const loading = useGameStore((store) => store.loading);
  const loadGames = useGameStore((store) => store.load);
  const favorites = useFavoritesStore((store) => store.favorites);
  const toggleFavorite = useFavoritesStore((store) => store.toggle);
  const loadFavorites = useFavoritesStore((store) => store.load);
  const popularity = usePopularityStore((store) => store.popularity);
  const loadPopularity = usePopularityStore((store) => store.load);
  const { quickPlay } = useRoomActions();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<GameCategory | 'all'>('all');
  const [players, setPlayers] = useState<'all' | '2' | '3' | '4'>('all');
  const [difficulty, setDifficulty] = useState<GameDifficulty | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('featured');
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  // Inline card expansion (spec: exactly one game expanded at a time, on the
  // same Games page — never navigate to a separate details/selection page).
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null);
  const [quickPlayBusyId, setQuickPlayBusyId] = useState<string | null>(null);

  useEffect(() => {
    void loadGames();
    void loadFavorites();
    void loadPopularity();
  }, [loadGames, loadFavorites, loadPopularity]);

  const toggleExpand = (gameId: string) => {
    setExpandedGameId((current) => (current === gameId ? null : gameId));
  };

  const startQuickPlay = (gameId: string) => {
    gate(async () => {
      setQuickPlayBusyId(gameId);
      const room = await quickPlay({ gameId });
      setQuickPlayBusyId(null);
      if (room) navigate(`/room/${room.id}`);
    });
  };

  const openCreateRoom = (gameId: string) => {
    gate(() => navigate(`/create?game=${gameId}`));
  };

  const openJoinRoom = (gameId: string) => {
    gate(() => navigate(`/join?game=${gameId}`));
  };

  const searchActive =
    query.trim().length > 0 ||
    category !== 'all' ||
    players !== 'all' ||
    difficulty !== 'all' ||
    favoritesOnly;

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return games
      .filter((game) => (category === 'all' ? true : game.category === category))
      .filter((game) => (players === 'all' ? true : game.supportedPlayerCounts.includes(Number(players))))
      .filter((game) => (difficulty === 'all' ? true : game.difficulty === difficulty))
      .filter((game) => (favoritesOnly ? favorites.includes(game.id) : true))
      .filter((game) =>
        needle.length === 0
          ? true
          : `${game.name} ${game.id} ${game.category} ${game.description} ${game.tags.join(' ')}`
              .toLowerCase()
              .includes(needle),
      )
      .sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name);
        if (sort === 'duration') return a.estimatedDuration - b.estimatedDuration;
        if (sort === 'players') return a.minPlayers - b.minPlayers;
        return (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
      });
  }, [games, query, category, players, difficulty, sort, favoritesOnly, favorites]);

  // 🔥 Most Played — real, platform-wide statistics only. Never fabricated:
  // games with zero recorded matches simply do not appear here (they still
  // show up in All Games).
  const mostPlayed = useMemo(() => {
    const byId = new Map(popularity.map((entry) => [entry.gameId, entry]));
    return games
      .filter((game) => (byId.get(game.id)?.playCount ?? 0) > 0)
      .sort((a, b) => (byId.get(b.id)?.playCount ?? 0) - (byId.get(a.id)?.playCount ?? 0))
      .slice(0, 6);
  }, [games, popularity]);

  // 🆕 New Games — driven purely by registration order from the Game
  // Registry (the order `/api/games` returns them in), never a hardcoded
  // list. Any newly registered game automatically appears here.
  const newGames = useMemo(() => games.slice(-6).reverse(), [games]);

  const favoriteGames = useMemo(() => games.filter((game) => favorites.includes(game.id)), [games, favorites]);

  const reset = () => {
    setQuery('');
    setCategory('all');
    setPlayers('all');
    setDifficulty('all');
    setFavoritesOnly(false);
    setSort('featured');
  };

  const gridProps = {
    favorites,
    onToggleFavorite: (gameId: string) => void toggleFavorite(gameId),
    expandedGameId,
    onToggleExpand: toggleExpand,
    onQuickPlay: startQuickPlay,
    onCreateRoom: openCreateRoom,
    onJoinRoom: openJoinRoom,
    quickPlayBusyId,
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white">Games</h1>
          <p className="mt-1 text-sm text-slate-400">
            {games.length} games · {favorites.length} favorites — tap a game to play
          </p>
        </div>
      </header>

      <section className="card space-y-3 p-4">
        <Input
          label="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, id, category or tag…"
          icon={<Search className="h-4 w-4" />}
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            id="filter-category"
            label="Category"
            value={category}
            onChange={(event) => setCategory(event.target.value as GameCategory | 'all')}
            options={[
              { value: 'all', label: 'All categories' },
              ...GAME_CATEGORIES.map((value) => ({
                value,
                label: value.charAt(0).toUpperCase() + value.slice(1),
              })),
            ]}
          />
          <Select
            id="filter-players"
            label="Players"
            value={players}
            onChange={(event) => setPlayers(event.target.value as 'all' | '2' | '3' | '4')}
            options={[
              { value: 'all', label: 'Any' },
              { value: '2', label: '2 players' },
              { value: '3', label: '3 players' },
              { value: '4', label: '4 players' },
            ]}
          />
          <Select
            id="filter-difficulty"
            label="Difficulty"
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value as GameDifficulty | 'all')}
            options={[
              { value: 'all', label: 'Any' },
              { value: 'easy', label: 'Easy' },
              { value: 'medium', label: 'Medium' },
              { value: 'hard', label: 'Hard' },
            ]}
          />
          <Select
            id="filter-sort"
            label="Sort by"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            options={[
              { value: 'featured', label: 'Featured' },
              { value: 'name', label: 'Name' },
              { value: 'players', label: 'Player count' },
              { value: 'duration', label: 'Duration' },
            ]}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFavoritesOnly((value) => !value)}
            aria-pressed={favoritesOnly}
            className={cn(
              'chip min-h-touch transition',
              favoritesOnly && 'border-accent/60 bg-accent/15 text-accent',
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Favorites only
          </button>
          {searchActive ? <Badge tone="primary">{results.length} results</Badge> : null}
          <Button variant="ghost" size="sm" onClick={reset}>
            Reset filters
          </Button>
        </div>
      </section>

      {loading && games.length === 0 ? (
        <LoadingBlock message="Loading games…" />
      ) : searchActive ? (
        results.length === 0 ? (
          <EmptyState
            icon="🔍"
            title="No games found"
            description="Try a different search or clear the filters."
            action={
              <Button variant="secondary" onClick={reset}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <GameGrid games={results} {...gridProps} />
        )
      ) : (
        <div className="space-y-8">
          {mostPlayed.length > 0 ? (
            <section>
              <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-white">
                <Flame className="h-5 w-5 text-orange-400" /> Most Played
              </h2>
              <GameGrid games={mostPlayed} {...gridProps} />
            </section>
          ) : null}

          {newGames.length > 0 ? (
            <section>
              <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-white">
                <Sparkles className="h-5 w-5 text-primary-300" /> New Games
              </h2>
              <GameGrid games={newGames} {...gridProps} />
            </section>
          ) : null}

          {favoriteGames.length > 0 ? (
            <section>
              <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-white">
                <Heart className="h-5 w-5 text-accent" /> Favorites
              </h2>
              <GameGrid games={favoriteGames} {...gridProps} />
            </section>
          ) : null}

          <section>
            <h2 className="mb-4 flex items-center gap-2 text-xl font-bold text-white">
              <Gamepad2 className="h-5 w-5 text-slate-300" /> All Games
            </h2>
            {games.length === 0 ? (
              <EmptyState icon="🎮" title="No games available" description="Check back soon." />
            ) : (
              <GameGrid games={results} {...gridProps} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default GameBrowserScreen;
