import { useCallback, useEffect, useMemo, useRef, type ComponentType } from 'react';
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
  consecutiveSixes: number;
  legalMoves: LudoLegalMove[];
  turnOrder: string[];
  turnEndsAt: number | null;
  tokensToWin: number;
  finishedOrder: string[];
  lastEvent: string | null;
  lastMove: { playerId: string; tokenId: string; from: number; to: number; captured: string | null } | null;
  finishReason: string | null;
  serverTime: number;
  boardSize: number;
  trackCells: Cell[];
  safeIndices: number[];
  homeStretchCells: Record<number, Cell[]>;
  yardCells: Record<number, Cell[]>;
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
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
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

function LudoGame({ state, players, myPlayerId, sendAction, play, vibrate }: GameComponentProps<LudoPublicState>) {
  const previousEvent = useRef<string | null>(null);

  const phase = state?.phase ?? 'idle';
  const isMyTurn = Boolean(myPlayerId) && state?.currentPlayerId === myPlayerId;
  const canRoll = isMyTurn && phase === 'awaiting-roll';
  const canMove = isMyTurn && phase === 'awaiting-move';

  const roll = useCallback(() => {
    if (!canRoll) return;
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

  // Space/Enter rolls the dice on desktop.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)) {
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
    const result: Array<{ token: LudoTokenView; cell: Cell; seatIndex: number; playerId: string }> = [];
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
        if (cell) result.push({ token, cell, seatIndex: slot.seatIndex, playerId });
      });
    }
    return result;
  }, [state]);

  const movableTokenIds = useMemo(
    () => new Set((state?.legalMoves ?? []).map((move) => move.tokenId)),
    [state?.legalMoves],
  );

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
          const isSafe = trackIndex !== undefined && state.safeIndices?.includes(trackIndex);

          let background = 'transparent';
          if (yardSeat !== undefined) background = SEAT_SOFT[yardSeat] ?? 'transparent';
          else if (homeSeat !== undefined) background = SEAT_COLOR[homeSeat] ?? 'transparent';
          else if (trackIndex !== undefined) background = 'rgba(255,255,255,0.10)';
          if (isCenter) background = 'rgba(255,255,255,0.16)';

          const occupants = placed.filter((entry) => entry.cell.x === x && entry.cell.y === y);

          return (
            <div
              key={key}
              className={cn(
                'relative aspect-square rounded-[2px]',
                trackIndex !== undefined && 'border border-white/10',
              )}
              style={{ background }}
            >
              {isSafe ? (
                <span className="absolute inset-0 grid place-items-center text-[8px] text-white/70" aria-hidden>
                  ★
                </span>
              ) : null}
              {occupants.map((entry, position) => {
                const movable = canMove && movableTokenIds.has(entry.token.id) && entry.playerId === myPlayerId;
                return (
                  <motion.button
                    key={entry.token.id}
                    type="button"
                    layout
                    transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                    disabled={!movable}
                    onClick={() => movable && moveToken(entry.token.id)}
                    aria-label={movable ? `Move token ${entry.token.id}` : `Token ${entry.token.id}`}
                    className={cn(
                      'absolute rounded-full border border-black/40',
                      movable && 'ring-2 ring-white ring-offset-1 ring-offset-black/40',
                    )}
                    style={{
                      backgroundColor: SEAT_COLOR[entry.seatIndex] ?? '#94a3b8',
                      inset: '14%',
                      transform: `translate(${position * 12}%, ${position * 12}%)`,
                      cursor: movable ? 'pointer' : 'default',
                      zIndex: movable ? 5 : 1,
                    }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Dice + controls */}
      <div className="flex flex-col items-center gap-3">
        <Die value={state.dice} rolling={phase === 'awaiting-move'} />
        {canRoll ? (
          <Button onClick={roll} className="min-w-40">
            Roll dice
          </Button>
        ) : canMove ? (
          <p className="text-sm text-emerald-300">
            Rolled {state.dice} — tap a highlighted token ({state.legalMoves.length} option
            {state.legalMoves.length === 1 ? '' : 's'})
          </p>
        ) : (
          <p className="text-sm text-slate-400">
            {currentPlayer ? `Waiting for ${currentPlayer.nickname}…` : 'Waiting…'}
          </p>
        )}
      </div>

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
