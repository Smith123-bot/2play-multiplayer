import { useCallback, useEffect, useMemo, useRef, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { SPLIT_WORLD_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../utils/cn';

export type ViewTile =
  | 'wall'
  | 'floor'
  | 'switch'
  | 'door'
  | 'goal'
  | 'key'
  | 'hazard'
  | 'plate'
  | 'unknown';

export type SplitLens = 'warden' | 'gatekeeper' | 'scout' | 'archivist';
export type SplitPhase = 'idle' | 'prep' | 'playing' | 'intermission' | 'finished';

export interface SplitWorldPublicState {
  phase: SplitPhase;
  round: number;
  totalRounds: number;
  arenaName: string;
  objective: string;
  objectiveText: string;
  cols: number;
  rows: number;
  lens: SplitLens;
  lensLabel: string;
  tiles: ViewTile[][];
  doorOpen: boolean;
  objectiveComplete: boolean;
  switchesTotal: number;
  switchesTriggered: number;
  platesTotal: number;
  platesPressed: number;
  platesRequired: number;
  keysTotal: number;
  keysRequired: number;
  keysTaken: number;
  orderProgress: number;
  orderHints: Array<{ x: number; y: number; order: number }>;
  goal: { x: number; y: number } | null;
  door: { x: number; y: number } | null;
  prepUntil: number | null;
  endsAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  players: Record<
    string,
    {
      x: number;
      y: number;
      score: number;
      roundScore: number;
      roundsWon: number;
      lens: SplitLens;
      finished: boolean;
      stunned: boolean;
      disconnected: boolean;
    }
  >;
}

type Direction = 'up' | 'down' | 'left' | 'right';

const DPAD: Array<{ direction: Direction; icon: typeof ArrowUp; label: string; area: string }> = [
  { direction: 'up', icon: ArrowUp, label: 'Move up', area: 'col-start-2 row-start-1' },
  { direction: 'left', icon: ArrowLeft, label: 'Move left', area: 'col-start-1 row-start-2' },
  { direction: 'down', icon: ArrowDown, label: 'Move down', area: 'col-start-2 row-start-2' },
  { direction: 'right', icon: ArrowRight, label: 'Move right', area: 'col-start-3 row-start-2' },
];

const SEAT = ['#818cf8', '#34d399', '#f472b6', '#fbbf24'];

const CELL: Record<ViewTile, string> = {
  wall: 'bg-slate-700/90',
  floor: 'bg-slate-200/10',
  switch: 'bg-sky-400/60',
  door: 'bg-fuchsia-500/50',
  goal: 'bg-emerald-400/50',
  key: 'bg-amber-400/60',
  hazard: 'bg-rose-500/60',
  plate: 'bg-violet-400/60',
  unknown: 'bg-slate-950',
};

const GLYPH: Partial<Record<ViewTile, string>> = {
  switch: '⌾',
  door: '▤',
  goal: '★',
  key: '⚿',
  hazard: '✕',
  plate: '◎',
};

const KEY_MAP: Record<string, Direction> = {
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

function SplitWorldGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<SplitWorldPublicState>) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousEvent = useRef<string | null>(null);
  const previousRound = useRef<number>(-1);

  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.players?.[myPlayerId] : undefined;
  const playing = phase === 'playing' && Boolean(me) && !me?.disconnected && !me?.finished && !me?.stunned;

  const move = useCallback(
    (direction: Direction) => {
      if (!playing) return;
      sendAction({ type: 'move', payload: { direction } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [playing, sendAction, vibrate],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      const direction = KEY_MAP[event.key];
      if (!direction) return;
      event.preventDefault();
      move(direction);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [move]);

  // Audio + haptic feedback, driven purely by server-reported events.
  useEffect(() => {
    const lastEvent = state?.lastEvent ?? null;
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (!lastEvent) return;
    const mine = myPlayerId ? lastEvent.endsWith(`:${myPlayerId}`) : false;
    if (lastEvent.startsWith('switch:') || lastEvent.startsWith('plate:')) {
      play(mine ? 'score' : 'notification');
      if (mine) vibrate('success');
    } else if (lastEvent.startsWith('key:')) {
      play(mine ? 'correct' : 'notification');
      if (mine) vibrate('success');
    } else if (lastEvent.startsWith('hazard:') || lastEvent.startsWith('wrong:')) {
      if (mine) {
        play('wrong');
        vibrate('error');
      }
    } else if (lastEvent.startsWith('goal:')) {
      play(mine ? 'victory' : 'notification');
      if (mine) vibrate('victory');
    } else if (lastEvent.startsWith('round-end:')) {
      play('gameOver');
      vibrate('success');
    } else if (lastEvent === 'timeout' || lastEvent === 'finished') {
      play('gameOver');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  useEffect(() => {
    const round = state?.round ?? -1;
    if (round === previousRound.current) return;
    previousRound.current = round;
    if (round >= 0 && state?.phase === 'prep') play('countdown');
  }, [state?.round, state?.phase, play]);

  const hintByCell = useMemo(() => {
    const map = new Map<string, number>();
    for (const hint of state?.orderHints ?? []) map.set(`${hint.x}:${hint.y}`, hint.order + 1);
    return map;
  }, [state?.orderHints]);

  const progress = useMemo(() => {
    if (!state) return { value: 0, max: 1, label: '' };
    switch (state.objective) {
      case 'collect-keys':
        return { value: state.keysTaken, max: Math.max(1, state.keysRequired), label: 'Keys' };
      case 'sequence-keys':
        return { value: state.orderProgress, max: Math.max(1, state.keysRequired), label: 'Sequence' };
      case 'switch-order':
        return { value: state.orderProgress, max: Math.max(1, state.switchesTotal), label: 'Order' };
      case 'pressure-plates':
        return { value: state.platesPressed, max: Math.max(1, state.platesRequired), label: 'Plates' };
      case 'reach-exit':
      default:
        return { value: state.switchesTriggered, max: Math.max(1, state.switchesTotal), label: 'Switches' };
    }
  }, [state]);

  if (phase === 'idle' || !state?.tiles?.length) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Splitting the world…</p>
        </div>
      </div>
    );
  }

  const deadline = phase === 'prep' ? state.prepUntil : state.endsAt;

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.players?.[player.id]?.score ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        deadline={deadline ?? null}
        label={phase === 'prep' ? 'Prep' : 'Round clock'}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">
          Round {Math.min(state.round + 1, state.totalRounds)}/{state.totalRounds}
        </Badge>
        <Badge tone="default">{state.arenaName}</Badge>
        <Badge tone={state.doorOpen ? 'success' : 'warning'}>
          {state.doorOpen ? 'Gate open' : 'Gate closed'}
        </Badge>
        {me?.stunned ? <Badge tone="danger">Recovering</Badge> : null}
        {me?.finished ? <Badge tone="success">Extracted</Badge> : null}
      </div>

      <div className="card space-y-2 p-3">
        <p className="text-sm font-medium text-slate-200">{state.objectiveText}</p>
        <p className="text-xs text-slate-400">Your lens — {state.lensLabel}</p>
        <ProgressBar value={progress.value} max={progress.max} />
        <p className="text-xs text-slate-500">
          {progress.label}: {progress.value}/{progress.max}
        </p>
      </div>

      {phase === 'prep' ? (
        <p className="text-center text-sm text-amber-300">
          Prep — describe what you can see. Movement unlocks when the round opens.
        </p>
      ) : null}
      {phase === 'intermission' ? (
        <p className="text-center text-sm text-emerald-300">Round complete — next arena loading…</p>
      ) : null}

      <div
        role="grid"
        aria-label={`Split world — ${state.arenaName}`}
        className="touch-none mx-auto grid w-full max-w-md select-none gap-px overflow-hidden rounded-2xl border border-white/10 bg-black/50 p-1"
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
        {state.tiles.flatMap((row, y) =>
          row.map((tile, x) => {
            const occupants = players.filter((player) => {
              const body = state.players[player.id];
              return body && body.x === x && body.y === y;
            });
            const hint = hintByCell.get(`${x}:${y}`);
            return (
              <div
                key={`${x}:${y}`}
                className={cn(
                  'relative grid aspect-square place-items-center text-[9px] text-white/70',
                  CELL[tile],
                )}
              >
                {GLYPH[tile] ? <span aria-hidden>{GLYPH[tile]}</span> : null}
                {hint ? (
                  <span className="absolute right-0 top-0 rounded-bl bg-black/70 px-[2px] text-[8px] font-bold text-amber-300">
                    {hint}
                  </span>
                ) : null}
                {occupants.map((player, position) => (
                  <span
                    key={player.id}
                    className="absolute inset-[18%] rounded-full"
                    style={{
                      backgroundColor: SEAT[players.indexOf(player) % SEAT.length],
                      marginLeft: position * 2,
                      opacity: state.players[player.id]?.disconnected ? 0.4 : 1,
                      boxShadow: player.id === myPlayerId ? '0 0 0 2px #fff' : undefined,
                    }}
                  />
                ))}
              </div>
            );
          }),
        )}
      </div>

      <div className="mx-auto grid w-44 grid-cols-3 grid-rows-2 gap-2">
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

      <p className="text-center text-xs text-slate-500">
        Talk it out. Your view is incomplete — the server still owns every wall, switch, key and gate.
      </p>
    </div>
  );
}

export const splitWorldClient: ClientGameModule = {
  metadata: SPLIT_WORLD_METADATA,
  Component: SplitWorldGame as unknown as ComponentType<GameComponentProps<never>>,
};
