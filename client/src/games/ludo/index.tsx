import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { LUDO_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { cn } from '../../utils/cn';

/**
 * Ludo — client renderer.
 *
 * The server resolves EVERY board position: each token arrives with a
 * `gridCell` + `kind`, each legal move with a `toCell`, and the last move with
 * the exact `cells` walked. This component never does path math of its own, so
 * the drawn path is by construction the logical path. The small fallback
 * resolver below only exists for defensive rendering of legacy/absent fields.
 */

interface Cell {
  x: number;
  y: number;
}

interface LudoTokenView {
  id: string;
  progress: number;
  cell: number | null;
  seatIndex: number;
  gridCell?: Cell | null;
  kind?: 'yard' | 'track' | 'lane' | 'home';
}

interface LudoLegalMove {
  tokenId: string;
  from: number;
  to: number;
  capturesTokenId: string | null;
  entersBoard: boolean;
  reachesHome: boolean;
  toCell?: Cell | null;
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
    cells?: (Cell | null)[];
    captured: string | null;
    capturedFrom: number | null;
    capturedFromCell?: Cell | null;
  } | null;
  finishReason: string | null;
  serverTime: number;
  boardSize: number;
  trackCells: Cell[];
  safeIndices: number[];
  homeStretchCells: Record<string, Cell[]> | Cell[][];
  yardCells: Record<string, Cell[]> | Cell[][];
  startIndex: Record<string, number> | number[];
  homeEntryIndex?: Record<string, number>;
  trackLength: number;
  laneStart?: number;
  homeStretchLength: number;
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

const SEAT_NAME: Record<number, string> = {
  0: 'Red',
  1: 'Green',
  2: 'Yellow',
  3: 'Blue',
};

/** Records ship per-seat maps; defensive shapes fall back to array indexing. */
function seatAt<T>(table: Record<string, T> | T[] | undefined, seat: number): T | undefined {
  if (!table) return undefined;
  const value = (table as Record<string, T>)[String(seat)];
  if (value !== undefined) return value;
  return (table as T[])[seat];
}

/**
 * Client-side progress -> cell fallback. Used ONLY when the server-resolved
 * `gridCell` is absent (defensive). Mirrors the server geometry: 0..50 track,
 * 51..55 lane, 56 home.
 */
export function ludoCellForProgress(
  state: LudoPublicState,
  seat: number,
  progress: number,
  tokenIndex: number,
): Cell | null {
  if (progress < 0) return seatAt(state.yardCells, seat)?.[tokenIndex] ?? null;
  const laneStart = state.laneStart ?? state.trackLength - 1;
  if (progress < laneStart) {
    const start = seatAt(state.startIndex, seat) ?? 0;
    return state.trackCells[(start + progress) % state.trackLength] ?? null;
  }
  if (progress < state.finishDistance) {
    return seatAt(state.homeStretchCells, seat)?.[progress - laneStart] ?? null;
  }
  // Home: the seat's triangle inside the centre, one spot per token.
  const spots: Record<number, Cell[]> = {
    0: [{ x: 6, y: 7 }, { x: 6, y: 6.5 }, { x: 6, y: 7.5 }, { x: 6, y: 6 }],
    1: [{ x: 7, y: 6 }, { x: 6.5, y: 6 }, { x: 7.5, y: 6 }, { x: 7, y: 6.5 }],
    2: [{ x: 8, y: 7 }, { x: 8, y: 6.5 }, { x: 8, y: 7.5 }, { x: 8, y: 8 }],
    3: [{ x: 7, y: 8 }, { x: 6.5, y: 8 }, { x: 7.5, y: 8 }, { x: 7, y: 8.5 }],
  };
  return spots[((seat % 4) + 4) % 4]?.[Math.min(tokenIndex, 3)] ?? { x: 7.5, y: 7.5 };
}

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

/* ------------------------------------------------------------------ */
/* SVG board                                                           */
/* ------------------------------------------------------------------ */

const YARD_ORIGIN: Record<number, Cell> = {
  0: { x: 0, y: 0 },
  1: { x: 9, y: 0 },
  2: { x: 9, y: 9 },
  3: { x: 0, y: 9 },
};

/** Chevrons painted on the home-entry cell, pointing into the seat's lane. */
const ENTRY_ARROW: Record<number, string> = {
  0: 'M0.30,0.30 L0.70,0.50 L0.30,0.70', // red lane runs right (row 7)
  1: 'M0.30,0.30 L0.50,0.70 L0.70,0.30', // green lane runs down (col 7)
  2: 'M0.70,0.30 L0.30,0.50 L0.70,0.70', // yellow lane runs left
  3: 'M0.30,0.70 L0.50,0.30 L0.70,0.70', // blue lane runs up
};

function BoardSvg({
  state,
  winnerSeat,
}: {
  state: LudoPublicState;
  winnerSeat: number | null;
}) {
  const trackCells = state.trackCells ?? [];
  const safeIndices = new Set(state.safeIndices ?? []);
  const startIndex = useCallback((seat: number) => seatAt(state.startIndex, seat) ?? -1, [state.startIndex]);
  const homeEntry = useCallback(
    (seat: number) => state.homeEntryIndex?.[String(seat)] ?? state.homeEntryIndex?.[seat],
    [state.homeEntryIndex],
  );

  const startSet = useMemo(() => {
    const map = new Map<number, number>();
    for (let seat = 0; seat < 4; seat += 1) {
      const index = startIndex(seat);
      if (index >= 0) map.set(index, seat);
    }
    return map;
  }, [startIndex]);

  return (
    <svg
      viewBox="0 0 15 15"
      className="block h-auto w-full touch-manipulation select-none"
      aria-hidden="true"
    >
      <defs>
        {([0, 1, 2, 3] as const).map((seat) => (
          <radialGradient key={seat} id={`yard-glow-${seat}`} cx="50%" cy="50%" r="65%">
            <stop offset="0%" stopColor={SEAT_COLOR[seat]} stopOpacity="0.55" />
            <stop offset="100%" stopColor={SEAT_COLOR[seat]} stopOpacity="0.16" />
          </radialGradient>
        ))}
      </defs>

      {/* Board plate */}
      <rect x="0" y="0" width="15" height="15" rx="0.55" fill="#0a0f1e" />

      {/* Yards: coloured quarters with an inner slot panel */}
      {([0, 1, 2, 3] as const).map((seat) => {
        const origin = YARD_ORIGIN[seat]!;
        return (
          <g key={`yard-${seat}`}>
            <rect
              x={origin.x + 0.18}
              y={origin.y + 0.18}
              width={5.64}
              height={5.64}
              rx="0.7"
              fill={`url(#yard-glow-${seat})`}
              stroke={SEAT_COLOR[seat]}
              strokeOpacity="0.65"
              strokeWidth="0.09"
            />
            <rect
              x={origin.x + 0.85}
              y={origin.y + 0.85}
              width={4.3}
              height={4.3}
              rx="0.55"
              fill="rgba(255,255,255,0.05)"
              stroke={SEAT_COLOR[seat]}
              strokeOpacity="0.35"
              strokeWidth="0.06"
              strokeDasharray="0.22 0.16"
            />
            {/* Token slots */}
            {(seatAt(state.yardCells, seat) ?? []).map((cell, index) => (
              <circle
                key={`slot-${seat}-${index}`}
                cx={cell.x + 0.5}
                cy={cell.y + 0.5}
                r="0.52"
                fill={SEAT_COLOR[seat]}
                fillOpacity="0.10"
                stroke={SEAT_COLOR[seat]}
                strokeOpacity="0.45"
                strokeWidth="0.06"
              />
            ))}
            <text
              x={origin.x + 3}
              y={origin.y + 0.72}
              textAnchor="middle"
              fontSize="0.42"
              fontWeight="700"
              fill={SEAT_COLOR[seat]}
              opacity="0.9"
            >
              {SEAT_NAME[seat]}
            </text>
          </g>
        );
      })}

      {/* Shared track cells */}
      {trackCells.map((cell, index) => {
        const startSeat = startSet.get(index);
        const isSafe = safeIndices.has(index) && startSeat === undefined;
        const isEntry = homeEntry(0) === index || homeEntry(1) === index || homeEntry(2) === index || homeEntry(3) === index;
        const entrySeat = ([0, 1, 2, 3] as const).find((seat) => homeEntry(seat) === index);
        return (
          <g key={`track-${index}`}>
            <rect
              x={cell.x + 0.06}
              y={cell.y + 0.06}
              width={0.88}
              height={0.88}
              rx="0.14"
              fill={startSeat !== undefined ? SEAT_COLOR[startSeat] : 'rgba(255,255,255,0.09)'}
              stroke="rgba(255,255,255,0.16)"
              strokeWidth="0.035"
            />
            {startSeat !== undefined ? (
              <>
                <circle cx={cell.x + 0.5} cy={cell.y + 0.5} r="0.3" fill="none" stroke="white" strokeOpacity="0.85" strokeWidth="0.07" />
                <text
                  x={cell.x + 0.5}
                  y={cell.y + 0.62}
                  textAnchor="middle"
                  fontSize="0.34"
                  fontWeight="800"
                  fill="white"
                  opacity="0.95"
                >
                  ▶
                </text>
              </>
            ) : null}
            {isSafe ? (
              <text
                x={cell.x + 0.5}
                y={cell.y + 0.66}
                textAnchor="middle"
                fontSize="0.5"
                fill="rgba(255,255,255,0.75)"
              >
                ★
              </text>
            ) : null}
            {isEntry && entrySeat !== undefined && startSeat === undefined ? (
              <path
                d={ENTRY_ARROW[entrySeat]}
                transform={`translate(${cell.x} ${cell.y})`}
                stroke={SEAT_COLOR[entrySeat]}
                strokeWidth="0.12"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </g>
        );
      })}

      {/* Private home lanes */}
      {([0, 1, 2, 3] as const).map((seat) =>
        (seatAt(state.homeStretchCells, seat) ?? []).map((cell, index) => (
          <rect
            key={`lane-${seat}-${index}`}
            x={cell.x + 0.06}
            y={cell.y + 0.06}
            width={0.88}
            height={0.88}
            rx="0.14"
            fill={SEAT_COLOR[seat]}
            fillOpacity="0.42"
            stroke={SEAT_COLOR[seat]}
            strokeOpacity="0.8"
            strokeWidth="0.05"
          />
        )),
      )}

      {/* Central finishing area: four triangles pointing inward */}
      <g>
        <rect x="6" y="6" width="3" height="3" fill="rgba(255,255,255,0.06)" />
        <motion.polygon
          points="6,6 9,6 7.5,7.5"
          fill={SEAT_COLOR[1]}
          fillOpacity="0.85"
          animate={winnerSeat === 1 ? { opacity: [1, 0.55, 1] } : { opacity: 1 }}
          transition={{ duration: 0.9, repeat: winnerSeat === 1 ? Infinity : 0 }}
        />
        <motion.polygon
          points="9,6 9,9 7.5,7.5"
          fill={SEAT_COLOR[2]}
          fillOpacity="0.85"
          animate={winnerSeat === 2 ? { opacity: [1, 0.55, 1] } : { opacity: 1 }}
          transition={{ duration: 0.9, repeat: winnerSeat === 2 ? Infinity : 0 }}
        />
        <motion.polygon
          points="9,9 6,9 7.5,7.5"
          fill={SEAT_COLOR[3]}
          fillOpacity="0.85"
          animate={winnerSeat === 3 ? { opacity: [1, 0.55, 1] } : { opacity: 1 }}
          transition={{ duration: 0.9, repeat: winnerSeat === 3 ? Infinity : 0 }}
        />
        <motion.polygon
          points="6,9 6,6 7.5,7.5"
          fill={SEAT_COLOR[0]}
          fillOpacity="0.85"
          animate={winnerSeat === 0 ? { opacity: [1, 0.55, 1] } : { opacity: 1 }}
          transition={{ duration: 0.9, repeat: winnerSeat === 0 ? Infinity : 0 }}
        />
        <circle cx="7.5" cy="7.5" r="0.34" fill="#0a0f1e" stroke="rgba(255,255,255,0.5)" strokeWidth="0.07" />
        <text x="7.5" y="7.63" textAnchor="middle" fontSize="0.36" fill="rgba(255,255,255,0.9)">
          🏠
        </text>
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Game component                                                      */
/* ------------------------------------------------------------------ */

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

  /**
   * Tokens with a server-resolved render cell (fallback resolver only for
   * defensive/legacy states). Finished tokens keep their triangle spot, so a
   * completed token is ALWAYS visible in its seat colour with a ✓ marker.
   */
  const placed = useMemo(() => {
    const result: Array<{
      token: LudoTokenView;
      cell: Cell;
      seatIndex: number;
      playerId: string;
      tokenIndex: number;
      kind: string;
    }> = [];
    if (!state?.players) return result;
    for (const [playerId, slot] of Object.entries(state.players)) {
      slot.tokens.forEach((token, index) => {
        const kind = token.kind ?? (token.progress < 0 ? 'yard' : token.progress >= state.finishDistance ? 'home' : token.progress >= (state.laneStart ?? state.trackLength - 1) ? 'lane' : 'track');
        const cell =
          token.gridCell ??
          ludoCellForProgress(state, slot.seatIndex, token.progress, index);
        if (cell)
          result.push({ token, cell, seatIndex: slot.seatIndex, playerId, tokenIndex: index, kind });
      });
    }
    return result;
  }, [state]);

  const movableTokenIds = useMemo(
    () => new Set((state?.legalMoves ?? []).map((move) => move.tokenId)),
    [state?.legalMoves],
  );

  const legalDestinationSet = useMemo(() => {
    const destinations = new Map<string, string>(); // cellKey -> color
    if (!myPlayerId || !state?.players?.[myPlayerId]) return destinations;
    const seat = state.players[myPlayerId]!.seatIndex;
    for (const move of state.legalMoves ?? []) {
      const cell =
        move.toCell ?? ludoCellForProgress(state, seat, move.to, 0);
      if (cell) destinations.set(`${cell.x}:${cell.y}`, SEAT_COLOR[seat] ?? '#ffffff');
    }
    return destinations;
  }, [myPlayerId, state]);

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
  const winnerSlotId = state.finishedOrder[0] ?? null;
  const winnerSeat =
    winnerSlotId !== null ? (state.players?.[winnerSlotId]?.seatIndex ?? null) : null;
  const currentSeat =
    state.currentPlayerId !== null
      ? (state.players?.[state.currentPlayerId]?.seatIndex ?? null)
      : null;
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

  const revealText =
    phase === 'finished' && winnerSlotId
      ? `${players.find((player) => player.id === winnerSlotId)?.nickname ?? SEAT_NAME[winnerSeat ?? 0]} brought all ${state.tokensToWin} tokens home!`
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
        {currentSeat !== null ? (
          <span
            className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs font-semibold"
            aria-label={`Current player colour ${SEAT_NAME[currentSeat] ?? ''}`}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor: SEAT_COLOR[currentSeat],
                boxShadow: `0 0 8px ${SEAT_COLOR[currentSeat]}`,
              }}
              aria-hidden
            />
            {SEAT_NAME[currentSeat]}
          </span>
        ) : null}
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

      {/* Board: SVG plate + animated token overlay fed by server-resolved cells */}
      <motion.div
        className="relative mx-auto w-full max-w-[min(92vw,32rem)] overflow-hidden rounded-2xl border bg-black/60 p-1.5"
        style={{
          borderColor:
            currentSeat !== null ? `${SEAT_COLOR[currentSeat]}66` : 'rgba(255,255,255,0.1)',
          boxShadow:
            currentSeat !== null
              ? `0 0 24px ${SEAT_COLOR[currentSeat]}33, inset 0 0 12px rgba(0,0,0,0.6)`
              : 'inset 0 0 12px rgba(0,0,0,0.6)',
        }}
        role="grid"
        aria-label="Ludo board"
      >
        <BoardSvg state={state} winnerSeat={winnerSeat} />

        {/* Tokens live in one overlay so Framer can animate every server-authored
            board step instead of jumping between unrelated grid-cell parents. */}
        <div className="pointer-events-none absolute inset-1.5" aria-live="polite">
          {placed.map((entry) => {
            const movable =
              canMove &&
              movableTokenIds.has(entry.token.id) &&
              entry.playerId === myPlayerId &&
              entry.kind !== 'home'; // finished tokens are immovable
            const finished = entry.kind === 'home';
            const move = state.lastMove;
            let motionCells: Cell[] = [entry.cell];
            if (move?.tokenId === entry.token.id && move.cells?.length) {
              // Server-resolved animation path (== the logical path).
              motionCells = move.cells.filter((cell): cell is Cell => Boolean(cell));
            } else if (move?.captured === entry.token.id) {
              const yard = ludoCellForProgress(
                state,
                entry.seatIndex,
                -1,
                entry.tokenIndex,
              );
              motionCells = [move.capturedFromCell ?? entry.cell, yard].filter(
                (cell): cell is Cell => Boolean(cell),
              );
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
            const isLatest =
              (move?.tokenId === entry.token.id && Boolean(move.cells?.length)) ||
              move?.captured === entry.token.id;
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
                  'pointer-events-auto absolute grid place-items-center rounded-full border-2 border-black/50 shadow-lg',
                  movable && 'z-20 ring-2 ring-white ring-offset-2 ring-offset-black/40',
                  finished && 'z-10 border-amber-300/80',
                )}
                style={{
                  width: `${(0.68 / size) * 100}%`,
                  aspectRatio: '1',
                  backgroundColor: SEAT_COLOR[entry.seatIndex] ?? '#94a3b8',
                  boxShadow: finished
                    ? '0 0 12px rgba(251,191,36,0.75)'
                    : `0 0 ${movable ? 14 : 7}px ${SEAT_COLOR[entry.seatIndex] ?? '#94a3b8'}`,
                }}
              >
                {finished ? (
                  <span aria-hidden className="text-[9px] font-black text-white drop-shadow">
                    ✓
                  </span>
                ) : (
                  <span className="sr-only">{entry.token.id}</span>
                )}
                {finished ? <span className="sr-only">{entry.token.id} home</span> : null}
              </motion.button>
            );
          })}

          {/* Legal destination markers from server-resolved cells */}
          {[...legalDestinationSet.entries()].map(([key, color]) => {
            const [cx, cy] = key.split(':').map(Number);
            return (
              <motion.span
                key={`dest-${key}`}
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: [0.85, 1.05, 0.85], opacity: 0.9 }}
                transition={{ duration: 1.1, repeat: Infinity }}
                className="pointer-events-none absolute rounded-full"
                style={{
                  left: `${(((cx ?? 0) + 0.3) / size) * 100}%`,
                  top: `${(((cy ?? 0) + 0.3) / size) * 100}%`,
                  width: `${(0.4 / size) * 100}%`,
                  height: `${(0.4 / size) * 100}%`,
                  backgroundColor: `${color}55`,
                  border: `2px solid ${color}`,
                }}
                aria-hidden
              />
            );
          })}
        </div>

        {/* Game-end reveal: the decisive moment stays on the board */}
        {revealText ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded-full border border-amber-300/40 bg-black/80 px-5 py-2 text-sm font-bold text-amber-200 shadow-lg backdrop-blur"
          >
            🏆 {revealText}
          </motion.div>
        ) : null}
      </motion.div>

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
            Rolled {state.dice} — tap a glowing token ({state.legalMoves.length} option
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
