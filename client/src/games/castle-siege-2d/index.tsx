import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { CASTLE_SIEGE_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface SiegePublicState {
  phase: 'idle' | 'playing' | 'finished';
  cols: number;
  rows: number;
  stepMs: number;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  nodes: Array<{ x: number; y: number; holder: string | null }>;
  defenses: Array<{ id: string; x: number; y: number; owner: string; kind: 'wall' | 'tower'; hp: number }>;
  commanders: Record<
    string,
    {
      x: number;
      y: number;
      energy: number;
      castleHp: number;
      castleX: number;
      castleY: number;
      score: number;
      captures: number;
      alive: boolean;
      disconnected: boolean;
    }
  >;
}

const DPAD = [
  { direction: 'up' as const, icon: ArrowUp, label: 'Move up', area: 'col-start-2 row-start-1' },
  { direction: 'left' as const, icon: ArrowLeft, label: 'Move left', area: 'col-start-1 row-start-2' },
  { direction: 'down' as const, icon: ArrowDown, label: 'Move down', area: 'col-start-2 row-start-2' },
  { direction: 'right' as const, icon: ArrowRight, label: 'Move right', area: 'col-start-3 row-start-2' },
];
const SEAT = ['#818cf8', '#34d399', '#f472b6', '#fbbf24'];

function CastleSiegeGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<SiegePublicState>) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousEvent = useRef<string | null>(null);
  const [target, setTarget] = useState<{ col: number; row: number } | null>(null);

  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.commanders?.[myPlayerId] : undefined;
  const playing = phase === 'playing' && Boolean(me?.alive);

  const move = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      if (!playing) return;
      sendAction({ type: 'move', payload: { direction } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [playing, sendAction, vibrate],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const map: Record<string, 'up' | 'down' | 'left' | 'right'> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        w: 'up',
        s: 'down',
        a: 'left',
        d: 'right',
        W: 'up',
        S: 'down',
        A: 'left',
        D: 'right',
      };
      const direction = map[event.key];
      const targetEl = event.target as HTMLElement | null;
      if (targetEl && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(targetEl.tagName) || targetEl.isContentEditable)) {
        return;
      }
      if (direction) {
        event.preventDefault();
        move(direction);
        return;
      }
      if (event.key === ' ' || event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        if (target && playing) {
          sendAction({ type: 'fire', payload: { col: target.col, row: target.row } } satisfies GameAction);
          play('click');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [move, playing, play, sendAction, target]);

  useEffect(() => {
    const lastEvent = state?.lastEvent ?? null;
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (!lastEvent) return;
    if (lastEvent.startsWith('fire:') || lastEvent.startsWith('capture:')) {
      play(lastEvent.includes(myPlayerId ?? '') ? 'score' : 'notification');
    } else if (lastEvent.startsWith('fall:')) {
      play('wrong');
      vibrate('error');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Raising the keeps…</p>
        </div>
      </div>
    );
  }

  const act = (type: 'build' | 'upgrade' | 'fire' | 'capture') => {
    if (!playing) return;
    if (type === 'build' && target) sendAction({ type: 'build', payload: { col: target.col, row: target.row } } satisfies GameAction);
    else if (type === 'fire' && target) sendAction({ type: 'fire', payload: { col: target.col, row: target.row } } satisfies GameAction);
    else if (type === 'upgrade' || type === 'capture') sendAction({ type } satisfies GameAction);
    else return;
    play('click');
    vibrate('buttonPress');
  };

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({ ...player, score: state.commanders?.[player.id]?.score ?? player.score }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Siege clock"
      />
      <div className="flex flex-wrap items-center gap-2">
        {me ? <Badge tone="primary">Energy {me.energy}</Badge> : null}
        {me ? <Badge tone={me.castleHp > 40 ? 'success' : 'accent'}>Keep {me.castleHp} HP</Badge> : null}
        {phase === 'finished' ? <Badge tone="accent">Siege over</Badge> : null}
      </div>
      <div
        role="grid"
        aria-label="Castle siege battlefield"
        className="touch-none mx-auto grid w-full max-w-xl gap-px overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-1 select-none"
        style={{ gridTemplateColumns: `repeat(${state.cols}, minmax(0, 1fr))` }}
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
          if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
          else move(dy > 0 ? 'down' : 'up');
        }}
      >
        {Array.from({ length: state.cols * state.rows }, (_, index) => {
          const x = index % state.cols;
          const y = Math.floor(index / state.cols);
          const node = state.nodes.find((entry) => entry.x === x && entry.y === y);
          const defense = state.defenses.find((entry) => entry.x === x && entry.y === y);
          const castleOwner = players.find((player) => {
            const commander = state.commanders[player.id];
            return commander && commander.castleX === x && commander.castleY === y;
          });
          const occupant = players.find((player) => {
            const commander = state.commanders[player.id];
            return commander && commander.x === x && commander.y === y;
          });
          const selected = target?.col === x && target?.row === y;
          return (
            <button
              key={index}
              type="button"
              aria-label={`Cell ${x + 1},${y + 1}`}
              onClick={() => setTarget({ col: x, row: y })}
              className={cn(
                'relative aspect-square min-h-[22px] rounded-[3px] border border-transparent',
                node ? 'bg-amber-400/30' : 'bg-slate-800/80',
                selected && 'ring-2 ring-white',
              )}
            >
              {castleOwner ? (
                <span
                  className="absolute inset-0.5 rounded-sm"
                  style={{ backgroundColor: SEAT[players.indexOf(castleOwner) % SEAT.length], opacity: 0.55 }}
                />
              ) : null}
              {defense ? (
                <span className="absolute inset-1 rounded-sm bg-slate-400/80 text-[8px] text-slate-900">
                  {defense.kind === 'tower' ? 'T' : 'W'}
                </span>
              ) : null}
              {occupant ? (
                <span
                  className="absolute inset-[20%] rounded-full"
                  style={{ backgroundColor: SEAT[players.indexOf(occupant) % SEAT.length] }}
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="mx-auto flex flex-col items-center gap-3">
        <div className="grid w-44 grid-cols-3 grid-rows-2 gap-2">
          {DPAD.map(({ direction, icon: Icon, label, area }) => (
            <button
              key={direction}
              type="button"
              aria-label={label}
              disabled={!playing}
              onClick={() => move(direction)}
              className={cn(
                'grid h-14 place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition active:scale-95 disabled:opacity-40',
                area,
              )}
            >
              <Icon className="h-6 w-6" aria-hidden />
            </button>
          ))}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {(['build', 'upgrade', 'fire', 'capture'] as const).map((type) => (
            <button
              key={type}
              type="button"
              disabled={!playing}
              onClick={() => act(type)}
              className="min-h-11 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-semibold capitalize text-white transition active:scale-95 disabled:opacity-40"
            >
              {type}
            </button>
          ))}
        </div>
      </div>
      <p className="text-center text-xs text-slate-500">
        Tap a cell, then Build or Fire. Capture while standing on a gold node. The server owns HP, energy and damage.
      </p>
    </div>
  );
}

export const castleSiegeClient: ClientGameModule = {
  metadata: CASTLE_SIEGE_METADATA,
  Component: CastleSiegeGame as unknown as ComponentType<GameComponentProps<never>>,
};
