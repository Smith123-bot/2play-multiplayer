import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { HelpCircle } from 'lucide-react';
import { SOS_GAME_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { HowToPlayModal, useHowToPlay } from '../../components/game/HowToPlayModal';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

type SosLetter = 'S' | 'O';

export interface SosPublicState {
  phase: 'idle' | 'playing' | 'finished';
  size: number;
  board: Array<SosLetter | null>;
  currentPlayerId: string | null;
  isMyTurn: boolean;
  lines: Array<{ cells: number[]; playerId: string }>;
  moves: number;
  lastMove: { index: number; letter: SosLetter; playerId: string; scored: number } | null;
  extraTurn: boolean;
  turnEndsAt: number | null;
  winnerId: string | null;
  isDraw: boolean;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  players: Record<
    string,
    { seat: number; score: number; moves: number; extraTurns: number; disconnected: boolean }
  >;
}

const SEAT_COLOR = ['#38bdf8', '#f472b6'];

function SosGameComponent({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<SosPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const rules = useHowToPlay(SOS_GAME_METADATA.id);
  const [letter, setLetter] = useState<SosLetter>('S');

  const phase = state?.phase ?? 'idle';
  const canPlay = phase === 'playing' && Boolean(state?.isMyTurn);

  const place = useCallback(
    (index: number) => {
      if (!canPlay) return;
      if (state?.board?.[index] != null) {
        play('wrong');
        vibrate('error');
        return;
      }
      sendAction({ type: 'place', payload: { index, letter } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [canPlay, state?.board, letter, sendAction, play, vibrate],
  );

  // S / O keyboard shortcuts.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)) {
        return;
      }
      if (event.key === 's' || event.key === 'S') setLetter('S');
      if (event.key === 'o' || event.key === 'O') setLetter('O');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (event === previousEvent.current) return;
    previousEvent.current = event;
    if (!event) return;
    const mine = myPlayerId ? event.includes(myPlayerId) : false;
    if (event.startsWith('sos:')) {
      play('score');
      if (mine) vibrate('success');
    } else if (event.startsWith('place:')) {
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

  /** Maps each cell to the seat colour of whoever scored a line through it. */
  const lineOwners = useMemo(() => {
    const map = new Map<number, number>();
    for (const line of state?.lines ?? []) {
      const seat = state?.players?.[line.playerId]?.seat ?? 0;
      for (const cell of line.cells) map.set(cell, seat);
    }
    return map;
  }, [state?.lines, state?.players]);

  if (phase === 'idle' || !state?.board?.length) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Drawing the grid…</p>
        </div>
      </div>
    );
  }

  const currentPlayer = players.find((player) => player.id === state.currentPlayerId);

  return (
    <div className="space-y-4">
      <HowToPlayModal game={SOS_GAME_METADATA} open={rules.open} onClose={rules.close} />

      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.players?.[player.id]?.score ?? 0,
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
        {state.extraTurn && phase === 'playing' ? <Badge tone="warning">Extra turn!</Badge> : null}
        <Badge tone="default">{state.lines.length} SOS made</Badge>
        <button
          type="button"
          onClick={rules.show}
          aria-label="How to play"
          className="rounded-full border border-white/10 p-1.5 text-slate-400 transition hover:text-white"
        >
          <HelpCircle className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* Letter picker */}
      <div className="flex justify-center gap-3">
        {(['S', 'O'] as SosLetter[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setLetter(option)}
            aria-pressed={letter === option}
            aria-label={`Place the letter ${option}`}
            className={cn(
              'grid h-14 w-20 place-items-center rounded-xl border-2 text-2xl font-bold transition active:scale-95',
              letter === option
                ? 'border-primary-400 bg-primary-500/25 text-white'
                : 'border-white/10 bg-white/5 text-slate-300',
            )}
          >
            {option}
          </button>
        ))}
      </div>

      <div
        className="mx-auto grid w-full max-w-[min(94vw,26rem)] gap-1.5"
        style={{ gridTemplateColumns: `repeat(${state.size}, minmax(0, 1fr))` }}
        role="grid"
        aria-label="SOS board"
      >
        {state.board.map((cell, index) => {
          const owner = lineOwners.get(index);
          const isLast = state.lastMove?.index === index;
          return (
            <motion.button
              key={index}
              type="button"
              whileTap={canPlay && cell === null ? { scale: 0.9 } : undefined}
              disabled={!canPlay || cell !== null}
              onClick={() => place(index)}
              aria-label={cell ? `Cell ${index + 1} has ${cell}` : `Place ${letter} in cell ${index + 1}`}
              className={cn(
                'grid aspect-square place-items-center rounded-lg border-2 text-xl font-bold transition',
                cell === null
                  ? canPlay
                    ? 'border-white/15 bg-white/5 text-slate-600 hover:border-white/30 hover:text-slate-400'
                    : 'border-white/5 bg-white/[0.03] text-transparent'
                  : 'border-white/20 bg-white/10 text-white',
                owner !== undefined && 'ring-2',
                isLast && 'ring-2 ring-white',
              )}
              style={
                owner !== undefined
                  ? { borderColor: SEAT_COLOR[owner % SEAT_COLOR.length], color: SEAT_COLOR[owner % SEAT_COLOR.length] }
                  : undefined
              }
            >
              {cell ?? (canPlay ? letter : '')}
            </motion.button>
          );
        })}
      </div>

      {phase === 'finished' ? (
        <div className="card space-y-1 p-4 text-center">
          <p className="text-lg font-semibold text-white">
            {state.isDraw
              ? 'Draw — equal SOS lines'
              : `${players.find((p) => p.id === state.winnerId)?.nickname ?? 'Someone'} wins`}
          </p>
          <p className="text-xs text-slate-400">
            {state.moves} letters placed · {state.lines.length} SOS lines
          </p>
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
                style={{ backgroundColor: SEAT_COLOR[slot.seat % SEAT_COLOR.length] }}
                aria-hidden
              />
              {player.nickname}: {slot.score} SOS
              {slot.extraTurns > 0 ? ` · ${slot.extraTurns} extra turns` : ''}
              {slot.disconnected ? ' (offline)' : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export const sosGameClient: ClientGameModule = {
  metadata: SOS_GAME_METADATA,
  Component: SosGameComponent as unknown as ComponentType<GameComponentProps<never>>,
};
