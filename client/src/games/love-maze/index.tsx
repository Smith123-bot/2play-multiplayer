import { useCallback, useEffect, useMemo, useRef, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, HelpCircle } from 'lucide-react';
import { LOVE_MAZE_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { HowToPlayModal, useHowToPlay } from '../../components/game/HowToPlayModal';
import { Badge } from '../../components/ui/Badge';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../utils/cn';

type Direction = 'up' | 'down' | 'left' | 'right';

type MazeTile =
  | 'wall'
  | 'floor'
  | 'switch-a'
  | 'switch-b'
  | 'plate'
  | 'door'
  | 'key'
  | 'hazard'
  | 'checkpoint'
  | 'exit';

export interface MazePublicState {
  phase: 'idle' | 'playing' | 'level-clear' | 'finished';
  level: number;
  totalLevels: number;
  levelName: string;
  hint: string;
  cols: number;
  rows: number;
  tiles: MazeTile[][];
  keysTaken: string[];
  keysRequired: number;
  keysCollected: number;
  doorsOpen: boolean;
  switchesHeld: { a: boolean; b: boolean };
  platesHeld: number;
  platesTotal: number;
  levelEndsAt: number | null;
  teamScore: number;
  levelsCleared: number;
  mistakes: number;
  lastEvent: string | null;
  finishReason: string | null;
  serverTime: number;
  myRole: 'a' | 'b' | null;
  players: Record<
    string,
    {
      x: number;
      y: number;
      role: 'a' | 'b';
      onExit: boolean;
      hazardHits: number;
      keysCollected: number;
      disconnected: boolean;
    }
  >;
}

const TILE_CLASS: Record<MazeTile, string> = {
  wall: 'bg-slate-700',
  floor: 'bg-white/[0.04]',
  'switch-a': 'bg-sky-500/40',
  'switch-b': 'bg-emerald-500/40',
  plate: 'bg-violet-500/40',
  door: 'bg-fuchsia-500/50',
  key: 'bg-amber-400/40',
  hazard: 'bg-rose-500/50',
  checkpoint: 'bg-teal-400/30',
  exit: 'bg-emerald-400/50',
};

const TILE_GLYPH: Partial<Record<MazeTile, string>> = {
  'switch-a': 'A',
  'switch-b': 'B',
  plate: '◎',
  door: '▤',
  key: '⚿',
  hazard: '✕',
  checkpoint: '⚑',
  exit: '★',
};

const ROLE_COLOR: Record<'a' | 'b', string> = { a: '#38bdf8', b: '#34d399' };

const DPAD: Array<{ direction: Direction; icon: typeof ArrowUp; label: string; area: string }> = [
  { direction: 'up', icon: ArrowUp, label: 'Move up', area: 'col-start-2 row-start-1' },
  { direction: 'left', icon: ArrowLeft, label: 'Move left', area: 'col-start-1 row-start-2' },
  { direction: 'down', icon: ArrowDown, label: 'Move down', area: 'col-start-2 row-start-2' },
  { direction: 'right', icon: ArrowRight, label: 'Move right', area: 'col-start-3 row-start-2' },
];

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

function LoveMazeGame({ state, players, myPlayerId, sendAction, play, vibrate }: GameComponentProps<MazePublicState>) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousEvent = useRef<string | null>(null);
  const rules = useHowToPlay(LOVE_MAZE_METADATA.id);

  const phase = state?.phase ?? 'idle';
  const playing = phase === 'playing';

  const move = useCallback(
    (direction: Direction) => {
      if (!playing) return;
      sendAction({ type: 'move', payload: { direction } } satisfies GameAction);
    },
    [playing, sendAction],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)) {
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

  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (event === previousEvent.current) return;
    previousEvent.current = event;
    if (!event) return;
    const mine = myPlayerId ? event.endsWith(`:${myPlayerId}`) : false;
    if (event.startsWith('key:')) {
      play('correct');
      vibrate('success');
    } else if (event.startsWith('checkpoint:')) {
      play('score');
      if (mine) vibrate('success');
    } else if (event.startsWith('hazard:')) {
      if (mine) {
        play('wrong');
        vibrate('error');
      }
    } else if (event.startsWith('level-clear:')) {
      play('victory');
      vibrate('victory');
    } else if (event.startsWith('level:')) {
      play('gameStart');
    } else if (event === 'timeout' || event === 'finished') {
      play('gameOver');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  const placed = useMemo(() => {
    if (!state?.players) return [] as Array<{ id: string; x: number; y: number; role: 'a' | 'b'; off: boolean }>;
    return Object.entries(state.players).map(([id, actor]) => ({
      id,
      x: actor.x,
      y: actor.y,
      role: actor.role,
      off: actor.disconnected,
    }));
  }, [state?.players]);

  if (phase === 'idle' || !state?.tiles?.length) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Building the maze…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <HowToPlayModal game={LOVE_MAZE_METADATA} open={rules.open} onClose={rules.close} />

      <GameHUD
        players={players.map((player) => ({ ...player, score: state.teamScore }))}
        myPlayerId={myPlayerId}
        deadline={state.levelEndsAt ?? null}
        label={phase === 'level-clear' ? 'Next level' : 'Level clock'}
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge tone="primary">
          Level {Math.min(state.level + 1, state.totalLevels)}/{state.totalLevels}
        </Badge>
        <Badge tone="default">{state.levelName}</Badge>
        <Badge tone="success">Team {state.teamScore}</Badge>
        <Badge tone={state.doorsOpen ? 'success' : 'warning'}>
          {state.doorsOpen ? 'Doors open' : 'Doors shut'}
        </Badge>
        <button
          type="button"
          onClick={rules.show}
          aria-label="How to play"
          className="rounded-full border border-white/10 p-1.5 text-slate-400 transition hover:text-white"
        >
          <HelpCircle className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="card space-y-2 p-3">
        <p className="text-sm text-slate-300">{state.hint}</p>
        {state.keysRequired > 0 ? (
          <ProgressBar
            value={state.keysCollected}
            max={state.keysRequired}
            label={`Keys ${state.keysCollected}/${state.keysRequired}`}
          />
        ) : null}
        {state.platesTotal > 0 ? (
          <p className="text-xs text-slate-400">
            Pressure plates held: {state.platesHeld}/{state.platesTotal}
          </p>
        ) : null}
        <p className="text-xs text-slate-500">
          You are partner <span className="font-semibold text-white">{state.myRole?.toUpperCase() ?? '?'}</span> — only
          you can hold switch {state.myRole?.toUpperCase() ?? '?'}.
        </p>
      </div>

      {phase === 'level-clear' ? (
        <p className="text-center text-sm text-emerald-300">Level clear! Loading the next maze…</p>
      ) : null}

      <div
        role="grid"
        aria-label={`Love Maze level ${state.level + 1}`}
        className="mx-auto grid w-full max-w-[min(94vw,30rem)] touch-none select-none gap-px overflow-hidden rounded-2xl border border-white/10 bg-black/50 p-1"
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
            const taken = tile === 'key' && state.keysTaken.includes(`${x}:${y}`);
            const shown: MazeTile = taken ? 'floor' : tile;
            const open = tile === 'door' && state.doorsOpen;
            const here = placed.filter((entry) => entry.x === x && entry.y === y);
            return (
              <div
                key={`${x}:${y}`}
                className={cn(
                  'relative grid aspect-square place-items-center text-[9px] font-bold text-white/70',
                  TILE_CLASS[shown],
                  open && 'opacity-30',
                )}
              >
                {TILE_GLYPH[shown] && !open ? <span aria-hidden>{TILE_GLYPH[shown]}</span> : null}
                {here.map((entry, index) => (
                  <span
                    key={entry.id}
                    className="absolute rounded-full border border-black/50"
                    style={{
                      inset: '16%',
                      backgroundColor: ROLE_COLOR[entry.role],
                      transform: `translate(${index * 14}%, ${index * 14}%)`,
                      opacity: entry.off ? 0.35 : 1,
                      boxShadow: entry.id === myPlayerId ? '0 0 0 2px #fff' : undefined,
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
        Both of you must stand on the ★ exit — with every key collected — to clear the level.
      </p>
    </div>
  );
}

export const loveMazeClient: ClientGameModule = {
  metadata: LOVE_MAZE_METADATA,
  Component: LoveMazeGame as unknown as ComponentType<GameComponentProps<never>>,
};
