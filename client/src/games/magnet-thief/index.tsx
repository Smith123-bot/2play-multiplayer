import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { MAGNET_THIEF_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface MagnetThiefPublicState {
  phase: 'idle' | 'playing' | 'finished';
  gems: Array<{ id: string; x: number; y: number; ownerId: string | null; value: number }>;
  endsAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  width: number;
  height: number;
  range: number;
  cooldown: number;
  safeCorners: Array<{ x: number; y: number }>;
  stage: number;
  nextStageAt: number | null;
  obstacles: Array<{ x: number; y: number; radius: number }>;
  lastEffect: {
    id: number;
    mode: 'pull' | 'repel';
    playerId: string;
    gemIds: string[];
    at: number;
  } | null;
  players: Record<
    string,
    {
      x: number;
      y: number;
      score: number;
      stolen: number;
      carrying: number;
      cooldownLeft: number;
      inSafe: boolean;
      disconnected: boolean;
      latestInputSeq: number;
    }
  >;
  myCarrying: string[];
}

const DPAD = [
  { dx: 0, dy: -1, icon: ArrowUp, label: 'Move up', area: 'col-start-2 row-start-1' },
  { dx: -1, dy: 0, icon: ArrowLeft, label: 'Move left', area: 'col-start-1 row-start-2' },
  { dx: 0, dy: 1, icon: ArrowDown, label: 'Move down', area: 'col-start-2 row-start-2' },
  { dx: 1, dy: 0, icon: ArrowRight, label: 'Move right', area: 'col-start-3 row-start-2' },
];
const SEAT = ['#818cf8', '#34d399', '#f472b6', '#fbbf24'];

function MagnetThiefGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<MagnetThiefPublicState>) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousEvent = useRef<string | null>(null);
  const inputSequence = useRef(0);
  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.players?.[myPlayerId] : undefined;
  const playing = phase === 'playing' && Boolean(me) && !me?.disconnected;

  const move = useCallback(
    (dx: number, dy: number) => {
      if (!playing) return;
      inputSequence.current = Math.max(inputSequence.current, me?.latestInputSeq ?? -1) + 1;
      sendAction({
        type: 'move',
        payload: { dx, dy, sequence: inputSequence.current },
      } satisfies GameAction);
      vibrate('buttonPress');
    },
    [me?.latestInputSeq, playing, sendAction, vibrate],
  );

  const activateField = useCallback(
    (mode: 'pull' | 'repel') => {
      if (!playing) return;
      sendAction({ type: mode, payload: {} } satisfies GameAction);
      play('click');
      vibrate('buttonPress');
    },
    [playing, sendAction, play, vibrate],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const map: Record<string, { dx: number; dy: number }> = {
        ArrowUp: { dx: 0, dy: -1 },
        ArrowDown: { dx: 0, dy: 1 },
        ArrowLeft: { dx: -1, dy: 0 },
        ArrowRight: { dx: 1, dy: 0 },
        w: { dx: 0, dy: -1 },
        s: { dx: 0, dy: 1 },
        a: { dx: -1, dy: 0 },
        d: { dx: 1, dy: 0 },
        W: { dx: 0, dy: -1 },
        S: { dx: 0, dy: 1 },
        A: { dx: -1, dy: 0 },
        D: { dx: 1, dy: 0 },
      };
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === 'q' || event.key === 'Q') {
        event.preventDefault();
        activateField('repel');
        return;
      }
      if (event.key === 'e' || event.key === 'E' || event.key === ' ') {
        event.preventDefault();
        activateField('pull');
        return;
      }
      const delta = map[event.key];
      if (!delta) return;
      event.preventDefault();
      move(delta.dx, delta.dy);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [move, activateField]);

  useEffect(() => {
    const lastEvent = state?.lastEvent ?? null;
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (!lastEvent) return;
    if (lastEvent.startsWith('steal:') && lastEvent.includes(myPlayerId ?? '')) {
      play('score');
      vibrate('success');
    } else if (
      (lastEvent.startsWith('pull:') || lastEvent.startsWith('repel:')) &&
      lastEvent.includes(myPlayerId ?? '')
    ) {
      play('correct');
    } else if (lastEvent.startsWith('stage:')) {
      play('countdown');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Charging the magnets…</p>
        </div>
      </div>
    );
  }

  const width = state.width || 18;
  const height = state.height || 12;
  const cooling = (me?.cooldownLeft ?? 0) > 0;

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.players?.[player.id]?.score ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Arena clock"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">Carrying {me?.carrying ?? 0}</Badge>
        <Badge tone="accent">Stolen {me?.stolen ?? 0}</Badge>
        <Badge tone="primary">Stage {state.stage ?? 1}/3</Badge>
        {me?.inSafe ? <Badge tone="success">Safe corner</Badge> : null}
        {cooling ? (
          <Badge tone="warning">Cooldown {Math.ceil((me?.cooldownLeft ?? 0) / 100) / 10}s</Badge>
        ) : null}
      </div>
      <div
        role="img"
        aria-label="Magnet arena"
        className="touch-none relative mx-auto w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-slate-950 select-none"
        style={{ aspectRatio: `${width} / ${height}` }}
        onTouchStart={(event) => {
          const touch = event.changedTouches[0];
          touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
        }}
        onTouchMove={(event) => event.preventDefault()}
        onTouchEnd={(event) => {
          const start = touchStart.current;
          touchStart.current = null;
          const touch = event.changedTouches[0];
          if (!start || !touch) return;
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
          if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1, 0);
          else move(0, dy > 0 ? 1 : -1);
        }}
      >
        {(state.safeCorners ?? []).map((corner, index) => (
          <span
            key={`safe-${index}`}
            className="absolute rounded-full bg-emerald-400/25"
            style={{
              left: `${(corner.x / width) * 100}%`,
              top: `${(corner.y / height) * 100}%`,
              width: '14%',
              height: '20%',
              transform: 'translate(-50%, -50%)',
            }}
          />
        ))}
        {(state.obstacles ?? []).map((obstacle, index) => (
          <span
            key={`obstacle-${index}`}
            aria-hidden
            className="absolute rounded-full border border-slate-500 bg-slate-700 shadow-inner"
            style={{
              left: `${(obstacle.x / width) * 100}%`,
              top: `${(obstacle.y / height) * 100}%`,
              width: `${((obstacle.radius * 2) / width) * 100}%`,
              aspectRatio: '1',
              transform: 'translate(-50%, -50%)',
            }}
          />
        ))}
        {(state.gems ?? []).map((gem) => (
          <span
            key={gem.id}
            className="absolute rounded-sm bg-cyan-300"
            style={{
              left: `${(gem.x / width) * 100}%`,
              top: `${(gem.y / height) * 100}%`,
              width: '3%',
              height: '4.5%',
              transform: 'translate(-50%, -50%)',
              opacity: gem.ownerId ? 0.85 : 1,
            }}
          />
        ))}
        {players.map((player, seat) => {
          const runner = state.players[player.id];
          if (!runner) return null;
          const activeEffect = state.lastEffect?.playerId === player.id ? state.lastEffect : null;
          return (
            <span
              key={player.id}
              className="absolute rounded-full"
              style={{
                left: `${(runner.x / width) * 100}%`,
                top: `${(runner.y / height) * 100}%`,
                width: '4.5%',
                height: '6.5%',
                backgroundColor: SEAT[seat % SEAT.length],
                transform: 'translate(-50%, -50%)',
                boxShadow: player.id === myPlayerId ? '0 0 0 2px #fff' : undefined,
              }}
            >
              {activeEffect ? (
                <span
                  key={activeEffect.id}
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute left-1/2 top-1/2 animate-ping rounded-full border',
                    activeEffect.mode === 'repel' ? 'border-rose-300' : 'border-cyan-300',
                  )}
                  style={{
                    width: `${((state.range * 2) / width / 0.045) * 100}%`,
                    aspectRatio: '1',
                    transform: 'translate(-50%, -50%)',
                  }}
                />
              ) : null}
            </span>
          );
        })}
      </div>
      <div className="mx-auto flex flex-col items-center gap-3">
        <div className="grid w-44 grid-cols-3 grid-rows-2 gap-2">
          {DPAD.map(({ dx, dy, icon: Icon, label, area }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              disabled={!playing}
              onClick={() => move(dx, dy)}
              className={cn(
                'grid h-14 place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition active:scale-95 disabled:opacity-40',
                area,
              )}
            >
              <Icon className="h-6 w-6" aria-hidden />
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!playing || cooling}
            onClick={() => activateField('pull')}
            className="min-h-11 rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-4 text-sm font-semibold text-cyan-200 transition active:scale-95 disabled:opacity-40"
          >
            Pull · E / Space
          </button>
          <button
            type="button"
            disabled={!playing || cooling}
            onClick={() => activateField('repel')}
            className="min-h-11 rounded-xl border border-rose-400/40 bg-rose-500/15 px-4 text-sm font-semibold text-rose-200 transition active:scale-95 disabled:opacity-40"
          >
            Repel · Q
          </button>
        </div>
      </div>
      <p className="text-center text-xs text-slate-500">
        Pull loose gems into collection range, or repel an exposed rival’s haul. Obstacles block
        movement; safe corners protect carried gems.
      </p>
    </div>
  );
}

export const magnetThiefClient: ClientGameModule = {
  metadata: MAGNET_THIEF_METADATA,
  Component: MagnetThiefGame as unknown as ComponentType<GameComponentProps<never>>,
};
