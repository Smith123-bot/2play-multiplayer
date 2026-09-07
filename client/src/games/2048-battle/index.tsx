import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Lock } from 'lucide-react';
import { BATTLE_2048_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface Battle2048PublicBoard {
  tiles: number[];
  score: number;
  moves: number;
  bestTile: number;
  locked: boolean;
}

export interface Battle2048PublicState {
  phase: 'idle' | 'playing' | 'finished';
  scores: Record<string, number>;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  serverTime: number;
  boards: Record<string, Battle2048PublicBoard | null>;
  lastEvent: string | null;
}

const TILE_STYLES: Record<number, string> = {
  2: 'bg-[#eee4da] text-[#776e65]',
  4: 'bg-[#ede0c8] text-[#776e65]',
  8: 'bg-[#f2b179] text-white',
  16: 'bg-[#f59563] text-white',
  32: 'bg-[#f67c5f] text-white',
  64: 'bg-[#f65e3b] text-white',
  128: 'bg-[#edcf72] text-white',
  256: 'bg-[#edcc61] text-white',
  512: 'bg-[#edc850] text-white',
  1024: 'bg-[#edc53f] text-white',
  2048: 'bg-[#edc22e] text-white',
};

function tileStyle(value: number): string {
  return TILE_STYLES[value] ?? 'bg-[#3c3a32] text-white';
}

function tileTextSize(value: number): string {
  if (value >= 1024) return 'text-sm sm:text-lg';
  if (value >= 128) return 'text-base sm:text-xl';
  return 'text-xl sm:text-3xl';
}

/** Big interactive board (mine). */
function Board({
  board,
  onSwipe,
  interactive,
}: {
  board: Battle2048PublicBoard;
  onSwipe: (direction: 'up' | 'down' | 'left' | 'right') => void;
  interactive: boolean;
}) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      role="grid"
      aria-label="Your 2048 board"
      className={cn(
        'grid aspect-square grid-cols-4 touch-none select-none gap-1.5 rounded-2xl border border-white/10 bg-black/40 p-2 sm:gap-2 sm:p-3',
        interactive ? 'cursor-pointer' : 'opacity-90',
      )}
      onTouchStart={(event) => {
        const touch = event.changedTouches[0];
        touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
      }}
      onTouchEnd={(event) => {
        const start = touchStart.current;
        touchStart.current = null;
        const touch = event.changedTouches[0];
        if (!start || !touch) return;
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
        if (Math.abs(dx) > Math.abs(dy)) onSwipe(dx > 0 ? 'right' : 'left');
        else onSwipe(dy > 0 ? 'down' : 'up');
      }}
    >
      {board.tiles.map((value, index) => (
        <div
          key={index}
          className={cn(
            'grid place-items-center rounded-lg font-black tabular-nums transition-all duration-100',
            value === 0 ? 'bg-white/5' : tileStyle(value),
            value === 0 ? '' : tileTextSize(value),
          )}
        >
          {value === 0 ? '' : value}
        </div>
      ))}
    </div>
  );
}

/** Tiny read-only board (the rival's). */
function MiniBoard({ board }: { board: Battle2048PublicBoard }) {
  return (
    <div className="grid grid-cols-4 gap-0.5 rounded-lg bg-black/40 p-1">
      {board.tiles.map((value, index) => (
        <div
          key={index}
          className={cn(
            'grid aspect-square place-items-center rounded text-[9px] font-bold leading-none tabular-nums sm:text-[11px]',
            value === 0 ? 'bg-white/5' : tileStyle(value),
          )}
        >
          {value === 0 ? '' : value}
        </div>
      ))}
    </div>
  );
}

const DPAD: Array<{
  direction: 'up' | 'down' | 'left' | 'right';
  icon: typeof ArrowUp;
  label: string;
  area: string;
}> = [
  { direction: 'up', icon: ArrowUp, label: 'Move up', area: 'col-start-2 row-start-1' },
  { direction: 'left', icon: ArrowLeft, label: 'Move left', area: 'col-start-1 row-start-2' },
  { direction: 'down', icon: ArrowDown, label: 'Move down', area: 'col-start-2 row-start-2' },
  { direction: 'right', icon: ArrowRight, label: 'Move right', area: 'col-start-3 row-start-2' },
];

function Battle2048Game({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<Battle2048PublicState>) {
  const [swipeDirection, setSwipeDirection] = useState<string | null>(null);
  const previousScore = useRef<number | null>(null);
  const previousLocked = useRef<boolean>(false);

  const phase = state?.phase ?? 'idle';
  const myBoard = myPlayerId ? state?.boards?.[myPlayerId] : undefined;
  const opponent = players.find((player) => player.id !== myPlayerId);
  const opponentBoard = opponent ? state?.boards?.[opponent.id] : undefined;
  const playing = phase === 'playing' && !myBoard?.locked;

  const send = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      if (!playing) return;
      sendAction({ type: 'move', payload: { direction } } satisfies GameAction);
      setSwipeDirection(direction);
      play('click');
      vibrate('buttonPress');
    },
    [playing, sendAction, play, vibrate],
  );

  // Keyboard controls (never hijack typing in chat/inputs).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const map: Record<string, 'up' | 'down' | 'left' | 'right'> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      };
      const direction = map[event.key];
      if (!direction) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      send(direction);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [send]);

  // Clear the swipe indicator shortly after each move.
  useEffect(() => {
    if (!swipeDirection) return;
    const timer = window.setTimeout(() => setSwipeDirection(null), 250);
    return () => window.clearTimeout(timer);
  }, [swipeDirection]);

  // Feedback: score jumps and board lock.
  useEffect(() => {
    const score = myBoard?.score ?? 0;
    const locked = myBoard?.locked ?? false;
    if (previousScore.current !== null && score > previousScore.current) {
      play('score');
      vibrate('success');
    }
    if (locked && !previousLocked.current) {
      play('wrong');
      vibrate('error');
    }
    previousScore.current = score;
    previousLocked.current = locked;
  }, [myBoard?.score, myBoard?.locked, play, vibrate]);

  if (phase === 'idle' || !myBoard) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Preparing the boards…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state?.scores?.[player.id] ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        deadline={state?.endsAt ?? null}
        label="Match time"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone="primary">You · {myBoard.score} pts</Badge>
        <Badge tone={myBoard.locked ? 'danger' : 'default'}>Best tile {myBoard.bestTile}</Badge>
        {myBoard.locked ? (
          <Badge tone="danger" icon={<Lock className="h-3 w-3" aria-hidden />}>
            Board locked — waiting for your rival
          </Badge>
        ) : null}
        {phase === 'finished' ? <Badge tone="success">Match complete</Badge> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-3">
          <Board board={myBoard} onSwipe={send} interactive={playing} />

          {/* On-screen D-pad (touch friendly, always available). */}
          <div className="mx-auto grid w-44 grid-cols-3 grid-rows-2 gap-2">
            {DPAD.map(({ direction, icon: Icon, label, area }) => (
              <button
                key={direction}
                type="button"
                aria-label={label}
                disabled={!playing}
                onClick={() => send(direction)}
                className={cn(
                  'grid h-14 place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition active:scale-95 disabled:opacity-40',
                  area,
                  swipeDirection === direction && 'border-primary-400/60 bg-primary-500/20',
                )}
              >
                <Icon className="h-6 w-6" aria-hidden />
              </button>
            ))}
          </div>
          <p className="text-center text-xs text-slate-500">
            Arrow keys, swipe or D-pad — the server validates every move.
          </p>
        </div>

        <aside className="card w-full space-y-2 p-3 lg:w-56">
          <h4 className="text-sm font-semibold text-white">Rival board</h4>
          {opponent && opponentBoard ? (
            <>
              <p className="flex items-center justify-between text-xs text-slate-300">
                <span className="truncate">
                  {opponent.nickname}
                  {opponent.isAI ? ' (AI)' : ''}
                </span>
                <span className="tabular-nums">{opponentBoard.score} pts</span>
              </p>
              <MiniBoard board={opponentBoard} />
              {opponentBoard.locked ? (
                <Badge tone="warning" icon={<Lock className="h-3 w-3" aria-hidden />}>
                  Board locked
                </Badge>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-slate-500">Waiting for a rival board…</p>
          )}
        </aside>
      </div>
    </div>
  );
}

export const battle2048Client: ClientGameModule = {
  metadata: BATTLE_2048_METADATA,
  Component: Battle2048Game as unknown as ComponentType<GameComponentProps<never>>,
};
