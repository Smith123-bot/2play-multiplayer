import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Swords, Trophy } from 'lucide-react';
import { LUDO_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
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
    playerId: string;
    tokenId: string;
    from: number;
    to: number;
    captured: string | null;
    moveNumber: number;
  } | null;
  moveNumber: number;
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
  0: 'rgba(239,68,68,0.22)',
  1: 'rgba(34,197,94,0.22)',
  2: 'rgba(234,179,8,0.22)',
  3: 'rgba(59,130,246,0.22)',
};

/** Yard zone bounds (top-left corner of each 6x6 corner) per seat. */
const YARD_ZONE: Record<number, { x0: number; y0: number }> = {
  0: { x0: 0, y0: 0 },
  1: { x0: 9, y0: 0 },
  2: { x0: 9, y0: 9 },
  3: { x0: 0, y0: 9 },
};

/** Where finished tokens rest inside the centre, per seat (grid coords). */
const FINISH_SPOT: Record<number, Cell> = {
  0: { x: 6.55, y: 7 },
  1: { x: 7, y: 6.55 },
  2: { x: 7.45, y: 7 },
  3: { x: 7, y: 7.45 },
};

/** Direction finished tokens of one seat spread as they stack. */
const FINISH_SPREAD: Record<number, Cell> = {
  0: { x: 0, y: 0.34 },
  1: { x: 0.34, y: 0 },
  2: { x: 0, y: -0.34 },
  3: { x: -0.34, y: 0 },
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

const STEP_MS = 150; // per-cell hop duration

function Die({ value, rolling, size = 'md' }: { value: number | null; rolling: boolean; size?: 'md' | 'lg' }) {
  const dims = size === 'lg' ? 'h-20 w-20 gap-[4px] p-2.5' : 'h-14 w-14 gap-[3px] p-2';
  return (
    <motion.div
      animate={rolling ? { rotate: [0, -14, 10, -6, 0], scale: [1, 1.06, 1] } : { rotate: 0, scale: 1 }}
      transition={{ duration: 0.5 }}
      className={cn('grid grid-cols-3 grid-rows-3 rounded-2xl border border-white/25 bg-white p-2 shadow-xl', dims)}
      aria-label={value ? `Dice showing ${value}` : 'Dice'}
    >
      {Array.from({ length: 9 }, (_unused, index) => {
        const col = index % 3;
        const row = Math.floor(index / 3);
        const on = value ? (PIPS[value] ?? []).some(([px, py]) => px === col && py === row) : false;
        return (
          <span
            key={index}
            className={cn('rounded-full transition-colors', on ? 'bg-slate-900' : 'bg-slate-900/0')}
          />
        );
      })}
    </motion.div>
  );
}

function LudoGame({ state, players, myPlayerId, sendAction, play, vibrate }: GameComponentProps<LudoPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const previousMoveNumber = useRef<number>(0);
  /** Keyframe paths for tokens currently animating: tokenId → grid positions. */
  const [animations, setAnimations] = useState<Record<string, Cell[]>>({});
  /** Token id currently flashing from a capture. */
  const [captureFlash, setCaptureFlash] = useState<string | null>(null);
  /** Transient celebration toast. */
  const [toast, setToast] = useState<{ text: string; tone: 'capture' | 'home' | 'info' } | null>(null);

  const phase = state?.phase ?? 'idle';
  const lastRoll = state?.lastRoll ?? null;
  const lastRollWasMine = Boolean(myPlayerId) && lastRoll?.playerId === myPlayerId;
  const lastRoller = players.find((player) => player.id === lastRoll?.playerId);
  const isMyTurn = Boolean(myPlayerId) && state?.currentPlayerId === myPlayerId;
  const canRoll = isMyTurn && phase === 'awaiting-roll';
  const canMove = isMyTurn && phase === 'awaiting-move';
  const currentPlayer = players.find((player) => player.id === state?.currentPlayerId);
  const currentSeat = state?.currentPlayerId ? state.players?.[state.currentPlayerId]?.seatIndex ?? 0 : -1;

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
  const trackLength = state?.trackLength ?? 52;
  const finishDistance = state?.finishDistance ?? 57;

  /** Grid position for a token at `progress` (yard uses its slot index). */
  const positionFor = useCallback(
    (seatIndex: number, progress: number, yardIndex: number, homeStack: number): Cell | undefined => {
      if (!state) return undefined;
      if (progress < 0) return state.yardCells?.[seatIndex]?.[yardIndex];
      if (progress >= finishDistance) {
        const spot = FINISH_SPOT[seatIndex % 4] ?? FINISH_SPOT[0]!;
        const spread = FINISH_SPREAD[seatIndex % 4] ?? FINISH_SPREAD[0]!;
        return { x: spot.x + spread.x * homeStack, y: spot.y + spread.y * homeStack };
      }
      if (progress >= trackLength) {
        return state.homeStretchCells?.[seatIndex]?.[progress - trackLength];
      }
      return undefined; // track positions need the absolute cell (caller supplies it)
    },
    [state, finishDistance, trackLength],
  );

  /**
   * Walks the path a move covers, cell by cell, so the token can hop through
   * every intermediate square instead of teleporting.
   */
  const pathFor = useCallback(
    (seatIndex: number, from: number, to: number, yardIndex: number): Cell[] => {
      if (!state) return [];
      const cells: Cell[] = [];
      const push = (cell: Cell | undefined) => {
        if (cell) cells.push(cell);
      };
      if (from < 0) {
        // Leaving the yard lands directly on the start square.
        push(state.trackCells?.[(seatIndex * 13) % 52]);
        return cells;
      }
      for (let progress = from + 1; progress <= to; progress += 1) {
        if (progress >= finishDistance) {
          push(positionFor(seatIndex, progress, yardIndex, 0));
        } else if (progress >= trackLength) {
          push(state.homeStretchCells?.[seatIndex]?.[progress - trackLength]);
        } else {
          const startCell = [0, 13, 26, 39][seatIndex % 4] ?? 0;
          push(state.trackCells?.[(startCell + progress) % 52]);
        }
      }
      return cells;
    },
    [state, finishDistance, trackLength, positionFor],
  );

  /** Tokens with their render position + stack offsets. */
  const placed = useMemo(() => {
    const result: Array<{
      token: LudoTokenView;
      cell: Cell;
      seatIndex: number;
      playerId: string;
      homeStack: number;
      stack: number;
    }> = [];
    if (!state?.players) return result;
    // Finished tokens stack in order per seat.
    const homeCount: Record<number, number> = {};
    for (const [playerId, slot] of Object.entries(state.players)) {
      slot.tokens.forEach((token, index) => {
        let cell: Cell | undefined;
        let homeStack = 0;
        if (token.progress < 0) {
          cell = state.yardCells?.[slot.seatIndex]?.[index];
        } else if (token.progress >= finishDistance) {
          homeStack = homeCount[slot.seatIndex] ?? 0;
          homeCount[slot.seatIndex] = homeStack + 1;
          cell = positionFor(slot.seatIndex, token.progress, index, homeStack);
        } else if (token.progress >= trackLength) {
          cell = state.homeStretchCells?.[slot.seatIndex]?.[token.progress - trackLength];
        } else if (token.cell !== null && token.cell !== undefined) {
          cell = state.trackCells?.[token.cell];
        }
        if (cell) result.push({ token, cell, seatIndex: slot.seatIndex, playerId, homeStack, stack: 0 });
      });
    }
    // Stack offsets when several tokens share one square.
    const byCell = new Map<string, number>();
    for (const entry of result) {
      const key = `${entry.cell.x}:${entry.cell.y}`;
      const seen = byCell.get(key) ?? 0;
      byCell.set(key, seen + 1);
      entry.stack = seen;
    }
    return result;
  }, [state, finishDistance, trackLength, positionFor]);

  // Animate each new server move along its path.
  useEffect(() => {
    const move = state?.lastMove ?? null;
    if (!move || !state?.players) return;
    if (move.moveNumber <= previousMoveNumber.current) return;
    previousMoveNumber.current = move.moveNumber;

    const slot = state.players[move.playerId];
    if (!slot) return;
    const yardIndex = Number(move.tokenId.split('-')[1] ?? 0);
    const path = pathFor(slot.seatIndex, move.from, move.to, yardIndex);

    if (move.captured) {
      setCaptureFlash(move.captured);
      setToast({ text: 'Capture!', tone: 'capture' });
      window.setTimeout(() => setCaptureFlash((current) => (current === move.captured ? null : current)), 900);
    } else if (move.to >= finishDistance && move.from < finishDistance) {
      setToast({ text: 'Token home!', tone: 'home' });
    }
    window.setTimeout(() => setToast(null), 1400);

    if (path.length > 0) {
      setAnimations((current) => ({ ...current, [move.tokenId]: path }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.lastMove?.moveNumber]);

  const movableTokenIds = useMemo(
    () => new Set((state?.legalMoves ?? []).map((move) => move.tokenId)),
    [state?.legalMoves],
  );

  /** Destination squares of my current legal moves (for target markers). */
  const moveTargets = useMemo(() => {
    if (!canMove || !state?.players) return [];
    const slot = state.players[myPlayerId ?? ''];
    if (!slot) return [];
    return state.legalMoves.map((move) => {
      let cell: Cell | undefined;
      if (move.to >= finishDistance) cell = FINISH_SPOT[slot.seatIndex % 4] ?? FINISH_SPOT[0]!;
      else if (move.to >= trackLength) cell = state.homeStretchCells?.[slot.seatIndex]?.[move.to - trackLength];
      else {
        const startCell = [0, 13, 26, 39][slot.seatIndex % 4] ?? 0;
        cell = state.trackCells?.[(startCell + move.to) % 52];
      }
      return { move, cell };
    });
  }, [canMove, state, myPlayerId, finishDistance, trackLength]);

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

  const pct = (value: number) => `${(value / size) * 100}%`;
  const startIndexFor = (seat: number) => [0, 13, 26, 39][seat % 4] ?? 0;
  const seatOfStartCell = (trackIndex: number): number | undefined =>
    [0, 1, 2, 3].find((seat) => startIndexFor(seat) === trackIndex);

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.players?.[player.id]?.score ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        currentTurnPlayerId={state.currentPlayerId}
        deadline={state.turnEndsAt ?? null}
        label="Turn"
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge tone={isMyTurn ? 'success' : 'default'}>
          {isMyTurn
            ? phase === 'awaiting-roll'
              ? 'Your turn — roll!'
              : 'Your turn — move a token'
            : currentPlayer
              ? `${currentPlayer.nickname}'s turn`
              : 'Waiting'}
        </Badge>
        <Badge tone="default">Bring {state.tokensToWin} home</Badge>
        {state.finishedOrder.length > 0 ? (
          <Badge tone="success">{state.finishedOrder.length} finished</Badge>
        ) : null}
      </div>

      {/* Board */}
      <div className="relative mx-auto w-full max-w-[min(94vw,32rem)]">
        <div
          className="relative grid w-full gap-px overflow-hidden rounded-2xl border border-white/15 bg-black/70 p-1 shadow-2xl"
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
            const isYardZone =
              (x <= 5 && y <= 5) || (x >= 9 && y <= 5) || (x >= 9 && y >= 9) || (x <= 5 && y >= 9);
            const isSafe = trackIndex !== undefined && state.safeIndices?.includes(trackIndex);
            const startSeat = trackIndex !== undefined ? seatOfStartCell(trackIndex) : undefined;
            const isYardEdge = isYardZone && (x === 5 || x === 9 || y === 5 || y === 9);

            let background = 'transparent';
            let border = undefined;
            if (isYardZone) {
              background = SEAT_SOFT[
                x <= 5 && y <= 5 ? 0 : x >= 9 && y <= 5 ? 1 : x >= 9 ? 2 : 3
              ] as string;
            } else if (homeSeat !== undefined) {
              background = SEAT_COLOR[homeSeat] ?? 'transparent';
            } else if (trackIndex !== undefined) {
              background = 'rgba(255,255,255,0.08)';
              border = '1px solid rgba(255,255,255,0.10)';
            }

            return (
              <div
                key={key}
                className={cn('relative aspect-square rounded-[3px]', isYardEdge && 'brightness-125')}
                style={{ background, border }}
              >
                {startSeat !== undefined ? (
                  <span
                    className="absolute inset-[12%] rounded-[3px] border border-white/40"
                    style={{ backgroundColor: `${SEAT_COLOR[startSeat] ?? '#94a3b8'}66` }}
                    aria-hidden
                  />
                ) : null}
                {isSafe ? (
                  <span className="absolute inset-0 grid place-items-center text-[9px] text-white/80" aria-hidden>
                    ★
                  </span>
                ) : null}
              </div>
            );
          })}

          {/* Centre finish: four triangles, one per seat. */}
          <div
            className="pointer-events-none absolute rounded-md"
            style={{
              left: pct(6),
              top: pct(6),
              width: pct(3),
              height: pct(3),
              background:
                'conic-gradient(from -90deg, #22c55e 0deg 90deg, #eab308 90deg 180deg, #3b82f6 180deg 270deg, #ef4444 270deg 360deg)',
              boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.25)',
            }}
            aria-hidden
          />

          {/* Active player's corner glow. */}
          {currentSeat >= 0 ? (
            <div
              className="pointer-events-none absolute animate-pulse rounded-xl"
              style={{
                left: pct(YARD_ZONE[currentSeat % 4]?.x0 ?? 0),
                top: pct(YARD_ZONE[currentSeat % 4]?.y0 ?? 0),
                width: pct(6),
                height: pct(6),
                boxShadow: `inset 0 0 0 3px ${SEAT_COLOR[currentSeat % 4] ?? '#fff'}, 0 0 18px ${
                  SEAT_COLOR[currentSeat % 4] ?? '#fff'
                }55`,
              }}
              aria-hidden
            />
          ) : null}

          {/* Legal move target markers — the whole cell is the touch target. */}
          {moveTargets.map(({ move, cell }) =>
            cell ? (
              <motion.button
                key={`target-${move.tokenId}`}
                type="button"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                onClick={() => moveToken(move.tokenId)}
                aria-label={`Move token to this square${move.capturesTokenId ? ' and capture' : ''}`}
                className="absolute z-10 grid place-items-center rounded-lg hover:bg-white/10"
                style={{
                  left: pct(cell.x),
                  top: pct(cell.y),
                  width: pct(1),
                  height: pct(1),
                }}
              >
                <motion.span
                  animate={{ scale: [1, 1.25, 1], opacity: [0.9, 1, 0.9] }}
                  transition={{ repeat: Infinity, duration: 1.1 }}
                  className={cn(
                    'grid h-[70%] w-[70%] place-items-center rounded-full border-2 text-[9px] font-black',
                    move.capturesTokenId
                      ? 'border-red-300 bg-red-500/80 text-white'
                      : move.reachesHome
                        ? 'border-amber-200 bg-amber-400/80 text-amber-950'
                        : 'border-white/90 bg-white/25 text-white',
                  )}
                >
                  {move.capturesTokenId ? '⚔' : move.reachesHome ? '⌂' : state.dice ?? ''}
                </motion.span>
              </motion.button>
            ) : null,
          )}

          {/* Tokens */}
          {placed.map(({ token, cell, seatIndex, playerId, homeStack, stack }) => {
            const movable = canMove && movableTokenIds.has(token.id) && playerId === myPlayerId;
            const finished = token.progress >= finishDistance;
            // Finished tokens spread via their own spot; shared squares nudge apart.
            const offsetX = finished ? 0 : (stack % 2) * 0.22 - (stack > 1 ? 0.11 : 0);
            const offsetY = finished ? 0 : Math.floor(stack / 2) * 0.22 - (stack > 1 ? 0.11 : 0);
            const animPath = animations[token.id];
            const leftKeyframes = animPath
              ? animPath.map((step) => pct(step.x + 0.5))
              : [pct(cell.x + 0.5 + offsetX)];
            const topKeyframes = animPath
              ? animPath.map((step) => pct(step.y + 0.5))
              : [pct(cell.y + 0.5 + offsetY)];
            const flashing = captureFlash === token.id;
            return (
              <motion.button
                key={token.id}
                type="button"
                disabled={!movable}
                onClick={() => movable && moveToken(token.id)}
                aria-label={movable ? `Move token ${token.id}` : `Token ${token.id}`}
                className={cn(
                  'absolute z-20 rounded-full border-2 border-white/70 shadow-lg',
                  movable && 'cursor-pointer ring-2 ring-white/90 ring-offset-1 ring-offset-black/50',
                )}
                style={{
                  backgroundColor: SEAT_COLOR[seatIndex] ?? '#94a3b8',
                  width: pct(0.62),
                  height: pct(0.62),
                  marginLeft: pct(-0.31),
                  marginTop: pct(-0.31),
                  boxShadow: flashing
                    ? '0 0 0 4px rgba(248,113,113,0.9), 0 0 16px rgba(248,113,113,0.8)'
                    : undefined,
                  zIndex: movable ? 20 : 10 + homeStack,
                }}
                animate={{
                  left: leftKeyframes,
                  top: topKeyframes,
                  scale: flashing ? [1, 1.45, 1] : movable ? [1, 1.12, 1] : 1,
                }}
                transition={
                  animPath
                    ? { duration: animPath.length * (STEP_MS / 1000), ease: 'easeOut' }
                    : { duration: flashing ? 0.45 : 0.9, repeat: movable ? Infinity : 0, repeatDelay: 0.4 }
                }
                onAnimationComplete={() => {
                  if (animPath) {
                    setAnimations((current) => {
                      const next = { ...current };
                      delete next[token.id];
                      return next;
                    });
                  }
                }}
              />
            );
          })}

          {/* Celebration toast */}
          <AnimatePresence>
            {toast ? (
              <motion.div
                key={toast.text}
                initial={{ opacity: 0, y: 10, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className={cn(
                  'pointer-events-none absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-xl px-4 py-2 text-sm font-black tracking-wide shadow-2xl',
                  toast.tone === 'capture'
                    ? 'bg-red-500/95 text-white'
                    : toast.tone === 'home'
                      ? 'bg-amber-400/95 text-amber-950'
                      : 'bg-white/90 text-slate-900',
                )}
              >
                {toast.tone === 'capture' ? '⚔ CAPTURE!' : toast.tone === 'home' ? '⌂ TOKEN HOME!' : toast.text}
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* Finished overlay */}
          {phase === 'finished' ? (
            <div className="absolute inset-0 z-30 grid place-items-center rounded-2xl bg-black/70 backdrop-blur-[2px]">
              <div className="w-full max-w-[16rem] space-y-2 p-4 text-center">
                <Trophy className="mx-auto h-8 w-8 text-amber-300" aria-hidden />
                <p className="text-sm font-bold text-white">Match over</p>
                <ol className="space-y-1">
                  {state.finishedOrder.map((playerId, index) => {
                    const player = players.find((entry) => entry.id === playerId);
                    const slot = state.players?.[playerId];
                    return (
                      <li
                        key={playerId}
                        className="flex items-center justify-center gap-2 text-xs text-slate-200"
                      >
                        <span className="font-black">{index + 1}.</span>
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: SEAT_COLOR[slot?.seatIndex ?? 0] ?? '#94a3b8' }}
                          aria-hidden
                        />
                        {player?.nickname ?? 'Player'}
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Dice + controls */}
      <div className="flex flex-col items-center gap-3">
        {canRoll ? (
          <motion.button
            type="button"
            onClick={roll}
            whileTap={{ scale: 0.92 }}
            className="rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            aria-label="Roll the dice"
          >
            <Die value={state.dice ?? null} rolling={canRoll} size="lg" />
          </motion.button>
        ) : (
          <Die value={state.dice ?? lastRoll?.value ?? null} rolling={false} size="lg" />
        )}
        {canRoll ? (
          <p className="text-sm font-medium text-emerald-300">Tap the die to roll (or press Space)</p>
        ) : canMove ? (
          <p className="text-sm text-emerald-300">
            Rolled {state.dice} — tap a glowing square ({state.legalMoves.length} option
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

      {/* Per-player progress */}
      <div className="mx-auto grid w-full max-w-2xl gap-2 sm:grid-cols-2">
        {players.map((player) => {
          const slot = state.players?.[player.id];
          if (!slot) return null;
          const progress = Math.min(1, slot.finishedTokens / state.tokensToWin);
          return (
            <div
              key={player.id}
              className={cn(
                'flex items-center gap-3 rounded-xl border px-3 py-2',
                player.id === state.currentPlayerId
                  ? 'border-white/25 bg-white/[0.06]'
                  : 'border-white/5 bg-white/[0.02]',
                slot.disconnected && 'opacity-60',
              )}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: SEAT_COLOR[slot.seatIndex] ?? '#94a3b8' }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-slate-200">
                    {player.nickname}
                    {slot.rank > 0 ? ` · #${slot.rank}` : ''}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-[10px] text-slate-400">
                    <span className="flex items-center gap-0.5">
                      <Swords className="h-3 w-3" aria-hidden />
                      {slot.captures}
                    </span>
                    <span className="tabular-nums">{slot.score} pts</span>
                  </span>
                </div>
                <div
                  className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"
                  role="progressbar"
                  aria-label={`${player.nickname} home progress`}
                  aria-valuenow={slot.finishedTokens}
                  aria-valuemin={0}
                  aria-valuemax={state.tokensToWin}
                >
                  <motion.div
                    className="h-full rounded-full"
                    style={{ backgroundColor: SEAT_COLOR[slot.seatIndex] ?? '#94a3b8' }}
                    initial={{ width: 0 }}
                    animate={{ width: `${progress * 100}%` }}
                    transition={{ type: 'spring', stiffness: 120, damping: 20 }}
                  />
                </div>
              </div>
              <span className="shrink-0 text-[10px] tabular-nums text-slate-400">
                {slot.finishedTokens}/{state.tokensToWin}
              </span>
            </div>
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
