import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';

/**
 * Shared "the game catalogue failed to load" state.
 *
 * Every discovery screen used to treat a failed `/api/games` request as an
 * empty catalogue, which showed an infinite "Loading games…" spinner on
 * Create Room and a misleading "No games available" / "No favorites yet"
 * everywhere else. `gameStore` already records the real error — this renders it
 * once, consistently, with a retry that re-hits the API.
 */
export function GamesLoadError({
  message,
  onRetry,
  busy = false,
}: {
  message?: string | null;
  onRetry: () => void;
  busy?: boolean;
}) {
  return (
    <EmptyState
      icon="⚠️"
      title="Could not load games"
      description={
        message ?? 'The game catalogue did not load. Check your connection and try again.'
      }
      action={
        <Button variant="secondary" onClick={onRetry} loading={busy}>
          Try again
        </Button>
      }
    />
  );
}

export default GamesLoadError;
