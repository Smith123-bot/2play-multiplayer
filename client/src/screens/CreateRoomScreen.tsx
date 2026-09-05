import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Bot, Lock, Users } from 'lucide-react';
import type { AIDifficulty } from '@2play/shared';
import { MAX_PLAYERS_PER_ROOM } from '@2play/shared';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Toggle } from '../components/ui/Toggle';
import { Badge } from '../components/ui/Badge';
import { LoadingBlock } from '../components/ui/Spinner';
import { useGameStore } from '../stores/gameStore';
import { useRoomActions } from '../hooks/useRoomActions';
import { useIdentityGate } from '../hooks/useIdentityGate';
import { cn } from '../utils/cn';

export function CreateRoomScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const gate = useIdentityGate();
  const games = useGameStore((store) => store.games);
  const loadGames = useGameStore((store) => store.load);
  const { createRoom } = useRoomActions();

  const [gameId, setGameId] = useState(params.get('game') ?? '');
  const [players, setPlayers] = useState(2);
  const [isPrivate, setIsPrivate] = useState(false);
  const [aiOpponents, setAiOpponents] = useState(0);
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>('medium');
  const [gridSize, setGridSize] = useState<string>('');
  const [rounds, setRounds] = useState<number>(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadGames();
  }, [loadGames]);

  const game = useMemo(() => games.find((entry) => entry.id === gameId), [games, gameId]);

  useEffect(() => {
    if (!gameId && games.length > 0) setGameId(games[0].id);
  }, [gameId, games]);

  useEffect(() => {
    if (!game) return;
    setPlayers((current) =>
      game.supportedPlayerCounts.includes(current) ? current : game.supportedPlayerCounts[0],
    );
    if (game.gridOptions && game.gridOptions.length > 0) setGridSize(game.gridOptions[0]);
    if (game.hasRounds) setRounds(game.defaultRounds ?? 5);
  }, [game]);

  const maxAI = Math.max(0, Math.min(MAX_PLAYERS_PER_ROOM - 1, players - 1));

  const submit = () => {
    if (!game) return;
    gate(async () => {
      setBusy(true);
      setError(null);
      const room = await createRoom({
        gameId: game.id,
        maxPlayers: players,
        isPrivate,
        settings: {
          playerCount: players,
          ...(game.hasAI ? { aiOpponents: Math.min(aiOpponents, maxAI), aiDifficulty } : {}),
          ...(game.gridOptions && gridSize ? { gridSize } : {}),
          ...(game.hasRounds ? { rounds } : {}),
        },
      });
      setBusy(false);
      if (room) navigate(`/room/${room.id}`);
      else setError('Could not create the room. Please try again.');
    });
  };

  if (games.length === 0) return <LoadingBlock message="Loading games…" />;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">Create a room</h1>
        <p className="mt-1 text-sm text-slate-400">
          You will get a six character code to share with your friends.
        </p>
      </header>

      <Card>
        <CardHeader title="Choose a game" subtitle="Every game supports 2–4 players" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setGameId(entry.id)}
              aria-pressed={entry.id === gameId}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-3 text-left transition',
                entry.id === gameId
                  ? 'border-primary-400 bg-primary-500/15'
                  : 'border-white/10 bg-white/[0.03] hover:bg-white/10',
              )}
            >
              <span className="text-2xl" aria-hidden>
                {entry.icon}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-white">{entry.name}</span>
                <span className="block truncate text-xs text-slate-400">{entry.category}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>

      {game ? (
        <Card>
          <CardHeader
            title={game.name}
            subtitle={game.description}
            action={
              <Badge tone="primary">
                <Users className="h-3 w-3" /> {game.supportedPlayerCounts.join(' / ')}
              </Badge>
            }
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              id="create-players"
              label="Players"
              value={String(players)}
              onChange={(event) => {
                const next = Number(event.target.value);
                setPlayers(next);
                setAiOpponents((current) => Math.min(current, Math.max(0, next - 1)));
              }}
              options={game.supportedPlayerCounts.map((count) => ({
                value: String(count),
                label: `${count} players`,
              }))}
            />

            {game.hasAI ? (
              <>
                <Select
                  id="create-ai-difficulty"
                  label="AI difficulty"
                  value={aiDifficulty}
                  onChange={(event) => setAiDifficulty(event.target.value as AIDifficulty)}
                  options={game.aiDifficulties.map((difficulty) => ({
                    value: difficulty,
                    label: difficulty.charAt(0).toUpperCase() + difficulty.slice(1),
                  }))}
                />
                <Select
                  id="create-ai-count"
                  label="AI opponents"
                  value={String(Math.min(aiOpponents, maxAI))}
                  onChange={(event) => setAiOpponents(Number(event.target.value))}
                  options={Array.from({ length: maxAI + 1 }, (_, index) => ({
                    value: String(index),
                    label: index === 0 ? 'No AI' : `${index} AI player${index > 1 ? 's' : ''}`,
                  }))}
                  hint={`Add up to ${maxAI} computer opponents.`}
                />
              </>
            ) : null}

            {game.gridOptions && game.gridOptions.length > 0 ? (
              <Select
                id="create-grid"
                label="Board size"
                value={gridSize || game.gridOptions[0]}
                onChange={(event) => setGridSize(event.target.value)}
                options={game.gridOptions.map((size) => ({ value: size, label: size }))}
              />
            ) : null}

            {game.hasRounds ? (
              <Input
                id="create-rounds"
                label="Rounds"
                type="number"
                min={1}
                max={9}
                value={rounds}
                onChange={(event) =>
                  setRounds(Math.max(1, Math.min(9, Number(event.target.value) || 1)))
                }
                hint={`Best of ${rounds}`}
              />
            ) : null}
          </div>

          <div className="mt-4 border-t border-white/5 pt-2">
            <Toggle
              id="create-private"
              label="Private room"
              description="Hidden from the public room list — joinable with the code."
              checked={isPrivate}
              onChange={setIsPrivate}
            />
          </div>

          {error ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <Button size="lg" onClick={submit} loading={busy} icon={<Bot className="h-4 w-4" />}>
              Create room
            </Button>
            <Button size="lg" variant="ghost" onClick={() => navigate('/games')}>
              Back to games
            </Button>
            {isPrivate ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-warning">
                <Lock className="h-3.5 w-3.5" /> Only people with the code can join
              </span>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export default CreateRoomScreen;
