import { useEffect, useMemo, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import type { GameCategory, GameDifficulty } from '@2play/shared';
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
import { cn } from '../utils/cn';

type SortKey = 'featured' | 'name' | 'duration' | 'players';

export function GameBrowserScreen() {
  const games = useGameStore((store) => store.games);
  const loading = useGameStore((store) => store.loading);
  const loadGames = useGameStore((store) => store.load);
  const favorites = useFavoritesStore((store) => store.favorites);
  const toggleFavorite = useFavoritesStore((store) => store.toggle);
  const loadFavorites = useFavoritesStore((store) => store.load);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<GameCategory | 'all'>('all');
  const [players, setPlayers] = useState<'all' | '2' | '3' | '4'>('all');
  const [difficulty, setDifficulty] = useState<GameDifficulty | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('featured');
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  useEffect(() => {
    void loadGames();
    void loadFavorites();
  }, [loadGames, loadFavorites]);

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
          : `${game.name} ${game.description} ${game.tags.join(' ')}`.toLowerCase().includes(needle),
      )
      .sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name);
        if (sort === 'duration') return a.estimatedDuration - b.estimatedDuration;
        if (sort === 'players') return a.minPlayers - b.minPlayers;
        return (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
      });
  }, [games, query, category, players, difficulty, sort, favoritesOnly, favorites]);

  const reset = () => {
    setQuery('');
    setCategory('all');
    setPlayers('all');
    setDifficulty('all');
    setFavoritesOnly(false);
    setSort('featured');
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white">Game browser</h1>
          <p className="mt-1 text-sm text-slate-400">
            {games.length} games · {favorites.length} favorites
          </p>
        </div>
      </header>

      <section className="card space-y-3 p-4">
        <Input
          label="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, tag or description…"
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
          <Badge tone="primary">{results.length} results</Badge>
          <Button variant="ghost" size="sm" onClick={reset}>
            Reset filters
          </Button>
        </div>
      </section>

      {loading && results.length === 0 ? (
        <LoadingBlock message="Loading games…" />
      ) : results.length === 0 ? (
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              favorite={favorites.includes(game.id)}
              onToggleFavorite={(gameId) => void toggleFavorite(gameId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default GameBrowserScreen;
