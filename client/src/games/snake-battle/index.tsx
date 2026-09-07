import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Skull } from 'lucide-react';
import { SNAKE_BATTLE_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface SnakePublic {
  body: Array<{ x: number; y: number }>;
  direction: string;
  alive: boolean;
  score: number;
  foodEaten: number;
  disconnected: boolean;
}

export interface SnakeBattlePublicState {
  phase: 'idle' | 'playing' | 'finished';
  cols: number;
  rows: number;
  stepMs: number;
  stepIndex: number;
  startedAt: number | null;
  endsAt: number | null;
  serverTime: number;
  foods: Array<{ x: number; y: number }>;
  snakes: Record<string, SnakePublic | null>;
  lastEvent: string | null;
}

const DPAD: Array<{
  direction: 'up' | 'down' | 'left' | 'right';
  icon: typeof ArrowUp;
  label: string;
  area: string;
}> = [
  { direction: 'up', icon: ArrowUp, label: 'Turn up', area: 'col-start-2 row-start-1' },
  { direction: 'left', icon: ArrowLeft, label: 'Turn left', area: 'col-start-1 row-start-2' },
  { direction: 'down', icon: ArrowDown, label: 'Turn down', area: 'col-start-2 row-start-2' },
  { direction: 'right', icon: ArrowRight, label: 'Turn right', area: 'col-start-3 row-start-2' },
];

const SNAKE_COLORS = ['#818cf8', '#34d399'];

function SnakeBattleGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<SnakeBattlePublicState>) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousDeaths = useRef(0);
  const previousFood = useRef(0);

  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.snakes?.[myPlayerId] : undefined;
  const opponent = players.find((player) => player.id !== myPlayerId);
  const canSteer = phase === 'playing' && me?.alive;

  const turn = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      if (!canSteer) return;
      sendAction({ type: 'turn', payload: { direction } } satisfies GameAction);
      play('click');
      vibrate('buttonPress');
    },
    [canSteer, sendAction, play, vibrate],
  );

  // Keyboard: arrows + WASD (never while typing in chat/inputs).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const map: Record<string, 'up' | 'down' | 'left' | 'right'> = {
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
        w: 'up', s: 'down', a: 'left', d: 'right',
        W: 'up', S: 'down', A: 'left', D: 'right',
      };
      const direction = map[event.key];
      if (!direction) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      turn(direction);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [turn]);

  // Feedback: food eaten / a death.
  const totalFood = Object.values(state?.snakes ?? {}).reduce(
    (sum, snake) => sum + (snake?.foodEaten ?? 0),
    0,
  );
  const deaths = Object.values(state?.snakes ?? {}).filter((snake) => snake && !snake.alive).length;
  useEffect(() => {
    if (totalFood > previousFood.current) {
      play('score');
      vibrate('success');
    }
    previousFood.current = totalFood;
  }, [totalFood, play, vibrate]);
  useEffect(() => {
    if (deaths > previousDeaths.current) {
      if (!me?.alive) {
        play('defeat');
        vibrate('error');
      } else {
        play('gameOver');
      }
    }
    previousDeaths.current = deaths;
  }, [deaths, me?.alive, play, vibrate]);

  if (phase === 'idle') {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Placing the snakes on the grid…</p>
        </div>
      </div>
    );
  }

  const { cols, rows, foods, snakes } = state;
  const occupancy = new Map<string, Array<{ playerId: string; isHead: boolean }>>();
  for (const player of players) {
    const snake = snakes?.[player.id];
    if (!snake?.alive) continue;
    snake.body.forEach((segment, index) => {
      const key = `${segment.x},${segment.y}`;
      const list = occupancy.get(key) ?? [];
      list.push({ playerId: player.id, isHead: index === 0 });
      occupancy.set(key, list);
    });
  }
  const foodKeys = new Set((foods ?? []).map((food) => `${food.x},${food.y}`));

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.snakes?.[player.id]?.score ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Match time"
      />

      <div className="flex flex-wrap items-center gap-2">
        {me ? (
          me.alive ? (
            <Badge tone="primary">You · {me.score} pts · {me.foodEaten} food</Badge>
          ) : (
            <Badge tone="danger" icon={<Skull className="h-3 w-3" aria-hidden />}>You crashed</Badge>
          )
        ) : null}
        {opponent && state.snakes?.[opponent.id] ? (
          state.snakes[opponent.id]!.alive ? (
            <Badge tone="default">{opponent.nickname} · {state.snakes[opponent.id]!.score} pts</Badge>
          ) : (
            <Badge tone="success">{opponent.nickname} crashed</Badge>
          )
        ) : null}
        {phase === 'finished' ? <Badge tone="accent">Match over</Badge> : null}
      </div>

      <div className="mx-auto w-full max-w-md">
        <div
          role="grid"
          aria-label="Snake arena"
          className="touch-none grid gap-0 overflow-hidden rounded-2xl border border-white/10 bg-black/50 p-1 select-none"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
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
            if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 'right' : 'left');
            else turn(dy > 0 ? 'down' : 'up');
          }}
        >
          {Array.from({ length: cols * rows }, (_, index) => {
            const x = index % cols;
            const y = Math.floor(index / cols);
            const key = `${x},${y}`;
            const occupants = occupancy.get(key) ?? [];
            const isFood = foodKeys.has(key);
            const first = occupants[0];
            const seat = first
              ? Math.max(0, players.findIndex((player) => player.id === first.playerId))
              : 0;
            return (
              <div
                key={key}
                className={cn(
                  'relative grid aspect-square place-items-center rounded-[2px]',
                  !first && !isFood && 'bg-white/[0.03]',
                )}
                style={
                  first
                    ? {
                        backgroundColor: SNAKE_COLORS[seat % SNAKE_COLORS.length],
                        opacity: first.isHead ? 1 : 0.75,
                        borderRadius: first.isHead ? 4 : 2,
                      }
                    : undefined
                }
              >
                {isFood && !first ? (
                  <span className="h-3/5 w-3/5 rounded-full bg-warning shadow-[0_0_8px_rgba(245,158,11,0.8)]" aria-label="food" />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* D-pad below the arena — never covering gameplay. */}
      <div className="mx-auto grid w-44 grid-cols-3 grid-rows-2 gap-2">
        {DPAD.map(({ direction, icon: Icon, label, area }) => (
          <button
            key={direction}
            type="button"
            aria-label={label}
            disabled={!canSteer}
            onClick={() => turn(direction)}
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
        WASD / arrows / swipe / D-pad — the server moves both snakes on its clock.
      </p>
    </div>
  );
}

export const snakeBattleClient: ClientGameModule = {
  metadata: SNAKE_BATTLE_METADATA,
  Component: SnakeBattleGame as unknown as ComponentType<GameComponentProps<never>>,
};
