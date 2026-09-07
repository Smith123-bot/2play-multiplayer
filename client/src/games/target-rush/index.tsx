import { useEffect, useRef, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { TARGET_RUSH_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface TargetRushPublicState {
  phase: 'idle' | 'round' | 'reveal' | 'finished';
  round: number;
  totalRounds: number;
  roundMs: number;
  prompt: string | null;
  targets: Array<{ id: string; symbol: string; x: number; y: number }>;
  endsAt: number | null;
  tapped: Record<string, boolean>;
  myLockedUntil: number;
  correctId: string | null;
  scores: Record<string, number>;
  hits: Record<string, number>;
  streaks: Record<string, number>;
  history: Array<{ number: number; prompt: string; correctId: string; winner: string | null }>;
  finishReason: string | null;
  serverTime: number;
}

const GRID_COLS = 4;
const GRID_ROWS = 3;

function TargetRushGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<TargetRushPublicState>) {
  const previousRound = useRef(0);
  const previousScore = useRef(0);

  const phase = state?.phase ?? 'idle';
  const round = state?.phase === 'round' ? state : null;
  const iWonLast = state?.history?.[state.history.length - 1]?.winner === myPlayerId;
  const locked = round && myPlayerId ? (round.myLockedUntil ?? 0) > round.serverTime : false;
  const iTapped = myPlayerId ? (round?.tapped?.[myPlayerId] ?? false) : false;
  const canTap = phase === 'round' && !locked && !iTapped;

  // Sound feedback when I score.
  const myScore = myPlayerId ? (state?.scores?.[myPlayerId] ?? 0) : 0;
  useEffect(() => {
    if (myScore > previousScore.current) {
      play('correct');
      vibrate('success');
    }
    previousScore.current = myScore;
  }, [myScore, play, vibrate]);

  useEffect(() => {
    if ((state?.round ?? 0) !== previousRound.current) previousRound.current = state?.round ?? 0;
  }, [state?.round]);

  const tap = (targetId: string) => {
    if (!canTap) return;
    sendAction({ type: 'hit', payload: { targetId } } satisfies GameAction);
    play('click');
    vibrate('buttonPress');
  };

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state?.scores?.[player.id] ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        deadline={state?.endsAt ?? null}
        label="Round time"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone="primary">
          Round {Math.max(1, state?.round ?? 0)} / {state?.totalRounds ?? 8}
        </Badge>
        {myPlayerId ? (
          <Badge tone={(state?.streaks?.[myPlayerId] ?? 0) > 0 ? 'accent' : 'default'}>
            🔥 streak {state?.streaks?.[myPlayerId] ?? 0}
          </Badge>
        ) : null}
        {phase === 'reveal' ? (
          <Badge tone={iWonLast ? 'success' : 'warning'}>Round over</Badge>
        ) : null}
        {phase === 'finished' ? <Badge tone="success">Match complete</Badge> : null}
      </div>

      <div className="card space-y-2 p-4 text-center">
        {phase === 'idle' ? (
          <p className="animate-pulse text-sm text-slate-400">Spawning the first targets…</p>
        ) : (
          <>
            <p className="text-xs uppercase tracking-wider text-slate-400">Tap the matching symbol</p>
            <motion.p
              key={`prompt-${state?.round}`}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-5xl"
              aria-live="polite"
            >
              {state?.prompt}
            </motion.p>
          </>
        )}
      </div>

      {round && round.targets.length > 0 ? (
        <div
          role="grid"
          aria-label="Targets"
          className="touch-none relative mx-auto grid h-72 w-full max-w-md grid-cols-4 grid-rows-3 gap-2 rounded-2xl border border-white/10 bg-black/40 p-2 select-none"
        >
          {round.targets.map((target) => {
            const isCorrect = phase === 'reveal' && state?.correctId === target.id;
            const mine = state?.correctId != null && target.id === state.correctId;
            return (
              <motion.button
                key={`${round.round}-${target.id}`}
                type="button"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.05 }}
                aria-label={`Target ${target.symbol}`}
                disabled={!canTap}
                onClick={() => tap(target.id)}
                style={{
                  gridColumn: `${target.x + 1} / span 1`,
                  gridRow: `${target.y + 1} / span 1`,
                }}
                className={cn(
                  'grid min-h-[64px] place-items-center rounded-2xl border-2 text-3xl transition active:scale-95',
                  isCorrect || mine
                    ? 'border-success bg-success/20'
                    : phase === 'reveal'
                      ? 'border-white/5 bg-white/[0.02] opacity-40'
                      : 'border-white/10 bg-white/5 hover:border-primary-400/50',
                  !canTap && phase === 'round' && 'opacity-50',
                )}
              >
                {target.symbol}
              </motion.button>
            );
          })}

          {locked ? (
            <div className="absolute inset-0 grid place-items-center rounded-2xl bg-black/60 text-sm font-bold text-danger">
              Wrong tap — locked for a moment…
            </div>
          ) : null}
          {iTapped && !locked && phase === 'round' ? (
            <div className="absolute inset-0 grid place-items-center rounded-2xl bg-black/60 text-sm font-bold text-slate-300">
              Tapped — waiting for the reveal…
            </div>
          ) : null}
        </div>
      ) : null}

      {phase === 'reveal' && state?.history?.length ? (
        <p className="text-center text-xs text-slate-400" aria-live="polite">
          {state.history[state.history.length - 1]!.winner
            ? `${players.find((p) => p.id === state.history[state.history.length - 1]!.winner)?.nickname ?? 'Someone'} won the round`
            : 'Nobody hit it in time — no points'}
        </p>
      ) : null}

      <p className="text-center text-xs text-slate-500">
        10 points per hit · up to +10 for speed · +2 per streak step — the server validates every tap.
        Grid {GRID_COLS}×{GRID_ROWS}.
      </p>
    </div>
  );
}

export const targetRushClient: ClientGameModule = {
  metadata: TARGET_RUSH_METADATA,
  Component: TargetRushGame as unknown as ComponentType<GameComponentProps<never>>,
};
