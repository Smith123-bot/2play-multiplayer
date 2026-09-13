import {
  Component,
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import type { GameAction, Player, RoomState } from '@2play/shared';
import { hasClientGame, loadGameModule } from '../../games/registry';
import type { ClientGameModule } from '../../games/registry/types';
import { LoadingBlock } from '../ui/Spinner';
import { useGameActions } from '../../hooks/useGameActions';
import { audioManager } from '../../audio/AudioManager';
import { hapticsManager } from '../../haptics/HapticsManager';
import type { GameComponentProps } from '../../games/registry/types';
import { EmptyState } from '../ui/EmptyState';
import { Button } from '../ui/Button';

class GameErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { hasError: boolean }
> {
  override state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[2PLAY] game crashed', error, info.componentStack);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <EmptyState
          icon="💥"
          title="The game hit an unexpected error"
          description="The room is still alive — reload the game module to continue."
          action={
            <Button
              onClick={() => {
                this.setState({ hasError: false });
                this.props.onReset();
              }}
            >
              Reload game
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}

/**
 * Renders the active game module for a room.
 * Games are pure consumers of the server snapshot — no game logic runs here.
 */
export function GameRenderer({
  room,
  myPlayerId,
}: {
  room: RoomState;
  myPlayerId: string | null;
}) {
  const { sendAction } = useGameActions();

  /**
   * Each game ships as its own lazily imported chunk, so the module is resolved
   * asynchronously when the room first needs it. Three states matter and must
   * not be confused: the chunk is still in flight, this client genuinely does
   * not know the game, or the download failed (offline / bad deploy) — the last
   * one is retryable, the second is not.
   */
  const gameId = room.gameId;
  const known = hasClientGame(gameId);
  const [entry, setEntry] = useState<ClientGameModule | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!known) return;
    let active = true;
    setLoadFailed(false);
    void loadGameModule(gameId)
      .then((loaded) => {
        if (active) setEntry(loaded ?? null);
      })
      .catch((error) => {
        console.error('[2PLAY] could not load game chunk', gameId, error);
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [gameId, known, attempt]);

  const handleAction = useCallback(
    (action: GameAction) => {
      void sendAction(action);
    },
    [sendAction],
  );

  if (!known) {
    return (
      <EmptyState
        icon="🎮"
        title="Game not available"
        description={`This client does not know how to render "${room.gameId}".`}
      />
    );
  }

  if (loadFailed) {
    return (
      <EmptyState
        icon="📡"
        title="Could not load this game"
        description="The game module did not download. The room is still alive — try again."
        action={<Button onClick={() => setAttempt((value) => value + 1)}>Try again</Button>}
      />
    );
  }

  if (!entry) {
    return <LoadingBlock message="Loading game…" />;
  }

  const GameComponent = entry.Component as ComponentType<
    GameComponentProps<unknown> & { players: Player[] }
  >;

  return (
    <GameErrorBoundary onReset={() => window.location.reload()}>
      <GameComponent
        state={room.gameState}
        room={room}
        players={room.players}
        myPlayerId={myPlayerId}
        isMyTurn={false}
        sendAction={handleAction}
        play={(name) => audioManager.play(name)}
        vibrate={(pattern) => hapticsManager.trigger(pattern)}
      />
    </GameErrorBoundary>
  );
}
