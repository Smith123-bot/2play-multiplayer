import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import { MIN_HUMAN_REACTION_MS, REACTION_RACE_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface ReactionRacePublicState {
  phase: 'idle' | 'waiting' | 'go' | 'roundResult' | 'finished';
  round: number;
  totalRounds: number;
  goAt: number | null;
  serverTime: number;
  roundWinner: string | null;
  falseStarts: string[];
  reacted: Record<string, { timeMs: number | null; falseStart: boolean }>;
  scores: Record<string, number>;
  history: Array<{
    round: number;
    winner: string | null;
    times: Record<string, number | null>;
    falseStarts: string[];
  }>;
  lastEvent: string | null;
}

function ReactionRaceGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<ReactionRacePublicState>) {
  const [feedback, setFeedback] = useState<'none' | 'false' | 'good' | 'slow'>('none');
  const feedbackTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    };
  }, []);

  const phase = state?.phase ?? 'idle';
  const myReaction = myPlayerId ? state?.reacted?.[myPlayerId] : undefined;
  const iFalseStarted = myPlayerId ? state?.falseStarts?.includes(myPlayerId) : false;
  const roundWinnerName = players.find((player) => player.id === state?.roundWinner)?.nickname ?? null;
  const lastTimes = state?.history?.[state.history.length - 1]?.times ?? {};

  const tap = useCallback(() => {
    if (!state) return;
    if (phase !== 'waiting' && phase !== 'go') return;
    if (myReaction || iFalseStarted) return;

    sendAction({ type: 'tap' } satisfies GameAction);

    if (phase === 'waiting') {
      setFeedback('false');
      play('wrong');
      vibrate('error');
    } else {
      setFeedback('good');
      play('score');
      vibrate('success');
    }
    if (feedbackTimer.current) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => setFeedback('none'), 900);
  }, [state, phase, myReaction, iFalseStarted, sendAction, play, vibrate]);

  // Keyboard support (Space / Enter) for desktop players.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.code !== 'Enter') return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) return;
      event.preventDefault();
      tap();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tap]);

  const tapDisabled = phase !== 'waiting' && phase !== 'go';

  return (
    <div className="space-y-4">
      <GameHUD players={players} myPlayerId={myPlayerId} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone="primary">
          Round {Math.max(1, state?.round ?? 0)} / {state?.totalRounds ?? 5}
        </Badge>
        {state?.phase === 'roundResult' ? (
          <Badge tone={roundWinnerName ? 'success' : 'warning'}>
            {roundWinnerName ? `${roundWinnerName} wins the round` : 'False start — no point'}
          </Badge>
        ) : null}
        {iFalseStarted ? <Badge tone="danger">You false started</Badge> : null}
      </div>

      <motion.button
        type="button"
        onClick={tap}
        disabled={tapDisabled}
        whileTap={{ scale: 0.97 }}
        aria-live="polite"
        aria-label={
          phase === 'go' ? 'Tap now' : phase === 'waiting' ? 'Wait for the signal' : 'Waiting for the next round'
        }
        className={cn(
          'relative grid min-h-[260px] w-full place-items-center overflow-hidden rounded-3xl border-2 text-center transition-colors duration-200',
          phase === 'go'
            ? 'border-success bg-gradient-to-br from-success/30 via-success/10 to-primary-500/20'
            : phase === 'waiting'
              ? 'border-warning/40 bg-gradient-to-br from-warning/10 to-transparent'
              : 'border-white/10 bg-white/[0.03]',
        )}
      >
        {phase === 'waiting' ? (
          <div className="space-y-2">
            <span className="block text-2xl font-bold text-warning">Wait for it…</span>
            <span className="block text-sm text-slate-400">Tapping now is a false start</span>
          </div>
        ) : null}

        {phase === 'go' ? (
          <div className="space-y-2">
            <Zap className="mx-auto h-12 w-12 text-success" aria-hidden />
            <span className="block text-4xl font-black text-white">TAP!</span>
          </div>
        ) : null}

        {phase === 'roundResult' ? (
          <div className="space-y-3 px-4">
            <span className="block text-xl font-bold text-white">
              {roundWinnerName ? `${roundWinnerName} reacted first` : 'Nobody scored'}
            </span>
            <ul className="mx-auto max-w-sm space-y-1">
              {players.map((player) => {
                const time = lastTimes[player.id];
                return (
                  <li key={player.id} className="flex items-center justify-between text-sm text-slate-300">
                    <span>
                      {player.nickname}
                      {player.id === myPlayerId ? ' (you)' : ''}
                    </span>
                    <span className="tabular-nums">
                      {time !== null && time !== undefined ? `${time} ms` : '—'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {phase === 'idle' || phase === 'finished' ? (
          <span className="text-slate-400">Get ready…</span>
        ) : null}

        {feedback === 'false' ? (
          <motion.span
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 grid place-items-center bg-danger/20 text-2xl font-black text-danger"
          >
            FALSE START!
          </motion.span>
        ) : null}

        {feedback === 'good' && myReaction?.timeMs ? (
          <motion.span
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute inset-0 grid place-items-center bg-success/20 text-3xl font-black text-success"
          >
            {myReaction.timeMs} ms
          </motion.span>
        ) : null}
      </motion.button>

      <p className="text-center text-xs text-slate-500">
        The server measures your reaction ({MIN_HUMAN_REACTION_MS} ms minimum) — clients cannot fake it.
      </p>
    </div>
  );
}

export const reactionRaceClient: ClientGameModule = {
  metadata: REACTION_RACE_METADATA,
  Component: ReactionRaceGame as unknown as ComponentType<GameComponentProps<never>>,
};
