import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Flag, HelpCircle } from 'lucide-react';
import { CHESS_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { HowToPlayModal, useHowToPlay } from '../../components/game/HowToPlayModal';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { cn } from '../../utils/cn';

type PieceColor = 'w' | 'b';
type PieceType = 'k' | 'q' | 'r' | 'b' | 'n' | 'p';

interface BoardPiece {
  type: PieceType;
  color: PieceColor;
}

interface LegalMoveView {
  from: number;
  to: number;
  captured?: PieceType;
  promotion?: PieceType;
  castle?: 'k' | 'q';
  enPassant?: boolean;
}

export interface ChessPublicState {
  phase: 'idle' | 'playing' | 'finished';
  board: Array<BoardPiece | null>;
  turn: PieceColor;
  myColor: PieceColor | null;
  isMyTurn: boolean;
  legalMoves: LegalMoveView[];
  lastMove: { from: number; to: number } | null;
  inCheck: PieceColor | null;
  fullmove: number;
  moveHistory: Array<{ san: string; from: string; to: string; color: PieceColor; fullmove: number }>;
  captured: { w: PieceType[]; b: PieceType[] };
  clocks: { w: number; b: number };
  baseTimeMs: number;
  resultType: string | null;
  winnerColor: PieceColor | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  players: Record<
    string,
    { color: PieceColor; timeLeftMs: number; moves: number; captures: number; disconnected: boolean }
  >;
}

/** Original vector-style glyphs (standard Unicode chess characters). */
const GLYPH: Record<PieceColor, Record<PieceType, string>> = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};

const PROMOTIONS: PieceType[] = ['q', 'r', 'b', 'n'];
const FILES = 'abcdefgh'.split('');

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const RESULT_LABEL: Record<string, string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate — draw',
  'insufficient-material': 'Draw — insufficient material',
  'fifty-move': 'Draw — fifty-move rule',
  threefold: 'Draw — threefold repetition',
  timeout: 'Win on time',
  resignation: 'Resignation',
  abandoned: 'Abandoned',
};

function ChessGame({ state, players, myPlayerId, sendAction, play, vibrate }: GameComponentProps<ChessPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const rules = useHowToPlay(CHESS_METADATA.id);
  const [selected, setSelected] = useState<number | null>(null);
  const [promotion, setPromotion] = useState<{ from: number; to: number } | null>(null);
  /** Local clock tick so the countdown is smooth between server updates. */
  const [, setTick] = useState(0);

  const phase = state?.phase ?? 'idle';
  const canMove = phase === 'playing' && Boolean(state?.isMyTurn);

  useEffect(() => {
    if (phase !== 'playing') return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  const legalFrom = useMemo(() => {
    const map = new Map<number, LegalMoveView[]>();
    for (const move of state?.legalMoves ?? []) {
      const list = map.get(move.from) ?? [];
      list.push(move);
      map.set(move.from, list);
    }
    return map;
  }, [state?.legalMoves]);

  const targets = useMemo(
    () => (selected === null ? [] : legalFrom.get(selected) ?? []),
    [selected, legalFrom],
  );

  const submit = useCallback(
    (from: number, to: number, promote?: PieceType) => {
      sendAction({
        type: 'move',
        payload: { from, to, ...(promote ? { promotion: promote } : {}) },
      } satisfies GameAction);
      setSelected(null);
      vibrate('buttonPress');
    },
    [sendAction, vibrate],
  );

  const onSquare = useCallback(
    (square: number) => {
      if (!canMove || !state) return;
      const piece = state.board[square];

      // Selecting one of your own pieces.
      if (piece && piece.color === state.myColor) {
        setSelected(square === selected ? null : square);
        play('click');
        return;
      }
      if (selected === null) return;

      const move = targets.find((entry) => entry.to === square);
      if (!move) {
        setSelected(null);
        return;
      }
      // A promotion needs the player to pick a piece first.
      if (targets.filter((entry) => entry.to === square).some((entry) => entry.promotion)) {
        setPromotion({ from: selected, to: square });
        return;
      }
      submit(selected, square);
    },
    [canMove, state, selected, targets, submit, play],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (event === previousEvent.current) return;
    previousEvent.current = event;
    if (!event) return;
    if (event.startsWith('capture:')) {
      play('score');
      vibrate('success');
    } else if (event.startsWith('check:')) {
      play('wrong');
      vibrate('error');
    } else if (event.startsWith('move:') || event.startsWith('castle:') || event.startsWith('promote:')) {
      play('click');
    } else if (event.startsWith('finished:')) {
      const won = state?.winnerColor && state.winnerColor === state.myColor;
      play(state?.winnerColor === null ? 'draw' : won ? 'victory' : 'defeat');
      vibrate(won ? 'victory' : 'defeat');
    }
  }, [state?.lastEvent, state?.winnerColor, state?.myColor, play, vibrate]);

  if (phase === 'idle' || !state?.board?.length) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Setting up the pieces…</p>
        </div>
      </div>
    );
  }

  // Black sees the board from their own side.
  const flipped = state.myColor === 'b';
  const order = Array.from({ length: 64 }, (_unused, index) => (flipped ? 63 - index : index));
  const targetSet = new Set(targets.map((move) => move.to));

  const opponentColor: PieceColor = state.myColor === 'b' ? 'w' : 'b';
  const myClock = state.clocks[state.myColor ?? 'w'];
  const theirClock = state.clocks[opponentColor];

  return (
    <div className="space-y-4">
      <HowToPlayModal game={CHESS_METADATA} open={rules.open} onClose={rules.close} />

      {/* Promotion picker — the server validates the choice regardless. */}
      <Modal
        open={promotion !== null}
        onClose={() => setPromotion(null)}
        title="Promote your pawn"
        description="Choose the piece your pawn becomes."
        size="sm"
      >
        <div className="grid grid-cols-4 gap-2">
          {PROMOTIONS.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                if (promotion) submit(promotion.from, promotion.to, type);
                setPromotion(null);
              }}
              aria-label={`Promote to ${type}`}
              className="grid aspect-square place-items-center rounded-xl border border-white/15 bg-white/5 text-4xl text-white transition active:scale-95"
            >
              {GLYPH[state.myColor ?? 'w'][type]}
            </button>
          ))}
        </div>
      </Modal>

      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.players?.[player.id]?.captures ?? 0,
        }))}
        myPlayerId={myPlayerId}
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge tone={state.isMyTurn ? 'success' : 'default'}>
          {phase === 'finished'
            ? state.winnerColor === null
              ? 'Draw'
              : state.winnerColor === state.myColor
                ? 'You win!'
                : 'You lost'
            : state.isMyTurn
              ? 'Your move'
              : 'Opponent thinking…'}
        </Badge>
        <Badge tone="default">{state.myColor === 'w' ? 'White' : 'Black'}</Badge>
        <Badge tone="default">Move {state.fullmove}</Badge>
        {state.inCheck ? (
          <Badge tone="danger">
            {state.inCheck === state.myColor ? 'You are in CHECK' : 'CHECK'}
          </Badge>
        ) : null}
        <button
          type="button"
          onClick={rules.show}
          aria-label="How to play"
          className="rounded-full border border-white/10 p-1.5 text-slate-400 transition hover:text-white"
        >
          <HelpCircle className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* Clocks */}
      <div className="mx-auto flex max-w-md items-center justify-between gap-3">
        <div
          className={cn(
            'flex-1 rounded-xl border px-3 py-2 text-center',
            !state.isMyTurn && phase === 'playing'
              ? 'border-primary-400/50 bg-primary-500/10'
              : 'border-white/10 bg-white/5',
          )}
        >
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Opponent</p>
          <p className={cn('font-mono text-xl', theirClock < 30_000 && 'text-rose-300')}>
            {formatClock(theirClock)}
          </p>
        </div>
        <div
          className={cn(
            'flex-1 rounded-xl border px-3 py-2 text-center',
            state.isMyTurn && phase === 'playing'
              ? 'border-emerald-400/50 bg-emerald-500/10'
              : 'border-white/10 bg-white/5',
          )}
        >
          <p className="text-[10px] uppercase tracking-wide text-slate-400">You</p>
          <p className={cn('font-mono text-xl', myClock < 30_000 && 'text-rose-300')}>
            {formatClock(myClock)}
          </p>
        </div>
      </div>

      {/* Board */}
      <div className="mx-auto w-full max-w-[min(94vw,30rem)]">
        <div className="grid grid-cols-8 overflow-hidden rounded-xl border border-white/10">
          {order.map((square) => {
            const file = square % 8;
            const rank = Math.floor(square / 8);
            const dark = (file + rank) % 2 === 1;
            const piece = state.board[square];
            const isSelected = selected === square;
            const isTarget = targetSet.has(square);
            const isLast = state.lastMove?.from === square || state.lastMove?.to === square;
            const isCheckedKing =
              piece?.type === 'k' && state.inCheck === piece.color;

            return (
              <button
                key={square}
                type="button"
                disabled={!canMove}
                onClick={() => onSquare(square)}
                aria-label={`${FILES[file]}${8 - rank}${piece ? ` ${piece.color === 'w' ? 'white' : 'black'} ${piece.type}` : ' empty'}`}
                className={cn(
                  'relative grid aspect-square place-items-center text-[clamp(1.4rem,7vw,2.4rem)] leading-none transition',
                  dark ? 'bg-[#7c6a58]' : 'bg-[#e6d6bd]',
                  isLast && 'ring-2 ring-inset ring-amber-300/70',
                  isSelected && 'ring-4 ring-inset ring-sky-400',
                  isCheckedKing && 'bg-rose-500/70',
                )}
              >
                {piece ? (
                  <span
                    className={cn(
                      'select-none drop-shadow',
                      piece.color === 'w' ? 'text-white' : 'text-slate-900',
                    )}
                  >
                    {GLYPH[piece.color][piece.type]}
                  </span>
                ) : null}

                {/* Legal move hints: a dot for a quiet move, a ring for a capture. */}
                {isTarget ? (
                  piece ? (
                    <span className="absolute inset-1 rounded-full border-4 border-emerald-400/80" aria-hidden />
                  ) : (
                    <span className="absolute h-1/4 w-1/4 rounded-full bg-emerald-400/70" aria-hidden />
                  )
                ) : null}

                {/* Coordinates along the edges. */}
                {file === (flipped ? 7 : 0) ? (
                  <span className="absolute left-0.5 top-0.5 text-[9px] font-bold text-black/40">
                    {8 - rank}
                  </span>
                ) : null}
                {rank === (flipped ? 0 : 7) ? (
                  <span className="absolute bottom-0.5 right-0.5 text-[9px] font-bold text-black/40">
                    {FILES[file]}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* Captured pieces */}
      <div className="mx-auto flex max-w-md justify-between gap-3 text-2xl leading-none">
        <div aria-label="Pieces you captured">
          {state.captured[opponentColor].map((type, index) => (
            <span key={index} className="text-slate-300">
              {GLYPH[opponentColor][type]}
            </span>
          ))}
        </div>
        <div aria-label="Pieces you lost">
          {state.captured[state.myColor ?? 'w'].map((type, index) => (
            <span key={index} className="text-slate-500">
              {GLYPH[state.myColor ?? 'w'][type]}
            </span>
          ))}
        </div>
      </div>

      {phase === 'finished' ? (
        <div className="card space-y-1 p-4 text-center">
          <p className="text-lg font-semibold text-white">
            {RESULT_LABEL[state.resultType ?? ''] ?? 'Game over'}
          </p>
          <p className="text-xs text-slate-400">
            {state.moveHistory.length} plies · {state.fullmove} moves
          </p>
        </div>
      ) : (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => sendAction({ type: 'resign' } satisfies GameAction)}
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 transition hover:text-white"
          >
            <Flag className="h-4 w-4" aria-hidden /> Resign
          </button>
        </div>
      )}

      {/* Move history */}
      {state.moveHistory.length > 0 ? (
        <div className="card max-h-40 overflow-y-auto p-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">Moves</p>
          <ol className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-xs text-slate-300 sm:grid-cols-3">
            {Array.from({ length: Math.ceil(state.moveHistory.length / 2) }, (_unused, pair) => {
              const white = state.moveHistory[pair * 2];
              const black = state.moveHistory[pair * 2 + 1];
              return (
                <li key={pair}>
                  <span className="text-slate-500">{pair + 1}.</span> {white?.san ?? ''}{' '}
                  <span className="text-slate-400">{black?.san ?? ''}</span>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

export const chessClient: ClientGameModule = {
  metadata: CHESS_METADATA,
  Component: ChessGame as unknown as ComponentType<GameComponentProps<never>>,
};
