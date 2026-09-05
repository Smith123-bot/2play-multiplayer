import { useState } from 'react';
import { Play } from 'lucide-react';
import type { AIDifficulty, GameMetadata, RoomSettings } from '@2play/shared';
import { MAX_PLAYERS_PER_ROOM, MIN_PLAYERS_PER_ROOM } from '@2play/shared';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { useRoomActions } from '../../hooks/useRoomActions';

export interface HostControlsProps {
  game: GameMetadata | undefined;
  settings: RoomSettings;
  maxPlayers: number;
  playerCount: number;
  aiCount: number;
  aiPlayerIds: string[];
  canStart: boolean;
  startBlockedReason: string | null;
}

/** Host only: player count, AI opponents, difficulty, grid size, start. */
export function HostControls({
  game,
  settings,
  maxPlayers,
  playerCount,
  aiCount,
  aiPlayerIds,
  canStart,
  startBlockedReason,
}: HostControlsProps) {
  const { updateSettings, addAI, removeAI, startGame } = useRoomActions();
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

        {game?.hasAI ? (
          <Select
            id="host-ai-difficulty"
            label="AI difficulty"
            value={settings.aiDifficulty}
            options={(game.aiDifficulties ?? []).map((difficulty: AIDifficulty) => ({
              value: difficulty,
              label: difficulty.charAt(0).toUpperCase() + difficulty.slice(1),
            }))}
            onChange={(event) =>
              void run(() => updateSettings({ aiDifficulty: event.target.value as AIDifficulty }))
            }
            disabled={busy}
          />
        ) : null}

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

        {game ? (
          <div className="flex flex-col justify-end">
            <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-slate-300">AI opponents</span>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || aiCount === 0}
                    onClick={() => {
                      const last = aiPlayerIds[aiPlayerIds.length - 1];
                      if (last) void run(() => removeAI({ playerId: last }));
                    }}
                    aria-label="Remove one AI opponent"
                  >
                    −
                  </Button>
                  <span className="w-8 text-center tabular-nums text-white">{aiCount}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || playerCount >= maxPlayers}
                    onClick={() => void run(() => addAI({ difficulty: settings.aiDifficulty }))}
                    aria-label="Add AI opponent"
                  >
                    +
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="lg"
          onClick={() => void startGame()}
          disabled={!canStart || busy}
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
