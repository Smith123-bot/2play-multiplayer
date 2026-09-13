import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, RefreshCw } from 'lucide-react';
import type { RoomSummary } from '@2play/shared';
import { normalizeRoomCode } from '@2play/shared';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { useRoomActions } from '../hooks/useRoomActions';
import { useIdentityGate } from '../hooks/useIdentityGate';
import { useSessionStore } from '../stores/sessionStore';
import { useGameStore } from '../stores/gameStore';

export function JoinRoomScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const gate = useIdentityGate();
  const { joinRoom, listRooms } = useRoomActions();
  const recentRooms = useSessionStore((store) => store.recentRooms);
  const games = useGameStore((store) => store.games);
  const loadGames = useGameStore((store) => store.load);

  const [code, setCode] = useState(normalizeRoomCode(params.get('code') ?? ''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const gameFilter = params.get('game');

  useEffect(() => {
    void loadGames();
  }, [loadGames]);

  useEffect(() => {
    const value = normalizeRoomCode(params.get('code') ?? '');
    if (value) setCode(value);
  }, [params]);

  const refreshRooms = async () => {
    setLoadingRooms(true);
    const result = await listRooms(gameFilter ?? undefined);
    setRooms(result);
    setLoadingRooms(false);
  };

  useEffect(() => {
    void refreshRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameFilter]);

  const submit = () => {
    const clean = normalizeRoomCode(code);
    if (clean.length !== 6) {
      setError('Room codes are 6 characters (A–Z, 2–9).');
      return;
    }
    setError(null);
    gate(async () => {
      setBusy(true);
      const room = await joinRoom({ roomId: clean });
      setBusy(false);
      if (room) navigate(`/room/${room.id}`);
    });
  };

  const recent = useMemo(
    () =>
      recentRooms.map((entry) => ({
        ...entry,
        gameName: games.find((game) => game.id === entry.gameId)?.name ?? entry.gameId,
      })),
    [recentRooms, games],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">Join a room</h1>
        <p className="mt-1 text-sm text-slate-400">
          Enter the six character code your friend shared with you.
        </p>
      </header>

      <Card>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Input
            label="Room code"
            value={code}
            onChange={(event) => {
              setCode(normalizeRoomCode(event.target.value).slice(0, 6));
              if (error) setError(null);
            }}
            placeholder="ABC234"
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            error={error}
            icon={<KeyRound className="h-4 w-4" />}
            className="font-mono text-2xl tracking-[0.35em]"
            inputMode="text"
          />
          <Button type="submit" size="lg" fullWidth loading={busy} disabled={code.length !== 6}>
            Join room
          </Button>
        </form>
      </Card>

      {recent.length > 0 ? (
        <Card>
          <CardHeader title="Your recent rooms" />
          <ul className="space-y-2">
            {recent.map((room) => (
              <li key={room.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-white">{room.id}</p>
                  <p className="truncate text-xs text-slate-400">{room.gameName}</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setCode(room.id);
                    gate(async () => {
                      const joined = await joinRoom({ roomId: room.id });
                      if (joined) navigate(`/room/${joined.id}`);
                    });
                  }}
                >
                  Rejoin
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={gameFilter ? 'Open rooms for this game' : 'Public rooms'}
          subtitle="Anyone can join these rooms"
          action={
            <Button variant="ghost" size="sm" onClick={() => void refreshRooms()} icon={<RefreshCw className="h-4 w-4" />}>
              Refresh
            </Button>
          }
        />
        {loadingRooms ? (
          <p className="py-6 text-center text-sm text-slate-400">Looking for rooms…</p>
        ) : rooms.length === 0 ? (
          <EmptyState
            icon="🏠"
            title="No open rooms"
            description="Create a room and invite your friends with the code."
            action={
              <Button variant="secondary" onClick={() => gate(() => navigate('/create'))}>
                Create a room
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2">
            {rooms.map((room) => (
              <li
                key={room.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{room.gameName}</p>
                  <p className="truncate text-xs text-slate-400">
                    Host {room.hostNickname} · {room.playerCount}/{room.maxPlayers} players
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="primary">{room.id}</Badge>
                  <Button
                    size="sm"
                    onClick={() =>
                      gate(async () => {
                        const joined = await joinRoom({ roomId: room.id });
                        if (joined) navigate(`/room/${joined.id}`);
                      })
                    }
                  >
                    Join
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export default JoinRoomScreen;
