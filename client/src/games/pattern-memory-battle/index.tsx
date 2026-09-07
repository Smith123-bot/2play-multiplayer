import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Brain, Check, X } from 'lucide-react';
import { PATTERN_MEMORY_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface PatternPlayerPublic {
  progress: number;
  locked: boolean;
  succeeded: boolean;
  mistakes: number;
  score: number;
  streak: number;
  completedRounds: number;
  disconnected: boolean;
  left: boolean;
}

export interface PatternMemoryPublicState {
  phase: 'idle' | 'show' | 'input' | 'reveal' | 'finished';
  round: number;
  totalRounds: number;
  patternLength: number;
  shown: number;
  showStepMs: number;
  inputEndsAt: number | null;
  flash: number | null;
  revealPattern: number[] | null;
  history: Array<{ round: number; length: number }>;
  players: Record<string, PatternPlayerPublic | null>;
  startedAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
}

const TILE_COLORS = [
  'bg-rose-500/80', 'bg-amber-500/80', 'bg-emerald-500/80',
  'bg-sky-500/80', 'bg-violet-500/80', 'bg-pink-500/80',
  'bg-teal-500/80', 'bg-orange-500/80', 'bg-indigo-500/80',
];

const TILE_GLOWS = [
  'shadow-[0_0_24px_rgba(244,63,94,0.9)]', 'shadow-[0_0_24px_rgba(245,158,11,0.9)]',
  'shadow-[0_0_24px_rgba(16,185,129,0.9)]', 'shadow-[0_0_24px_rgba(14,165,233,0.9)]',
  'shadow-[0_0_24px_rgba(139,92,246,0.9)]', 'shadow-[0_0_24px_rgba(236,72,153,0.9)]',
  'shadow-[0_0_24px_rgba(20,184,166,0.9)]', 'shadow-[0_0_24px_rgba(249,115,22,0.9)]',
  'shadow-[0_0_24px_rgba(99,102,241,0.9)]',
];

function PatternMemoryGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<PatternMemoryPublicState>) {
  const [flashActive, setFlashActive] = useState(false);
  const [tapped, setTapped] = useState<number | null>(null);
  const previousFlashKey = useRef<string | null>(null);
  const previousEvent = useRef<string | null>(null);
  const [, forceTick] = useState(0);

  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.players?.[myPlayerId] : undefined;
  const rival = players.find((player) => player.id !== myPlayerId);
  const rivalView = rival ? state?.players?.[rival.id] : undefined;
  const myTurn = phase === 'input' && !!me && !me.locked;

  // Flash animation: light up the tile for most of the show step.
  const flashKey = `${state?.shown ?? 0}:${state?.flash ?? 'x'}`;
  useEffect(() => {
    if (phase !== 'show' || state?.flash === null || state?.flash === undefined) {
      setFlashActive(false);
      return;
    }
    if (flashKey === previousFlashKey.current) return;
    previousFlashKey.current = flashKey;
    setFlashActive(true);
    play('click');
    const id = window.setTimeout(
      () => setFlashActive(false),
      Math.max(180, (state?.showStepMs ?? 500) * 0.8),
    );
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashKey, phase]);

  // Event feedback.
  const lastEvent = state?.lastEvent ?? null;
  useEffect(() => {
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (!lastEvent) return;
    const [kind, actor] = lastEvent.split(':');
    const mine = actor === myPlayerId;
    if (kind === 'tap' && mine) play('correct');
    else if (kind === 'perfect' && mine) {
      play('score');
      vibrate('success');
    } else if (kind === 'perfect') play('notification');
    else if (kind === 'mistake') {
      play('wrong');
      vibrate('error');
    } else if (kind === 'reveal') play('notification');
    else if (kind === 'finished') {
      const iWon = (me?.score ?? 0) > (rivalView?.score ?? 0);
      play(iWon ? 'victory' : 'defeat');
      vibrate(iWon ? 'victory' : 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent]);

  // Input countdown ticker.
  useEffect(() => {
    if (phase !== 'input') return;
    const id = window.setInterval(() => forceTick((tick) => tick + 1), 250);
    return () => window.clearInterval(id);
  }, [phase]);

  if (phase === 'idle' || !state) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Weaving the first pattern…</p>
        </div>
      </div>
    );
  }

  const tap = (tile: number) => {
    if (!myTurn) return;
    setTapped(tile);
    window.setTimeout(() => setTapped(null), 180);
    sendAction({ type: 'tap', payload: { tile } } satisfies GameAction);
    vibrate('buttonPress');
  };

  const revealed = state.revealPattern ?? null;
  const inputLeft =
    state.inputEndsAt !== null
      ? Math.max(0, (state.inputEndsAt - state.serverTime) / 1000)
      : null;
  const myScore = me?.score ?? 0;
  const rivalScore = rivalView?.score ?? 0;
  const iWon = phase === 'finished' && myScore > rivalScore;
  const isDraw = phase === 'finished' && myScore === rivalScore;

  const phaseBanner =
    phase === 'show'
      ? { tone: 'warning' as const, text: `Watch closely… ${state.shown}/${state.patternLength}` }
      : phase === 'input'
        ? { tone: 'primary' as const, text: `Your turn — ${me?.progress ?? 0}/${state.patternLength}` }
        : phase === 'reveal'
          ? { tone: 'accent' as const, text: 'Round review' }
          : { tone: 'default' as const, text: 'Match over' };

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.players?.[player.id]?.score ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        label={`Round ${state.round}/${state.totalRounds}`}
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge tone={phaseBanner.tone} icon={<Brain className="h-3 w-3" aria-hidden />}>
          {phaseBanner.text}
        </Badge>
        {me && me.streak > 0 ? <Badge tone="success">Streak x{me.streak}</Badge> : null}
        {phase === 'input' && inputLeft !== null ? (
          <Badge tone={inputLeft < 2 ? 'danger' : 'default'}>{inputLeft.toFixed(1)}s</Badge>
        ) : null}
        {phase === 'finished' ? (
          <Badge tone={isDraw ? 'accent' : iWon ? 'success' : 'danger'}>
            {isDraw ? 'Draw' : iWon ? 'You win!' : 'Rival wins'}
          </Badge>
        ) : null}
      </div>

      {/* 3x3 board */}
      <div className="mx-auto w-full max-w-sm">
        <div className="grid grid-cols-3 gap-2" role="grid" aria-label="Pattern board">
          {Array.from({ length: 9 }, (_, tile) => {
            const isFlash = phase === 'show' && state.flash === tile && flashActive;
            const isTap = tapped === tile;
            const revealedHere = revealed?.indexOf(tile);
            void revealedHere;
            return (
              <button
                key={tile}
                type="button"
                aria-label={`Tile ${tile + 1}`}
                disabled={!myTurn}
                onClick={() => tap(tile)}
                className={cn(
                  'grid aspect-square place-items-center rounded-2xl border border-white/10 text-2xl font-bold text-white/90 transition-all duration-150 active:scale-95',
                  TILE_COLORS[tile],
                  isFlash && cn('scale-105 brightness-150', TILE_GLOWS[tile]),
                  isTap && 'brightness-150',
                  !isFlash && !isTap && 'brightness-[0.45]',
                  myTurn && 'brightness-75',
                )}
              >
                {tile + 1}
              </button>
            );
          })}
        </div>

        {/* Progress row */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1" aria-label="Your progress">
            {Array.from({ length: state.patternLength }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'h-2.5 w-2.5 rounded-full',
                  i < (me?.progress ?? 0) ? 'bg-indigo-400' : 'bg-white/15',
                )}
              />
            ))}
            {me?.locked ? (
              me.succeeded ? (
                <Check className="h-4 w-4 text-emerald-400" aria-label="perfect" />
              ) : (
                <X className="h-4 w-4 text-rose-400" aria-label="mistake" />
              )
            ) : null}
          </div>
          {rival ? (
            <span className="text-xs text-slate-400">
              {rival.nickname}: {rivalView?.score ?? 0} pts
              {rivalView?.locked ? (rivalView.succeeded ? ' ✅' : ' ❌') : ''}
            </span>
          ) : null}
        </div>

        {/* Reveal: the sequence, for review */}
        {phase === 'reveal' && revealed ? (
          <div className="card mt-3 flex flex-wrap items-center justify-center gap-2 p-3">
            <span className="text-xs uppercase tracking-wider text-slate-500">The pattern was</span>
            {revealed.map((tile, index) => (
              <span
                key={index}
                className={cn(
                  'grid h-8 w-8 place-items-center rounded-lg text-sm font-bold text-white/90',
                  TILE_COLORS[tile],
                )}
              >
                {tile + 1}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <p className="text-center text-xs text-slate-500">
        {phase === 'show'
          ? 'Memorise the flashes…'
          : phase === 'input'
            ? 'Tap the tiles in the same order — one mistake ends your attempt.'
            : phase === 'reveal'
              ? 'Next pattern loads in a moment…'
              : 'Thanks for playing!'}
      </p>
    </div>
  );
}

export const patternMemoryClient: ClientGameModule = {
  metadata: PATTERN_MEMORY_METADATA,
  Component: PatternMemoryGame as unknown as ComponentType<GameComponentProps<never>>,
};
