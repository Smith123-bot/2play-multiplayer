import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { HelpCircle } from 'lucide-react';
import { CONNECT_FOUR_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { HowToPlayModal, useHowToPlay } from '../../components/game/HowToPlayModal';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface ConnectFourPublicState {
  phase: 'idle' | 'playing' | 'finished';
  cols: number;
  rows: number;
  board: number[];
  currentPlayerId: string | null;
  isMyTurn: boolean;
  mySeat: 1 | 2 | null;
  legalColumns: number[];
  moves: number;
  lastMove: { col: number; row: number; playerId: string } | null;
  winningLine: number[];
  winnerId: string | null;
  isDraw: boolean;
  turnEndsAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  players: Record<string, { seat: 1 | 2; discs: number; disconnected: boolean }>;
}

const SEAT_COLOR: Record<number, string> = { 1: '#ef4444', 2: '#fbbf24' };

function ConnectFourGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<ConnectFourPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const rules = useHowToPlay(CONNECT_FOUR_METADATA.id);
  const [hovered, setHovered] = useState<number | null>(null);

  const phase = state?.phase ?? 'idle';
  const canPlay = phase === 'playing' && Boolean(state?.isMyTurn);

  const drop = useCallback(
    (col: number) => {
      if (!canPlay) return;
      if (!state?.legalColumns?.includes(col)) {
        play('wrong');
        vibrate('error');
        return;
      }
      sendAction({ type: 'drop', payload: { col } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [canPlay, state?.legalColumns, sendAction, play, vibrate],
  );

  // Number keys 1-7 drop on desktop.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)) {
        return;
      }
      const col = Number(event.key) - 1;
      if (Number.isInteger(col) && col >= 0 && col < (state?.cols ?? 7)) {
        event.preventDefault();
        drop(col);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drop, state?.cols]);

  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (event === previousEvent.current) return;
    previousEvent.current = event;
    if (!event) return;
    const mine = myPlayerId ? event.endsWith(`:${myPlayerId}`) : false;
    if (event.startsWith('drop:')) {
      play('click');
    } else if (event.startsWith('win:')) {
      play(mine ? 'victory' : 'defeat');
      vibrate(mine ? 'victory' : 'defeat');
    } else if (event === 'draw') {
      play('draw');
    } else if (event === 'start') {
      play('gameStart');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state?.board?.length) {
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
  const winSet = new Set(state.winningLine);

  return (
    <div className="space-y-4">
      <HowToPlayModal game={CONNECT_FOUR_METADATA} open={rules.open} onClose={rules.close} />

      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.players?.[player.id]?.discs ?? 0,
        }))}
        myPlayerId={myPlayerId}
        deadline={state.turnEndsAt ?? null}
        label="Turn"
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge tone={state.isMyTurn ? 'success' : 'default'}>
          {phase === 'finished'
            ? state.isDraw
              ? 'Draw'
              : state.winnerId === myPlayerId
                ? 'You win!'
                : 'You lost'
            : state.isMyTurn
              ? 'Your turn'
              : currentPlayer
                ? `${currentPlayer.nickname}'s turn`
                : 'Waiting'}
        </Badge>
        {state.mySeat ? (
          <Badge tone="default">
            <span
              className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle"
              style={{ backgroundColor: SEAT_COLOR[state.mySeat] }}
              aria-hidden
            />
            You are {state.mySeat === 1 ? 'red' : 'yellow'}
          </Badge>
        ) : null}
        <Badge tone="default">Move {state.moves}</Badge>
        <button
          type="button"
          onClick={rules.show}
          aria-label="How to play"
          className="rounded-full border border-white/10 p-1.5 text-slate-400 transition hover:text-white"
        >
          <HelpCircle className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* Column drop buttons */}
      <div
        className="mx-auto grid w-full max-w-[min(94vw,28rem)] gap-1.5"
        style={{ gridTemplateColumns: `repeat(${state.cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: state.cols }, (_unused, col) => {
          const full = !state.legalColumns.includes(col);
          return (
            <button
              key={col}
              type="button"
              disabled={!canPlay || full}
              onClick={() => drop(col)}
              onMouseEnter={() => setHovered(col)}
              onMouseLeave={() => setHovered(null)}
              aria-label={full ? `Column ${col + 1} is full` : `Drop in column ${col + 1}`}
              className={cn(
                'h-8 rounded-lg border text-xs font-semibold transition disabled:opacity-30',
                canPlay && !full
                  ? 'border-white/20 bg-white/10 text-white active:scale-95'
                  : 'border-white/5 bg-white/[0.03] text-slate-600',
              )}
            >
              ▼
            </button>
          );
        })}
      </div>

      {/* Board */}
      <div
        className="mx-auto grid w-full max-w-[min(94vw,28rem)] gap-1.5 rounded-2xl border border-white/10 bg-indigo-950/60 p-2"
        style={{ gridTemplateColumns: `repeat(${state.cols}, minmax(0, 1fr))` }}
        role="grid"
        aria-label="Connect Four board"
      >
        {Array.from({ length: state.cols * state.rows }, (_unused, index) => {
          const col = index % state.cols;
          const row = Math.floor(index / state.cols);
          const disc = state.board[index] ?? 0;
          const isWinning = winSet.has(index);
          const isLast = state.lastMove?.col === col && state.lastMove?.row === row;
          const isHoverCol = hovered === col && canPlay;

          return (
            <div
              key={index}
              onMouseEnter={() => setHovered(col)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => drop(col)}
              className={cn(
                'relative grid aspect-square place-items-center rounded-full border transition',
                disc === 0 ? 'border-white/10 bg-slate-900/70' : 'border-black/30',
                isHoverCol && disc === 0 && 'bg-slate-800',
                canPlay && 'cursor-pointer',
              )}
            >
              {disc !== 0 ? (
                <motion.span
                  // Animate the drop from above the board.
                  initial={isLast ? { y: -220, opacity: 0.6 } : false}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 340, damping: 22 }}
                  className={cn(
                    'absolute inset-[8%] rounded-full',
                    isWinning && 'ring-4 ring-white',
                  )}
                  style={{ backgroundColor: SEAT_COLOR[disc] }}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {phase === 'finished' ? (
        <div className="card space-y-1 p-4 text-center">
          <p className="text-lg font-semibold text-white">
            {state.isDraw ? 'Draw — the board is full' : `${players.find((p) => p.id === state.winnerId)?.nickname ?? 'Someone'} connected four`}
          </p>
          <p className="text-xs text-slate-400">{state.moves} discs played</p>
        </div>
      ) : null}

      <div className="flex flex-wrap justify-center gap-3 text-xs text-slate-400">
        {players.map((player) => {
          const slot = state.players?.[player.id];
          if (!slot) return null;
          return (
            <span key={player.id} className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: SEAT_COLOR[slot.seat] }}
                aria-hidden
              />
              {player.nickname}: {slot.discs} discs{slot.disconnected ? ' (offline)' : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export const connectFourClient: ClientGameModule = {
  metadata: CONNECT_FOUR_METADATA,
  Component: ConnectFourGame as unknown as ComponentType<GameComponentProps<never>>,
};
