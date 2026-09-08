import { useState } from 'react';
import { Play } from 'lucide-react';
import type { GameMetadata, RoomSettings } from '@2play/shared';
import { MAX_PLAYERS_PER_ROOM, MIN_PLAYERS_PER_ROOM } from '@2play/shared';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { useRoomActions } from '../../hooks/useRoomActions';

export interface HostControlsProps {
  game: GameMetadata | undefined;
  settings: RoomSettings;
  maxPlayers: number;
  playerCount: number;
  canStart: boolean;
  startBlockedReason: string | null;
}

/**
 * Host only: player count, grid size, start.
 *
 * Create Room is human-multiplayer only (spec: "2PLAY — UX + ROOM LIFECYCLE
 * FIX" §1) — there is intentionally no AI difficulty selector or "Add AI"
 * control here. AI matches are started directly through the separate
 * "Play with AI" flow, which never passes through this lobby.
 */
export function HostControls({
  game,
  settings,
  maxPlayers,
  playerCount,
  canStart,
  startBlockedReason,
}: HostControlsProps) {
  const { updateSettings, startGame } = useRoomActions();
  const [busy, setBusy] = useState(false);

  const counts = (game?.supportedPlayerCounts ?? [2, 3, 4]).filter(
    (count) => count >= MIN_PLAYERS_PER_ROOM && count <= MAX_PLAYERS_PER_ROOM,
  );

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          id="host-player-count"
          label="Players"
          value={String(maxPlayers)}
          options={counts.map((count) => ({ value: String(count), label: `${count} players` }))}
          onChange={(event) => void run(() => updateSettings({ playerCount: Number(event.target.value) }))}
          disabled={busy}
        />

        {game?.gridOptions && game.gridOptions.length > 0 ? (
          <Select
            id="host-grid-size"
            label="Board size"
            value={settings.gridSize ?? game.gridOptions[0]}
            options={game.gridOptions.map((size) => ({ value: size, label: size }))}
            onChange={(event) => void run(() => updateSettings({ gridSize: event.target.value }))}
            disabled={busy}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          onClick={() => void startGame()}
          disabled={!canStart || busy || playerCount === 0}
          icon={<Play className="h-4 w-4" />}
        >
          Start match
        </Button>
        {!canStart && startBlockedReason ? (
          <span className="text-sm text-slate-400">{startBlockedReason}</span>
        ) : null}
      </div>
    </div>
  );
}
