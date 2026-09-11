import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { HelpCircle } from 'lucide-react';
import { HANGMAN_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { HowToPlayModal, useHowToPlay } from '../../components/game/HowToPlayModal';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface HangmanPublicState {
  phase: 'idle' | 'playing' | 'reveal' | 'finished';
  round: number;
  totalRounds: number;
  category: string;
  hint: string;
  masked: string;
  wordLength: number;
  guessed: string[];
  wrongLetters: string[];
  attemptsLeft: number;
  maxAttempts: number;
  currentPlayerId: string | null;
  isMyTurn: boolean;
  turnEndsAt: number | null;
  roundEndsAt: number | null;
  revealedWord: string | null;
  roundWonBy: string | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  me: { score: number; streak: number } | null;
  players: Record<
    string,
    { score: number; correct: number; wrong: number; roundsWon: number; streak: number; disconnected: boolean }
  >;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * Original, non-graphic gallows drawing: six abstract strokes appear as
 * attempts are used. Deliberately geometric — no figure is depicted.
 */
function Gallows({ used, max }: { used: number; max: number }) {
  const parts = [
    <line key="base" x1="10" y1="90" x2="70" y2="90" />,
    <line key="post" x1="25" y1="90" x2="25" y2="10" />,
    <line key="beam" x1="25" y1="10" x2="65" y2="10" />,
    <line key="rope" x1="65" y1="10" x2="65" y2="24" />,
    <circle key="ring" cx="65" cy="32" r="8" />,
    <line key="mark" x1="65" y1="40" x2="65" y2="62" />,
  ];
  return (
    <svg
      viewBox="0 0 80 100"
      className="mx-auto h-32 w-28"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      role="img"
      aria-label={`${used} of ${max} attempts used`}
    >
      <g className="text-slate-300">
        {parts.slice(0, Math.min(used, parts.length))}
      </g>
    </svg>
  );
}

function HangmanGame({ state, players, myPlayerId, sendAction, play, vibrate }: GameComponentProps<HangmanPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const rules = useHowToPlay(HANGMAN_METADATA.id);

  const phase = state?.phase ?? 'idle';
  const canGuess = phase === 'playing' && Boolean(state?.isMyTurn);

  const guess = useCallback(
    (letter: string) => {
      if (!canGuess) return;
      if (state?.guessed?.includes(letter)) return;
      sendAction({ type: 'guess', payload: { letter } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [canGuess, state?.guessed, sendAction, vibrate],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)) {
        return;
      }
      const letter = event.key.toUpperCase();
      if (letter.length === 1 && letter >= 'A' && letter <= 'Z') {
        event.preventDefault();
        guess(letter);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [guess]);

  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (event === previousEvent.current) return;
    previousEvent.current = event;
    if (!event) return;
    const mine = myPlayerId ? event.includes(myPlayerId) : false;
    if (event.startsWith('hit:')) {
      play('correct');
      if (mine) vibrate('success');
    } else if (event.startsWith('miss:')) {
      play('wrong');
      if (mine) vibrate('error');
    } else if (event.startsWith('round-win:')) {
      play(mine ? 'victory' : 'notification');
      if (mine) vibrate('victory');
    } else if (event === 'round-lost') {
      play('gameOver');
    } else if (event.startsWith('round:')) {
      play('gameStart');
    } else if (event === 'finished' || event === 'timeout') {
      play('gameOver');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Choosing a word…</p>
        </div>
      </div>
    );
  }

  const used = state.maxAttempts - state.attemptsLeft;
  const currentPlayer = players.find((player) => player.id === state.currentPlayerId);

  return (
    <div className="space-y-4">
      <HowToPlayModal game={HANGMAN_METADATA} open={rules.open} onClose={rules.close} />

      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.players?.[player.id]?.score ?? 0,
        }))}
        myPlayerId={myPlayerId}
        deadline={phase === 'reveal' ? state.roundEndsAt : state.turnEndsAt}
        label={phase === 'reveal' ? 'Next round' : 'Turn'}
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge tone="primary">
          Round {Math.min(state.round + 1, state.totalRounds)}/{state.totalRounds}
        </Badge>
        <Badge tone="default">{state.category}</Badge>
        <Badge tone={state.attemptsLeft <= 2 ? 'danger' : 'default'}>
          {state.attemptsLeft}/{state.maxAttempts} attempts
        </Badge>
        <Badge tone={state.isMyTurn ? 'success' : 'default'}>
          {state.isMyTurn ? 'Your turn' : currentPlayer ? `${currentPlayer.nickname}'s turn` : 'Waiting'}
        </Badge>
        <button
          type="button"
          onClick={rules.show}
          aria-label="How to play"
          className="rounded-full border border-white/10 p-1.5 text-slate-400 transition hover:text-white"
        >
          <HelpCircle className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="card space-y-3 p-4 text-center">
        <Gallows used={used} max={state.maxAttempts} />
        {state.hint ? <p className="text-xs text-slate-400">Hint: {state.hint}</p> : null}

        {/* Masked word — the server only ever sends revealed letters. */}
        <div className="flex flex-wrap justify-center gap-1.5" aria-label="Word to guess">
          {[...state.masked].map((char, index) => (
            <span
              key={index}
              className={cn(
                'grid h-11 w-8 place-items-center rounded-md border-b-2 text-xl font-bold',
                char === '_' ? 'border-slate-500 text-transparent' : 'border-emerald-400 text-white',
              )}
            >
              {char === '_' ? '?' : char}
            </span>
          ))}
        </div>

        {phase === 'reveal' && state.revealedWord ? (
          <p className="text-sm">
            <span className="text-slate-400">The word was </span>
            <span className="font-bold text-amber-300">{state.revealedWord}</span>
            {state.roundWonBy ? (
              <span className="text-emerald-300">
                {' '}
                — solved by {players.find((p) => p.id === state.roundWonBy)?.nickname ?? 'a player'}
              </span>
            ) : (
              <span className="text-rose-300"> — nobody got it</span>
            )}
          </p>
        ) : null}

        {state.wrongLetters.length > 0 ? (
          <p className="text-xs text-rose-300">Wrong: {state.wrongLetters.join(' ')}</p>
        ) : null}
      </div>

      {/* On-screen keyboard */}
      <div className="mx-auto grid max-w-md grid-cols-7 gap-1.5 sm:grid-cols-9">
        {ALPHABET.map((letter) => {
          const tried = state.guessed.includes(letter);
          const wrong = state.wrongLetters.includes(letter);
          return (
            <button
              key={letter}
              type="button"
              disabled={!canGuess || tried}
              onClick={() => guess(letter)}
              aria-label={`Guess ${letter}`}
              className={cn(
                'grid h-11 place-items-center rounded-lg border text-sm font-semibold transition active:scale-95 disabled:cursor-not-allowed',
                tried
                  ? wrong
                    ? 'border-rose-500/40 bg-rose-500/15 text-rose-300/60'
                    : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300/60'
                  : canGuess
                    ? 'border-white/15 bg-white/10 text-white'
                    : 'border-white/5 bg-white/[0.03] text-slate-600',
              )}
            >
              {letter}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap justify-center gap-3 text-xs text-slate-400">
        {players.map((player) => {
          const slot = state.players?.[player.id];
          if (!slot) return null;
          return (
            <span key={player.id}>
              {player.nickname}: {slot.score} pts · {slot.roundsWon} rounds
              {slot.streak > 1 ? ` · streak ${slot.streak}` : ''}
              {slot.disconnected ? ' (offline)' : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export const hangmanClient: ClientGameModule = {
  metadata: HANGMAN_METADATA,
  Component: HangmanGame as unknown as ComponentType<GameComponentProps<never>>,
};
