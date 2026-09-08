import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, LogOut, Play } from 'lucide-react';
import type { RoomState } from '@2play/shared';
import { RoomCodeCard } from '../components/room/RoomCodeCard';
import { PlayerList } from '../components/room/PlayerList';
import { HostControls } from '../components/room/HostControls';
import { ChatPanel } from '../components/chat/ChatPanel';
import { CountdownOverlay } from '../components/game/CountdownOverlay';
import { GameRenderer } from '../components/game/GameRenderer';
import { ResultPanel } from '../components/result/ResultPanel';
import { RematchPanel } from '../components/rematch/RematchPanel';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { LoadingBlock } from '../components/ui/Spinner';
import { useRoomStore } from '../stores/roomStore';
import { useSessionStore } from '../stores/sessionStore';
import { useGameStore } from '../stores/gameStore';
import { useRoomActions } from '../hooks/useRoomActions';
import { useLeaveRoomOnBackNavigation } from '../hooks/useLeaveRoomOnBackNavigation';
import { getLocalPlayerId } from '../stores/roomStore';
import { cn } from '../utils/cn';

const LOBBY_STATUSES: RoomState['status'][] = ['WAITING', 'LOBBY', 'READY'];
const RESULT_STATUSES: RoomState['status'][] = ['GAME_FINISHED', 'RESULT', 'REMATCH_WAITING'];

export function RoomScreen() {
  const { roomId = '' } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const room = useRoomStore((store) => store.room);
  const lastResult = useRoomStore((store) => store.lastResult);
  const roomClosedReason = useRoomStore((store) => store.roomClosedReason);
  const session = useSessionStore((store) => store.session);
  const games = useGameStore((store) => store.games);
  const loadGames = useGameStore((store) => store.load);
  const {
    leaveRoom,
    setReady,
    startGame,
    kickPlayer,
    requestRematch,
    cancelRematch,
    leaveMatch,
    reconnectToRoom,
  } = useRoomActions();

  const [reconnecting, setReconnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    void loadGames();
  }, [loadGames]);

  // Restore the room after a refresh / network switch.
  useEffect(() => {
    if (!roomId) return;
    if (room && room.id === roomId) return;
    if (attempted.current === roomId) return;

    const token = session?.sessionToken;
    if (!token) {
      navigate(`/join?code=${roomId}`, { replace: true });
      return;
    }

    let cancelled = false;
    let tries = 0;
    setReconnecting(true);
    attempted.current = roomId;

    const attempt = async (): Promise<boolean> => {
      tries += 1;
      const restored = await reconnectToRoom(roomId, token);
      if (restored) return true;
      if (tries < 6) {
        await new Promise((resolve) => setTimeout(resolve, 700 * tries));
        return cancelled ? true : attempt();
      }
      return false;
    };

    void attempt().then((ok) => {
      if (cancelled) return;
      setReconnecting(false);
      if (!ok) {
        attempted.current = null;
        navigate(`/join?code=${roomId}`, { replace: true });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [roomId, room, session?.sessionToken, navigate, reconnectToRoom]);

  useEffect(() => {
    if (roomClosedReason) navigate('/', { replace: true });
  }, [roomClosedReason, navigate]);

  const leave = useCallback(async () => {
    setBusy(true);
    await leaveRoom();
    setBusy(false);
    navigate('/');
  }, [leaveRoom, navigate]);

  // Phone/browser BACK while inside an active room is an INTENTIONAL leave
  // (spec: "PHONE BACK BUTTON MUST LEAVE ACTIVE ROOM"). This is separate from
  // a network disconnect, which keeps using the existing 120s
  // ReconnectionManager grace period untouched — this only fires on a real
  // popstate (back navigation), never on connection loss.
  const leaveOnBack = useCallback(() => {
    // Clear the client's own room state immediately so the UI (e.g. the
    // Home "you are in a room" popup) never flashes while the leave request
    // is in flight. The server remains authoritative: if this request is
    // ever lost, the next `authenticate` re-attaches the session to its
    // still-active room and the popup correctly reappears (spec §9).
    useRoomStore.getState().clearRoom();
    void leaveRoom();
  }, [leaveRoom]);

  useLeaveRoomOnBackNavigation(Boolean(room && room.id === roomId), leaveOnBack);

  const game = useMemo(() => games.find((entry) => entry.id === room?.gameId), [games, room?.gameId]);
  const myPlayerId = session?.playerId ?? getLocalPlayerId();
  const me = room?.players.find((player) => player.id === myPlayerId) ?? null;
  const isHost = Boolean(me?.isHost);
  const status = room?.status ?? null;

  const canStart = Boolean(
    room &&
      game &&
      room.players.length >= game.minPlayers &&
      room.players.filter((player) => !player.isAI && player.isConnected).every((player) => player.isReady),
  );

  const startBlockedReason = useMemo(() => {
    if (!room || !game) return null;
    if (room.players.length < game.minPlayers) return `At least ${game.minPlayers} players are required.`;
    const pending = room.players.filter((player) => !player.isAI && player.isConnected && !player.isReady);
    if (pending.length > 0) return `Waiting for ${pending.map((player) => player.nickname).join(', ')}.`;
    return null;
  }, [room, game]);

  if (!room || room.id !== roomId) {
    return (
      <LoadingBlock
        message={reconnecting ? 'Restoring your room…' : 'Loading room…'}
      />
    );
  }

  const showCountdown = room.status === 'COUNTDOWN' || room.status === 'NEW_MATCH';
  const inLobby = LOBBY_STATUSES.includes(room.status) || showCountdown;
  const playing = room.status === 'PLAYING' || room.status === 'PAUSED';
  const inResult = RESULT_STATUSES.includes(room.status);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
        <div className="flex items-center gap-2">
          <Badge tone={status === 'PLAYING' ? 'success' : 'default'}>{status}</Badge>
          {playing ? (
            <Button size="sm" variant="ghost" onClick={() => void leaveMatch()} disabled={busy}>
              End match
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="danger"
            onClick={() => void leave()}
            disabled={busy}
            icon={<LogOut className="h-4 w-4" />}
          >
            Leave
          </Button>
        </div>
      </div>

      <RoomCodeCard
        code={room.id}
        isPrivate={room.isPrivate}
        playerCount={room.players.length}
        maxPlayers={room.maxPlayers}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="relative space-y-4">
          {showCountdown ? <CountdownOverlay value={room.countdownValue} visible /> : null}

          {inLobby ? (
            <Card>
              <CardHeader
                title={game?.name ?? room.gameId}
                subtitle={game?.description}
                action={
                  <Badge tone="primary">
                    Match #{room.matchNumber}
                  </Badge>
                }
              />

              <PlayerList
                players={room.players}
                myPlayerId={myPlayerId}
                hostPlayerId={room.hostPlayerId}
                canKick={isHost && room.status !== 'PLAYING'}
                onKick={(playerId) => void kickPlayer({ playerId })}
                className="mb-4"
              />

              {isHost ? (
                <div className="mb-4 border-t border-white/5 pt-4">
                  <HostControls
                    game={game}
                    settings={room.settings}
                    maxPlayers={room.maxPlayers}
                    playerCount={room.players.length}
                    canStart={canStart}
                    startBlockedReason={startBlockedReason}
                  />
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-4">
                {me && !me.isAI ? (
                  <Button
                    size="lg"
                    variant={me.isReady ? 'success' : 'primary'}
                    onClick={() => void setReady({ isReady: !me.isReady })}
                    disabled={busy || showCountdown}
                  >
                    {me.isReady ? 'Ready ✓' : 'Ready up'}
                  </Button>
                ) : null}

                {!isHost ? (
                  <p className="text-sm text-slate-400">
                    {canStart
                      ? 'Everyone is ready — waiting for the host to start.'
                      : (startBlockedReason ?? 'Waiting for the host to start the match.')}
                  </p>
                ) : (
                  <Button
                    size="lg"
                    variant="secondary"
                    onClick={() => void startGame()}
                    disabled={!canStart || busy || showCountdown}
                    icon={<Play className="h-4 w-4" />}
                  >
                    Start match
                  </Button>
                )}
              </div>
            </Card>
          ) : null}

          {playing ? (
            <div className="space-y-4">
              <GameRenderer room={room} myPlayerId={myPlayerId} />
            </div>
          ) : null}

          {inResult ? (
            <div className="space-y-4">
              {room.gameResult ? (
                <ResultPanel result={room.gameResult} players={room.players} myPlayerId={myPlayerId} />
              ) : lastResult ? (
                <ResultPanel result={lastResult} players={room.players} myPlayerId={myPlayerId} />
              ) : null}

              {room.status === 'REMATCH_WAITING' ? (
                <RematchPanel
                  room={room}
                  myPlayerId={myPlayerId}
                  busy={busy}
                  onRequest={() => void requestRematch()}
                  onCancel={() => void cancelRematch()}
                  onLeave={() => void leave()}
                />
              ) : (
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-slate-300">
                    {room.status === 'RESULT' ? 'Preparing the rematch vote…' : 'Match complete.'}
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={() => void requestRematch()} disabled={busy}>
                      Play again
                    </Button>
                    <Button variant="ghost" onClick={() => void leave()} disabled={busy}>
                      Leave room
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          ) : null}
        </div>

        <div className={cn('space-y-4', 'lg:sticky lg:top-20 lg:self-start')}>
          <ChatPanel messages={room.chat} myPlayerId={myPlayerId} className="h-[420px]" />
          {game ? (
            <Card>
              <CardHeader title="Rules" subtitle={game.name} />
              <ul className="space-y-1.5 text-xs text-slate-400">
                {game.rules.map((rule) => (
                  <li key={rule}>• {rule}</li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default RoomScreen;
