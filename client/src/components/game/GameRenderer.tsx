import { Component, useCallback, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import type { GameAction, Player, RoomState } from '@2play/shared';
import { getGameComponent } from '../../games/registry';
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
  const entry = getGameComponent(room.gameId);

  const handleAction = useCallback(
    (action: GameAction) => {
      void sendAction(action);
    },
    [sendAction],
  );

  if (!entry) {
    return (
      <EmptyState
        icon="🎮"
        title="Game not available"
        description={`This client does not know how to render "${room.gameId}".`}
      />
    );
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
