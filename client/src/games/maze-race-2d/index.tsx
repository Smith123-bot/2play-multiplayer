import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Flag } from 'lucide-react';
import { MAZE_RACE_METADATA, type GameAction, type Player } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface MazeRunnerPublic {
  x: number;
  y: number;
  steps: number;
  finished: boolean;
  finishMs: number | null;
  disconnected: boolean;
  checkpointIndex: number;
  penaltyMs: number;
  latestInputSeq: number;
}

export interface MazeRacePublicState {
  phase: 'idle' | 'playing' | 'finished';
  cols: number;
  rows: number;
  walls: boolean[];
  goal: { x: number; y: number };
  checkpoints: Array<{ x: number; y: number }>;
  hazards: Array<{ x: number; y: number; penaltyMs: number }>;
  courseLevel: number;
  lastEvent: string | null;
  finishOrder: string[];
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  serverTime: number;
  finishReason: string | null;
  runners: Record<string, MazeRunnerPublic | null>;
}

/** Stable player colours by seat. */
const RUNNER_COLORS = ['#818cf8', '#34d399', '#f472b6', '#fbbf24'];

function runnerColor(players: Player[], playerId: string | null): string {
  const seat = players.findIndex((player) => player.id === playerId);
  return RUNNER_COLORS[Math.max(0, seat) % RUNNER_COLORS.length]!;
}

function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
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

function MazeRaceGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<MazeRacePublicState>) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const inputSequence = useRef(0);
  const previousEvent = useRef<string | null>(null);

  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.runners?.[myPlayerId] : undefined;
  const playing = phase === 'playing' && !me?.finished;

  const send = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      if (!playing) return;
      inputSequence.current = Math.max(inputSequence.current, me?.latestInputSeq ?? -1) + 1;
      sendAction({
        type: 'move',
        payload: { direction, sequence: inputSequence.current },
      } satisfies GameAction);
      play('click');
      vibrate('buttonPress');
    },
    [me?.latestInputSeq, playing, sendAction, play, vibrate],
  );

  // Keyboard controls (never while typing in chat/inputs).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const map: Record<string, 'up' | 'down' | 'left' | 'right'> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        w: 'up',
        W: 'up',
        s: 'down',
        S: 'down',
        a: 'left',
        A: 'left',
        d: 'right',
        D: 'right',
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

  // Sound when someone crosses the line.
  const previousFinishers = useRef(0);
  useEffect(() => {
    const finishers = state?.finishOrder?.length ?? 0;
    if (finishers > previousFinishers.current) {
      const last = state?.finishOrder?.[finishers - 1];
      if (last === myPlayerId) {
        play('victory');
        vibrate('victory');
      } else {
        play('notification');
      }
    }
    previousFinishers.current = finishers;
  }, [state?.finishOrder, myPlayerId, play, vibrate]);

  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (!event || event === previousEvent.current) return;
    previousEvent.current = event;
    if (event.startsWith(`checkpoint:${myPlayerId}:`)) {
      play('score');
      vibrate('success');
    } else if (event.startsWith(`hazard:${myPlayerId}:`)) {
      play('wrong');
      vibrate('error');
    } else if (event.startsWith(`goal-locked:${myPlayerId}:`)) {
      play('wrong');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state?.walls?.some((wall) => !wall)) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Carving the maze…</p>
        </div>
      </div>
    );
  }

  const { cols, walls, goal } = state;
  const myRank = myPlayerId ? state.finishOrder.indexOf(myPlayerId) + 1 : 0;

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.runners?.[player.id]?.steps ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Race clock"
      />

      <div className="flex flex-wrap items-center gap-2">
        {me?.finished ? (
          <Badge tone="success">
            You finished · rank {myRank} · {formatMs(me.finishMs ?? 0)}
          </Badge>
        ) : playing ? (
          <Badge tone="primary">Steps {me?.steps ?? 0}</Badge>
        ) : null}
        <Badge tone="accent">
          Checkpoint {me?.checkpointIndex ?? 0}/{state.checkpoints?.length ?? 0}
        </Badge>
        <Badge tone="primary">Course {state.courseLevel ?? 1}/3</Badge>
        {(me?.penaltyMs ?? 0) > 0 ? (
          <Badge tone="warning">Penalty +{formatMs(me?.penaltyMs ?? 0)}</Badge>
        ) : null}
        {phase === 'finished' ? <Badge tone="accent">Race over</Badge> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-3">
          <div
            role="grid"
            aria-label="Maze"
            className="touch-none mx-auto grid w-full max-w-md gap-0 overflow-hidden rounded-2xl border border-white/10 bg-black/50 p-1 select-none"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            onTouchStart={(event) => {
              const touch = event.changedTouches[0];
              touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
              movedRef.current = false;
            }}
            onTouchMove={(event) => {
              const start = touchStart.current;
              if (!start || movedRef.current) return;
              const touch = event.changedTouches[0];
              if (!touch) return;
              const dx = touch.clientX - start.x;
              const dy = touch.clientY - start.y;
              if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) return;
              movedRef.current = true;
              if (Math.abs(dx) > Math.abs(dy)) send(dx > 0 ? 'right' : 'left');
              else send(dy > 0 ? 'down' : 'up');
            }}
            onTouchEnd={() => {
              touchStart.current = null;
            }}
          >
            {walls.map((wall, index) => {
              const x = index % cols;
              const y = Math.floor(index / cols);
              const isGoal = x === goal.x && y === goal.y;
              const checkpointIndex =
                state.checkpoints?.findIndex((cell) => cell.x === x && cell.y === y) ?? -1;
              const hazard = state.hazards?.find((cell) => cell.x === x && cell.y === y);
              const occupants = players.filter((player) => {
                const runner = state.runners?.[player.id];
                return runner && runner.x === x && runner.y === y;
              });
              return (
                <div
                  key={index}
                  className={cn(
                    'relative grid aspect-square place-items-center',
                    wall ? 'bg-slate-700/90' : 'bg-slate-200/10',
                  )}
                >
                  {isGoal ? (
                    <Flag className="h-3.5 w-3.5 text-warning sm:h-4 sm:w-4" aria-label="Goal" />
                  ) : null}
                  {checkpointIndex >= 0 ? (
                    <span
                      className="grid h-3.5 w-3.5 place-items-center rounded-full bg-cyan-400 text-[8px] font-bold text-slate-950 sm:h-4 sm:w-4"
                      aria-label={`Checkpoint ${checkpointIndex + 1}`}
                    >
                      {checkpointIndex + 1}
                    </span>
                  ) : null}
                  {hazard ? (
                    <span
                      className="text-[9px] text-rose-400"
                      title={`Hazard: +${formatMs(hazard.penaltyMs)}`}
                    >
                      ▲
                    </span>
                  ) : null}
                  {occupants.length > 0 ? (
                    <div className="absolute inset-0 grid place-items-center">
                      <div className="relative flex items-center">
                        {occupants.map((player, position) => {
                          const isMe = player.id === myPlayerId;
                          return (
                            <span
                              key={player.id}
                              title={player.nickname}
                              className={cn(
                                'grid h-3.5 w-3.5 place-items-center rounded-full text-[7px] shadow sm:h-5 sm:w-5 sm:text-[10px]',
                                isMe && 'ring-2 ring-white',
                              )}
                              style={{
                                backgroundColor: runnerColor(players, player.id),
                                marginLeft: position > 0 ? -4 : 0,
                              }}
                            >
                              {player.avatar.slice(0, 1)}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="text-center text-xs text-slate-500">
            Visit checkpoints in order, avoid time hazards, then reach the flag · movement is server
            validated
          </p>
        </div>

        <div className="space-y-4">
          {/* On-screen D-pad (touch friendly). */}
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
                )}
              >
                <Icon className="h-6 w-6" aria-hidden />
              </button>
            ))}
          </div>

          <aside className="card w-full space-y-1.5 p-3 lg:w-56">
            <h4 className="text-sm font-semibold text-white">Race status</h4>
            {state.finishOrder.length === 0 ? (
              <p className="text-xs text-slate-500">Nobody has finished yet.</p>
            ) : (
              <ol className="space-y-1">
                {state.finishOrder.map((playerId, index) => {
                  const player = players.find((entry) => entry.id === playerId);
                  const runner = state.runners?.[playerId];
                  return (
                    <li
                      key={playerId}
                      className="flex items-center justify-between text-xs text-slate-300"
                    >
                      <span className="truncate">
                        {index + 1}. {player?.nickname ?? 'Player'}
                        {playerId === myPlayerId ? ' (you)' : ''}
                      </span>
                      <span className="tabular-nums">
                        {runner?.finishMs != null ? formatMs(runner.finishMs) : '—'}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

export const mazeRaceClient: ClientGameModule = {
  metadata: MAZE_RACE_METADATA,
  Component: MazeRaceGame as unknown as ComponentType<GameComponentProps<never>>,
};
