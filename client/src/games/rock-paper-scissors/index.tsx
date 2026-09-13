import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { ROCK_PAPER_SCISSORS_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { useServerDeadline } from '../../hooks/useCountdown';
import { cn } from '../../utils/cn';

/**
 * Rock Paper Scissors — 2D renderer.
 *
 * A pure view over the server's per-viewer projection. It never decides an
 * outcome: it sends the shape the player tapped and waits for the server to
 * reveal the round. The opponent's throw arrives as `null` until the reveal, so
 * there is nothing here that could show it early even by accident.
 */

export type RpsChoice = 'rock' | 'paper' | 'scissors';
export type RpsOutcome = 'win' | 'loss' | 'draw' | 'forfeit';
export type RpsPhase = 'idle' | 'countdown' | 'choose' | 'reveal' | 'finished';

export interface RpsPublicState {
  phase: RpsPhase;
  round: number;
  winsNeeded: number;
  maxRounds: number;
  countdownUntil: number | null;
  chooseUntil: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  myChoice: RpsChoice | null;
  opponents: Record<
    string,
    {
      score: number;
      draws: number;
      forfeits: number;
      hasThrown: boolean;
      disconnected: boolean;
      left: boolean;
      choice: RpsChoice | null;
    }
  >;
  me: { score: number; draws: number; forfeits: number; disconnected: boolean } | null;
  seatOrder: string[];
  roundResult: {
    round: number;
    choices: Record<string, RpsChoice | null>;
    outcomes: Record<string, RpsOutcome>;
    forfeits: string[];
  } | null;
  history: Array<{
    round: number;
    choices: Record<string, RpsChoice | null>;
    outcomes: Record<string, RpsOutcome>;
    forfeits: string[];
  }>;
}

const EMOJI: Record<RpsChoice, string> = { rock: '🪨', paper: '📄', scissors: '✂️' };
const LABEL: Record<RpsChoice, string> = { rock: 'Rock', paper: 'Paper', scissors: 'Scissors' };
/** Desktop shortcuts, in button order. */
const KEYS: Record<RpsChoice, string> = { rock: 'r', paper: 'p', scissors: 's' };
const ORDER: RpsChoice[] = ['rock', 'paper', 'scissors'];
const CHOOSE_MS = 8_000;

/** "Rock beats scissors" — shown under each button so the rules stay on screen. */
const BEATS_HINT: Record<RpsChoice, string> = {
  rock: 'beats scissors',
  paper: 'beats rock',
  scissors: 'beats paper',
};

const OUTCOME_COPY: Record<RpsOutcome, { title: string; tone: string }> = {
  win: { title: 'You win the round', tone: 'text-success' },
  loss: { title: 'You lose the round', tone: 'text-danger' },
  draw: { title: 'Draw — same throw', tone: 'text-amber-300' },
  forfeit: { title: 'No throw in time', tone: 'text-danger' },
};

/** First-to-N pips, so the race to the win is visible at a glance. */
function ScorePips({ score, needed }: { score: number; needed: number }) {
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {Array.from({ length: needed }, (_, index) => (
        <span
          key={index}
          className={cn(
            'h-2 w-2 rounded-full transition-colors',
            index < score ? 'bg-success' : 'bg-white/20',
          )}
        />
      ))}
    </span>
  );
}

function RockPaperScissorsGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<RpsPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const phase = state?.phase ?? 'idle';

  const countdownRemaining = useServerDeadline(state?.countdownUntil ?? null);
  const chooseRemaining = useServerDeadline(state?.chooseUntil ?? null);

  const myScore = state?.me?.score ?? 0;
  const myChoice = state?.myChoice ?? null;
  const locked = myChoice !== null;

  const opponentId = state?.seatOrder?.find((id) => id !== myPlayerId) ?? null;
  const opponent = opponentId ? state?.opponents?.[opponentId] : undefined;
  const opponentPlayer = players.find((player) => player.id === opponentId);
  const myPlayer = players.find((player) => player.id === myPlayerId);

  const revealed = phase === 'reveal' || phase === 'finished';
  // A spectator (no seat in this match) has nothing to throw; the server would
  // reject it anyway, but the buttons must not look live.
  const canThrow = phase === 'choose' && !locked && Boolean(myPlayerId);

  // 3 → 2 → 1 during the countdown, then a brief GO! as the window opens.
  const countdownNumber = phase === 'countdown' ? Math.max(1, Math.ceil(countdownRemaining / 1000)) : null;
  const showGo = phase === 'choose' && chooseRemaining > CHOOSE_MS - 800;

  const throwShape = useCallback(
    (choice: RpsChoice) => {
      if (!canThrow) return;
      sendAction({ type: 'throw', payload: { choice } } satisfies GameAction);
      play('click');
      vibrate('buttonPress');
    },
    [canThrow, sendAction, play, vibrate],
  );

  // Desktop keyboard: R / P / S.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      const choice = ORDER.find((candidate) => KEYS[candidate] === event.key.toLowerCase());
      if (!choice) return;
      event.preventDefault();
      throwShape(choice);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [throwShape]);

  // Sound and haptics follow the server's event stream.
  useEffect(() => {
    const lastEvent = state?.lastEvent ?? null;
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (!lastEvent) return;

    if (lastEvent.startsWith('countdown:')) {
      play('countdown');
      vibrate('countdown');
    } else if (lastEvent.startsWith('go:')) {
      play('gameStart');
    } else if (lastEvent.startsWith('reveal:')) {
      const outcome = myPlayerId ? state?.roundResult?.outcomes?.[myPlayerId] : undefined;
      if (outcome === 'win') {
        play('correct');
        vibrate('success');
      } else if (outcome === 'loss' || outcome === 'forfeit') {
        play('wrong');
        vibrate('error');
      } else {
        play('draw');
      }
    } else if (lastEvent === 'finished' || lastEvent === 'timeout') {
      play('gameOver');
    }
  }, [state?.lastEvent, state?.roundResult, myPlayerId, play, vibrate]);

  if (phase === 'idle') {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Shaking hands…</p>
        </div>
      </div>
    );
  }

  const myOutcome = myPlayerId ? state?.roundResult?.outcomes?.[myPlayerId] ?? null : null;
  const opponentChoice = opponent?.choice ?? null;
  const finalWinner =
    phase === 'finished'
      ? (state?.me?.score ?? 0) > (opponent?.score ?? 0)
        ? 'me'
        : (state?.me?.score ?? 0) < (opponent?.score ?? 0)
          ? 'opponent'
          : 'draw'
      : null;

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score:
            player.id === myPlayerId
              ? myScore
              : (state?.opponents?.[player.id]?.score ?? player.score),
        }))}
        myPlayerId={myPlayerId}
        deadline={phase === 'countdown' ? (state?.countdownUntil ?? null) : (state?.chooseUntil ?? null)}
        label={phase === 'countdown' ? 'Throws in' : 'Time to throw'}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">
          Round {Math.min(state.round + 1, state.maxRounds)}
        </Badge>
        <Badge tone="accent">First to {state.winsNeeded}</Badge>
        {revealed ? <Badge tone="success">Reveal</Badge> : null}
        {opponent?.disconnected ? <Badge tone="warning">Opponent reconnecting</Badge> : null}
      </div>

      {/* Countdown / GO */}
      {countdownNumber !== null || showGo ? (
        <div className="grid place-items-center py-1" aria-live="polite">
          <span
            key={countdownNumber ?? 'go'}
            aria-label={`Countdown: ${countdownNumber ?? 'GO'}`}
            className="animate-pop text-5xl font-black tracking-tight text-white"
          >
            {countdownNumber ?? 'GO!'}
          </span>
        </div>
      ) : null}

      {/* The two seats */}
      <div className="grid grid-cols-2 gap-3">
        <div
          className={cn(
            'card flex flex-col items-center gap-2 p-3 text-center transition',
            locked && phase === 'choose' && 'border-primary-400/60 animate-pulse-ring',
          )}
        >
          <span className="text-2xl" aria-hidden="true">
            {myPlayer?.avatar ?? '🙂'}
          </span>
          <span className="max-w-full truncate text-sm font-semibold text-white">
            {myPlayer?.nickname ?? 'You'}
          </span>
          <span className="text-2xl font-black text-white">{myScore}</span>
          <ScorePips score={myScore} needed={state.winsNeeded} />
          <span className="text-[11px] uppercase tracking-wide text-slate-400">
            {phase === 'choose' ? (locked ? 'Locked in' : 'Your throw') : 'You'}
          </span>
          <span className="text-3xl" aria-label={myChoice ? LABEL[myChoice] : 'your throw'}>
            {myChoice ? EMOJI[myChoice] : revealed ? '—' : '❔'}
          </span>
        </div>

        <div className="card flex flex-col items-center gap-2 p-3 text-center">
          <span className="text-2xl" aria-hidden="true">
            {opponentPlayer?.avatar ?? '🤖'}
          </span>
          <span className="max-w-full truncate text-sm font-semibold text-white">
            {opponentPlayer?.nickname ?? 'Opponent'}
          </span>
          <span className="text-2xl font-black text-white">{opponent?.score ?? 0}</span>
          <ScorePips score={opponent?.score ?? 0} needed={state.winsNeeded} />
          <span className="text-[11px] uppercase tracking-wide text-slate-400">
            {phase === 'choose'
              ? opponent?.hasThrown
                ? 'Locked in'
                : 'Choosing…'
              : 'Opponent'}
          </span>
          {/* Face-down until the server reveals it — the choice simply is not here. */}
          <span
            className={cn('text-3xl', revealed && opponentChoice && 'animate-pop')}
            aria-label={revealed && opponentChoice ? `${opponentPlayer?.nickname ?? 'opponent'} threw ${LABEL[opponentChoice]}` : 'opponent throw hidden'}
          >
            {revealed ? (opponentChoice ? EMOJI[opponentChoice] : '—') : opponent?.hasThrown ? '🔒' : '❔'}
          </span>
        </div>
      </div>

      {/* Round outcome */}
      {revealed && myOutcome ? (
        <div className="card animate-scale-in p-4 text-center">
          <p className={cn('text-lg font-bold', OUTCOME_COPY[myOutcome].tone)}>
            {OUTCOME_COPY[myOutcome].title}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {myChoice && opponentChoice
              ? `${LABEL[myChoice]} vs ${LABEL[opponentChoice]}`
              : 'The round timer ran out.'}
          </p>
        </div>
      ) : null}

      {phase === 'finished' ? (
        <div className="card animate-slide-up p-5 text-center">
          <p className="text-3xl" aria-hidden="true">
            {finalWinner === 'me' ? '🏆' : finalWinner === 'opponent' ? '💔' : '🤝'}
          </p>
          <p className="mt-2 text-xl font-black text-white">
            {finalWinner === 'me'
              ? 'You won the match'
              : finalWinner === 'opponent'
                ? 'Opponent won the match'
                : 'Match drawn'}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            Final score {myScore} – {opponent?.score ?? 0}
          </p>
          <p className="mt-3 text-xs text-slate-500">
            Use Rematch below to run it back in this same room.
          </p>
        </div>
      ) : null}

      {/* The three throws — large tap targets, keyboard-labelled on desktop */}
      <div className="grid grid-cols-3 gap-3">
        {ORDER.map((choice) => {
          const mine = myChoice === choice;
          return (
            <button
              key={choice}
              type="button"
              aria-label={`Throw ${LABEL[choice]}`}
              aria-pressed={mine}
              disabled={!canThrow}
              onClick={() => throwShape(choice)}
              className={cn(
                'flex min-h-[128px] flex-col items-center justify-center gap-1 rounded-2xl border-2 px-2 py-4 transition active:scale-95',
                'disabled:cursor-not-allowed disabled:opacity-60',
                mine
                  ? 'border-primary-400 bg-primary-500/20'
                  : 'border-white/10 bg-white/5 hover:border-white/25',
              )}
            >
              <span className="text-4xl" aria-hidden="true">
                {EMOJI[choice]}
              </span>
              <span className="text-sm font-semibold text-white">{LABEL[choice]}</span>
              <span className="text-[10px] text-slate-400">{BEATS_HINT[choice]}</span>
              <span className="hidden text-[10px] uppercase tracking-wider text-slate-500 sm:block">
                Key {KEYS[choice].toUpperCase()}
              </span>
            </button>
          );
        })}
      </div>

      {phase === 'choose' && !locked ? (
        <p className="text-center text-xs text-slate-500">
          Your throw locks the moment you tap it — the server decides the round.
        </p>
      ) : null}
      {phase === 'choose' && locked && !opponent?.hasThrown ? (
        <p className="animate-pulse text-center text-xs text-slate-400">
          Locked in. Waiting for your opponent…
        </p>
      ) : null}

      {/* Round log */}
      {state.history.length > 0 ? (
        <div className="card p-3">
          <p className="text-[11px] uppercase tracking-wider text-slate-500">Rounds</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {state.history.slice(-8).map((record) => {
              const outcome = myPlayerId ? record.outcomes[myPlayerId] : undefined;
              const theirs = opponentId ? record.choices[opponentId] : null;
              const mine = myPlayerId ? record.choices[myPlayerId] : null;
              return (
                <span
                  key={record.round}
                  title={`Round ${record.round + 1}: ${mine ? LABEL[mine] : 'no throw'} vs ${theirs ? LABEL[theirs] : 'no throw'}`}
                  className={cn(
                    'flex items-center gap-1 rounded-lg border px-2 py-1 text-xs',
                    outcome === 'win' && 'border-success/50 bg-success/10 text-success',
                    outcome === 'loss' && 'border-danger/50 bg-danger/10 text-danger',
                    outcome === 'forfeit' && 'border-danger/50 bg-danger/10 text-danger',
                    outcome === 'draw' && 'border-white/15 bg-white/5 text-slate-300',
                  )}
                >
                  <span aria-hidden="true">{mine ? EMOJI[mine] : '·'}</span>
                  <span className="text-slate-500">vs</span>
                  <span aria-hidden="true">{theirs ? EMOJI[theirs] : '·'}</span>
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const rockPaperScissorsClient: ClientGameModule = {
  metadata: ROCK_PAPER_SCISSORS_METADATA,
  Component: RockPaperScissorsGame as unknown as ComponentType<GameComponentProps<never>>,
};
