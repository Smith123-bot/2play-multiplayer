import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { LUDO_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { cn } from '../../utils/cn';

interface Cell {
  x: number;
  y: number;
}

interface LudoTokenView {
  id: string;
  progress: number;
  cell: number | null;
  seatIndex: number;
}

interface LudoLegalMove {
  tokenId: string;
  from: number;
  to: number;
  capturesTokenId: string | null;
  entersBoard: boolean;
  reachesHome: boolean;
}

export interface LudoPublicState {
  phase: 'idle' | 'awaiting-roll' | 'awaiting-move' | 'finished';
  currentPlayerId: string | null;
  dice: number | null;
  /** The last roll of the match — kept visible after the turn passes. */
  lastRoll?: { playerId: string; value: number; playable: boolean } | null;
  consecutiveSixes: number;
  legalMoves: LudoLegalMove[];
  turnOrder: string[];
  turnEndsAt: number | null;
  tokensToWin: number;
  finishedOrder: string[];
  lastEvent: string | null;
  lastMove: {
    id: number;
    playerId: string;
    tokenId: string;
    from: number;
    to: number;
    path: number[];
    captured: string | null;
    capturedFrom: number | null;
  } | null;
  finishReason: string | null;
  serverTime: number;
  boardSize: number;
  trackCells: Cell[];
  safeIndices: number[];
  homeStretchCells: Record<number, Cell[]>;
  yardCells: Record<number, Cell[]>;
  startIndex: Record<number, number>;
  trackLength: number;
  finishDistance: number;
  players: Record<
    string,
    {
      seatIndex: number;
      color: string;
      score: number;
      captures: number;
      finishedTokens: number;
      rank: number;
      disconnected: boolean;
      left: boolean;
      tokens: LudoTokenView[];
    }
  >;
}

const SEAT_COLOR: Record<number, string> = {
  0: '#ef4444',
  1: '#22c55e',
  2: '#eab308',
  3: '#3b82f6',
};

const SEAT_SOFT: Record<number, string> = {
  0: 'rgba(239,68,68,0.18)',
  1: 'rgba(34,197,94,0.18)',
  2: 'rgba(234,179,8,0.18)',
  3: 'rgba(59,130,246,0.18)',
};

/** Pip layout for a die face. */
const PIPS: Record<number, Array<[number, number]>> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
  ],
};

function Die({ value, rolling }: { value: number | null; rolling: boolean }) {
  return (
    <motion.div
      animate={rolling ? { rotate: [0, -12, 12, 0] } : { rotate: 0 }}
      transition={{ duration: 0.45 }}
      className="grid h-16 w-16 grid-cols-3 grid-rows-3 gap-[3px] rounded-xl border border-white/20 bg-white/95 p-2 shadow-lg"
      aria-label={value ? `Dice showing ${value}` : 'Dice'}
    >
      {Array.from({ length: 9 }, (_unused, index) => {
        const col = index % 3;
        const row = Math.floor(index / 3);
        const on = value ? (PIPS[value] ?? []).some(([px, py]) => px === col && py === row) : false;
        return (
          <span
            key={index}
            className={cn('rounded-full', on ? 'bg-slate-900' : 'bg-transparent')}
          />
        );
      })}
    </motion.div>
  );
}

function LudoGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<LudoPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const [rolling, setRolling] = useState(false);

  const phase = state?.phase ?? 'idle';
  const lastRoll = state?.lastRoll ?? null;
  const lastRollWasMine = Boolean(myPlayerId) && lastRoll?.playerId === myPlayerId;
  const lastRoller = players.find((player) => player.id === lastRoll?.playerId);
  const isMyTurn = Boolean(myPlayerId) && state?.currentPlayerId === myPlayerId;
  const canRoll = isMyTurn && phase === 'awaiting-roll';
  const canMove = isMyTurn && phase === 'awaiting-move';

  const roll = useCallback(() => {
    if (!canRoll) return;
    setRolling(true);
    sendAction({ type: 'roll' } satisfies GameAction);
    play('click');
    vibrate('buttonPress');
  }, [canRoll, sendAction, play, vibrate]);

  const moveToken = useCallback(
    (tokenId: string) => {
      if (!canMove) return;
      sendAction({ type: 'move', payload: { tokenId } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [canMove, sendAction, vibrate],
  );

  useEffect(() => {
    if (!rolling) return;
    const timer = window.setTimeout(() => setRolling(false), 520);
    return () => window.clearTimeout(timer);
  }, [rolling, state?.lastRoll]);

  // Space/Enter rolls the dice on desktop.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        roll();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [roll]);

  // Server-driven audio + haptics.
  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (event === previousEvent.current) return;
    previousEvent.current = event;
    if (!event) return;
    const mine = myPlayerId ? event.includes(myPlayerId) : false;
    if (event.startsWith('roll:')) play('click');
    else if (event.startsWith('capture:')) {
      play(mine ? 'score' : 'wrong');
      vibrate(mine ? 'success' : 'error');
    } else if (event.startsWith('home:')) {
      play('correct');
      if (mine) vibrate('success');
    } else if (event.startsWith('finished:')) {
      play(mine ? 'victory' : 'notification');
      if (mine) vibrate('victory');
    } else if (event.startsWith('move:')) play('click');
    else if (event.startsWith('timeout:')) play('timerWarning');
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  const size = state?.boardSize ?? 15;

  /** Maps every token to a grid cell for rendering. */
  const placed = useMemo(() => {
    const result: Array<{
      token: LudoTokenView;
      cell: Cell;
      seatIndex: number;
      playerId: string;
      tokenIndex: number;
    }> = [];
    if (!state?.players) return result;
    for (const [playerId, slot] of Object.entries(state.players)) {
      slot.tokens.forEach((token, index) => {
        let cell: Cell | undefined;
        if (token.progress < 0) {
          cell = state.yardCells?.[slot.seatIndex]?.[index];
        } else if (token.progress >= state.finishDistance) {
          // Home: cluster around the centre.
          const offsets = [
            { x: 7, y: 6 },
            { x: 8, y: 7 },
            { x: 7, y: 8 },
            { x: 6, y: 7 },
          ];
          cell = offsets[slot.seatIndex % 4];
        } else if (token.progress >= state.trackLength) {
          cell = state.homeStretchCells?.[slot.seatIndex]?.[token.progress - state.trackLength];
        } else if (token.cell !== null && token.cell !== undefined) {
          cell = state.trackCells?.[token.cell];
        }
        if (cell)
          result.push({ token, cell, seatIndex: slot.seatIndex, playerId, tokenIndex: index });
      });
    }
    return result;
  }, [state]);

  const cellForProgress = useCallback(
    (seat: number, progress: number, tokenIndex: number): Cell | undefined => {
      if (!state) return undefined;
      if (progress < 0) return state.yardCells?.[seat]?.[tokenIndex];
      if (progress >= state.finishDistance) {
        const homes = [
          { x: 7, y: 6 },
          { x: 8, y: 7 },
          { x: 7, y: 8 },
          { x: 6, y: 7 },
        ];
        return homes[seat % 4];
      }
      if (progress >= state.trackLength)
        return state.homeStretchCells?.[seat]?.[progress - state.trackLength];
      const absolute = ((state.startIndex?.[seat] ?? 0) + progress) % state.trackLength;
      return state.trackCells?.[absolute];
    },
    [state],
  );

  const movableTokenIds = useMemo(
    () => new Set((state?.legalMoves ?? []).map((move) => move.tokenId)),
    [state?.legalMoves],
  );

  const legalDestinationSet = useMemo(() => {
    const destinations = new Set<string>();
    if (!myPlayerId || !state?.players?.[myPlayerId]) return destinations;
    const seat = state.players[myPlayerId]!.seatIndex;
    for (const move of state.legalMoves ?? []) {
      let cell: Cell | undefined;
      if (move.to >= state.finishDistance) cell = { x: 7, y: 7 };
      else if (move.to >= state.trackLength)
        cell = state.homeStretchCells?.[seat]?.[move.to - state.trackLength];
      else {
        const absolute = ((state.startIndex?.[seat] ?? 0) + move.to) % state.trackLength;
        cell = state.trackCells?.[absolute];
      }
      if (cell) destinations.add(`${cell.x}:${cell.y}`);
    }
    return destinations;
  }, [myPlayerId, state]);

  const trackSet = useMemo(() => {
    const map = new Map<string, number>();
    (state?.trackCells ?? []).forEach((cell, index) => map.set(`${cell.x}:${cell.y}`, index));
    return map;
  }, [state?.trackCells]);

  const homeSet = useMemo(() => {
    const map = new Map<string, number>();
    Object.entries(state?.homeStretchCells ?? {}).forEach(([seat, cells]) => {
      for (const cell of cells) map.set(`${cell.x}:${cell.y}`, Number(seat));
    });
    return map;
  }, [state?.homeStretchCells]);

  const yardSet = useMemo(() => {
    const map = new Map<string, number>();
    Object.entries(state?.yardCells ?? {}).forEach(([seat, cells]) => {
      for (const cell of cells) map.set(`${cell.x}:${cell.y}`, Number(seat));
    });
    return map;
  }, [state?.yardCells]);

  if (phase === 'idle' || !state?.trackCells?.length) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Setting up the board…</p>
        </div>
      </div>
    );
  }

  const currentPlayer = players.find((player) => player.id === state.currentPlayerId);
  const standings = [...players].sort((a, b) => {
    const left = state.players?.[a.id];
    const right = state.players?.[b.id];
    if ((left?.rank ?? 0) && (right?.rank ?? 0)) return left!.rank - right!.rank;
    if (left?.rank) return -1;
    if (right?.rank) return 1;
    return (
      (right?.finishedTokens ?? 0) - (left?.finishedTokens ?? 0) ||
      (right?.score ?? 0) - (left?.score ?? 0)
    );
  });
  const eventMessage = state.lastEvent?.startsWith('capture:')
    ? 'Token captured — bonus roll!'
    : state.lastEvent?.startsWith('home:')
      ? 'Token reached home — roll again!'
      : state.lastEvent?.startsWith('triple-six:')
        ? 'Three sixes — turn forfeited'
        : state.lastEvent?.startsWith('timeout:')
          ? 'Turn timed out'
          : null;

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.players?.[player.id]?.score ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        deadline={state.turnEndsAt ?? null}
        label="Turn"
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge tone={isMyTurn ? 'success' : 'default'}>
          {isMyTurn ? 'Your turn' : currentPlayer ? `${currentPlayer.nickname}'s turn` : 'Waiting'}
        </Badge>
        <Badge tone="default">Bring {state.tokensToWin} home</Badge>
        {state.finishedOrder.length > 0 ? (
          <Badge tone="success">{state.finishedOrder.length} finished</Badge>
        ) : null}
      </div>

      {eventMessage ? (
        <motion.div
          key={`${state.lastEvent}-${state.lastMove?.tokenId ?? ''}`}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto rounded-full border border-amber-300/30 bg-amber-400/10 px-4 py-1.5 text-center text-xs font-semibold text-amber-200"
        >
          {eventMessage}
        </motion.div>
      ) : null}

      {/* Board */}
      <div
        className="relative mx-auto grid w-full max-w-[min(92vw,30rem)] gap-px overflow-hidden rounded-2xl border border-white/10 bg-black/60 p-1"
        style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
        role="grid"
        aria-label="Ludo board"
      >
        {Array.from({ length: size * size }, (_unused, index) => {
          const x = index % size;
          const y = Math.floor(index / size);
          const key = `${x}:${y}`;
          const trackIndex = trackSet.get(key);
          const homeSeat = homeSet.get(key);
          const yardSeat = yardSet.get(key);
          const isCenter = x === 7 && y === 7;
          const destination = legalDestinationSet.has(key);
          const yardQuarter =
            x < 6 && y < 6
              ? 0
              : x > 8 && y < 6
                ? 1
                : x > 8 && y > 8
                  ? 2
                  : x < 6 && y > 8
                    ? 3
                    : undefined;
          const isSafe = trackIndex !== undefined && state.safeIndices?.includes(trackIndex);

          let background =
            yardQuarter === undefined ? 'transparent' : (SEAT_SOFT[yardQuarter] ?? 'transparent');
          if (yardSeat !== undefined) background = SEAT_SOFT[yardSeat] ?? 'transparent';
          else if (homeSeat !== undefined) background = SEAT_COLOR[homeSeat] ?? 'transparent';
          else if (trackIndex !== undefined) background = 'rgba(255,255,255,0.10)';
          if (isCenter) background = 'rgba(255,255,255,0.16)';

          return (
            <div
              key={key}
              className={cn(
                'relative aspect-square rounded-[2px]',
                trackIndex !== undefined && 'border border-white/10',
              )}
              style={{ background }}
            >
              {destination ? (
                <span
                  className="absolute inset-[20%] animate-pulse rounded-full bg-white/30 ring-1 ring-white/70"
                  aria-hidden
                />
              ) : null}
              {isSafe ? (
                <span
                  className="absolute inset-0 grid place-items-center text-[8px] text-white/70"
                  aria-hidden
                >
                  ★
                </span>
              ) : null}
            </div>
          );
        })}

        {/* Tokens live in one overlay so Framer can animate every server-authored
            board step instead of jumping between unrelated grid-cell parents. */}
        <div className="pointer-events-none absolute inset-1" aria-live="polite">
          {placed.map((entry) => {
            const movable =
              canMove && movableTokenIds.has(entry.token.id) && entry.playerId === myPlayerId;
            const move = state.lastMove;
            let motionCells: Cell[] = [entry.cell];
            if (move?.tokenId === entry.token.id) {
              const from = cellForProgress(entry.seatIndex, move.from, entry.tokenIndex);
              motionCells = [
                from,
                ...move.path.map((step) =>
                  cellForProgress(entry.seatIndex, step, entry.tokenIndex),
                ),
              ].filter((cell): cell is Cell => Boolean(cell));
            } else if (move?.captured === entry.token.id && move.capturedFrom !== null) {
              const from = cellForProgress(entry.seatIndex, move.capturedFrom, entry.tokenIndex);
              const yard = cellForProgress(entry.seatIndex, -1, entry.tokenIndex);
              motionCells = [from, yard].filter((cell): cell is Cell => Boolean(cell));
            }
            const sameCell = placed.filter(
              (other) => other.cell.x === entry.cell.x && other.cell.y === entry.cell.y,
            );
            const stackIndex = Math.max(
              0,
              sameCell.findIndex((other) => other.token.id === entry.token.id),
            );
            const offset = stackIndex * 0.12;
            const left = motionCells.map((cell) => `${((cell.x + 0.16 + offset) / size) * 100}%`);
            const top = motionCells.map((cell) => `${((cell.y + 0.16 + offset) / size) * 100}%`);
            const isLatest = move?.tokenId === entry.token.id || move?.captured === entry.token.id;
            return (
              <motion.button
                key={`${entry.token.id}-${isLatest ? move?.id : 'still'}`}
                type="button"
                disabled={!movable}
                onClick={() => movable && moveToken(entry.token.id)}
                aria-label={movable ? `Move token ${entry.token.id}` : `Token ${entry.token.id}`}
                initial={
                  isLatest
                    ? {
                        left: left[0],
                        top: top[0],
                        scale: move?.captured === entry.token.id ? 1.3 : 0.9,
                      }
                    : false
                }
                animate={{ left, top, scale: movable ? [1, 1.12, 1] : 1 }}
                transition={{
                  left: {
                    duration: Math.min(1.2, Math.max(0.22, motionCells.length * 0.11)),
                    ease: 'easeInOut',
                  },
                  top: {
                    duration: Math.min(1.2, Math.max(0.22, motionCells.length * 0.11)),
                    ease: 'easeInOut',
                  },
                  scale: { duration: 0.7, repeat: movable ? Infinity : 0 },
                }}
                className={cn(
                  'pointer-events-auto absolute rounded-full border-2 border-black/50 shadow-lg',
                  movable && 'z-20 ring-2 ring-white ring-offset-2 ring-offset-black/40',
                )}
                style={{
                  width: `${(0.7 / size) * 100}%`,
                  aspectRatio: '1',
                  backgroundColor: SEAT_COLOR[entry.seatIndex] ?? '#94a3b8',
                  boxShadow: `0 0 ${movable ? 14 : 7}px ${SEAT_COLOR[entry.seatIndex] ?? '#94a3b8'}`,
                }}
              >
                <span className="sr-only">{entry.token.id}</span>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Dice + controls */}
      <div className="flex flex-col items-center gap-3">
        {/* `lastRoll` keeps the number on screen when the roll had no legal move
            and the server passed the turn in the same update. */}
        <button
          type="button"
          disabled={!canRoll}
          onClick={roll}
          className="rounded-2xl disabled:cursor-default"
          aria-label={canRoll ? 'Roll dice' : 'Dice'}
        >
          <Die value={state.dice ?? lastRoll?.value ?? null} rolling={rolling} />
        </button>
        {canRoll ? (
          <Button onClick={roll} className="min-w-40">
            Roll dice
          </Button>
        ) : canMove ? (
          <p className="text-sm text-emerald-300">
            Rolled {state.dice} — tap a highlighted token ({state.legalMoves.length} option
            {state.legalMoves.length === 1 ? '' : 's'})
          </p>
        ) : lastRoll && !lastRoll.playable ? (
          <p className="text-sm text-amber-300">
            {lastRollWasMine
              ? `You rolled ${lastRoll.value} — no moves.`
              : `${lastRoller?.nickname ?? 'Opponent'} rolled ${lastRoll.value} — no moves.`}
            {currentPlayer ? ` Waiting for ${currentPlayer.nickname}…` : ''}
          </p>
        ) : (
          <p className="text-sm text-slate-400">
            {currentPlayer ? `Waiting for ${currentPlayer.nickname}…` : 'Waiting…'}
          </p>
        )}
      </div>

      {phase === 'finished' ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="card mx-auto w-full max-w-md p-4"
        >
          <h3 className="mb-3 text-center text-lg font-bold">Final standings</h3>
          <ol className="space-y-2">
            {standings.map((player, index) => {
              const slot = state.players[player.id];
              return (
                <li
                  key={player.id}
                  className={cn(
                    'flex items-center justify-between rounded-xl px-3 py-2',
                    player.id === myPlayerId ? 'bg-indigo-500/20' : 'bg-white/5',
                  )}
                >
                  <span>
                    <b className="mr-2">#{index + 1}</b>
                    {player.nickname}
                  </span>
                  <span className="text-xs text-slate-300">
                    {slot?.finishedTokens ?? 0} home · {slot?.captures ?? 0} captures ·{' '}
                    {slot?.score ?? 0} pts
                  </span>
                </li>
              );
            })}
          </ol>
        </motion.div>
      ) : null}

      <div className="flex flex-wrap justify-center gap-3 text-xs text-slate-400">
        {players.map((player) => {
          const slot = state.players?.[player.id];
          if (!slot) return null;
          return (
            <span key={player.id} className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: SEAT_COLOR[slot.seatIndex] ?? '#94a3b8' }}
                aria-hidden
              />
              {player.nickname}: {slot.finishedTokens}/{state.tokensToWin} home
              {slot.disconnected ? ' (offline)' : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export const ludoClient: ClientGameModule = {
  metadata: LUDO_METADATA,
  Component: LudoGame as unknown as ComponentType<GameComponentProps<never>>,
};
