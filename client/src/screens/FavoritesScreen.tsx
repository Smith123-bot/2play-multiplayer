import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { GameCard } from '../components/game/GameCard';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingBlock } from '../components/ui/Spinner';
import { useGameStore } from '../stores/gameStore';
import { useFavoritesStore } from '../stores/favoritesStore';
import { useSessionStore } from '../stores/sessionStore';

export function FavoritesScreen() {
  const games = useGameStore((store) => store.games);
  const loading = useGameStore((store) => store.loading);
  const loadGames = useGameStore((store) => store.load);
  const favorites = useFavoritesStore((store) => store.favorites);
  const loadFavorites = useFavoritesStore((store) => store.load);
  const toggleFavorite = useFavoritesStore((store) => store.toggle);
  const favoritesLoading = useFavoritesStore((store) => store.loading);
  const session = useSessionStore((store) => store.session);

  useEffect(() => {
    void loadGames();
    void loadFavorites();
  }, [loadGames, loadFavorites]);

  const favoriteGames = games.filter((game) => favorites.includes(game.id));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-3xl font-bold text-white">
          <Heart className="h-7 w-7 text-accent" /> Favorites
        </h1>
        <p className="mt-1 text-sm text-slate-400">Your hand-picked games, saved to your profile.</p>
      </header>

      {!session ? (
        <EmptyState
          icon="👤"
          title="Pick a nickname first"
          description="Favorites are stored against your player profile."
          action={
            <Link to="/" className="btn-primary">
              Back home
            </Link>
          }
        />
      ) : loading || favoritesLoading ? (
        <LoadingBlock message="Loading favorites…" />
      ) : favoriteGames.length === 0 ? (
        <EmptyState
          icon="⭐"
          title="No favorites yet"
          description="Tap the heart on any game to keep it here for quick access."
          action={
            <Link to="/games" className="btn-primary">
              Browse games
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {favoriteGames.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              favorite
              onToggleFavorite={(gameId) => void toggleFavorite(gameId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default FavoritesScreen;
