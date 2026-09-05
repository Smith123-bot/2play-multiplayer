import type { ComponentType } from 'react';
import type { GameAction, GameMetadata, Player, RoomState } from '@2play/shared';
import type { SoundName } from '../../audio/sounds';
import type { HapticPattern } from '../../haptics/HapticsManager';

/** Props every client game component receives. */
export interface GameComponentProps<TState = unknown> {
  /** Per-viewer projection of the server state (hidden data already stripped). */
  state: TState;
  room: RoomState;
  players: Player[];
  myPlayerId: string | null;
  isMyTurn: boolean;
  /** Sends an intent to the server. The server decides if it is legal. */
  sendAction: (action: GameAction) => void;
  play: (name: SoundName) => void;
  vibrate: (pattern: HapticPattern) => void;
}

export interface ClientGameModule {
  metadata: GameMetadata;
  Component: ComponentType<GameComponentProps<never>>;
}
