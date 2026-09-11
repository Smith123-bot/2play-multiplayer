import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { HelpCircle, Lightbulb } from 'lucide-react';
import { COUPLE_MEMORY_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { HowToPlayModal, useHowToPlay } from '../../components/game/HowToPlayModal';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../utils/cn';

interface CardView {
  id: string;
  faceUp: boolean;
  matched: boolean;
  symbol: string | null;
  bonus: boolean;
  flippedBy: string | null;
}

export interface MemoryPublicState {
  phase: 'idle' | 'playing' | 'resolving' | 'level-clear' | 'finished';
  level: number;
  totalLevels: number;
  levelName: string;
  hint: string;
  cols: number;
  rows: number;
  cards: CardView[];
  pairsFound: number;
  pairsTotal: number;
  mistakes: number;
  maxMistakes: number;
  combo: number;
  bestCombo: number;
  teamScore: number;
  levelsCleared: number;
  levelEndsAt: number | null;
  lastEvent: string | null;
  lastPair: { a: string; b: string; matched: boolean } | null;
  finishReason: string | null;
  serverTime: number;
  pendingCount: number;
  pendingBy: string | null;
  me: { flips: number; matchesHelped: number; hintsUsed: number } | null;
  players: Record<
    string,
    { flips: number; matchesHelped: number; hintsUsed: number; disconnected: boolean }
  >;
}

function CoupleMemoryGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<MemoryPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const hintRef = useRef<string | null>(null);
  const rules = useHowToPlay(COUPLE_MEMORY_METADATA.id);

  const phase = state?.phase ?? 'idle';
  // Co-op rule: you cannot flip the second card of your own pair.
  const myTurnBlocked = state?.pendingCount === 1 && state?.pendingBy === myPlayerId;
  const playing = phase === 'playing' && !myTurnBlocked;

  const flip = useCallback(
    (cardId: string) => {
      if (!playing) return;
      sendAction({ type: 'flip', payload: { cardId } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [playing, sendAction, vibrate],
  );

  const askHint = useCallback(() => {
    if (phase !== 'playing') return;
    sendAction({ type: 'hint' } satisfies GameAction);
    play('click');
  }, [phase, sendAction, play]);

  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (event === previousEvent.current) return;
    previousEvent.current = event;
    if (!event) return;
    if (event.startsWith('match:')) {
      play('correct');
      vibrate('success');
    } else if (event.startsWith('miss:')) {
      play('wrong');
    } else if (event.startsWith('flip:')) {
      play('click');
    } else if (event.startsWith('hint:')) {
      hintRef.current = event.split(':')[2] ?? null;
      play('notification');
    } else if (event.startsWith('level-clear:')) {
      play('victory');
      vibrate('victory');
      hintRef.current = null;
    } else if (event.startsWith('level:')) {
      play('gameStart');
      hintRef.current = null;
    } else if (event === 'timeout' || event === 'finished' || event === 'out-of-mistakes') {
      play('gameOver');
    }
  }, [state?.lastEvent, play, vibrate]);

  if (phase === 'idle' || !state?.cards?.length) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Shuffling the deck…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <HowToPlayModal game={COUPLE_MEMORY_METADATA} open={rules.open} onClose={rules.close} />

      <GameHUD
        players={players.map((player) => ({ ...player, score: state.teamScore }))}
        myPlayerId={myPlayerId}
        deadline={state.levelEndsAt ?? null}
        label={phase === 'level-clear' ? 'Next level' : 'Level clock'}
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge tone="primary">
          Level {Math.min(state.level + 1, state.totalLevels)}/{state.totalLevels}
        </Badge>
        <Badge tone="default">{state.levelName}</Badge>
        <Badge tone="success">Team {state.teamScore}</Badge>
        {state.combo > 1 ? <Badge tone="warning">Combo x{state.combo}</Badge> : null}
        {state.maxMistakes > 0 ? (
          <Badge tone={state.mistakes >= state.maxMistakes - 2 ? 'danger' : 'default'}>
            Misses {state.mistakes}/{state.maxMistakes}
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

      <div className="card space-y-2 p-3">
        <p className="text-sm text-slate-300">{state.hint}</p>
        <ProgressBar
          value={state.pairsFound}
          max={Math.max(1, state.pairsTotal)}
          label={`Pairs ${state.pairsFound}/${state.pairsTotal}`}
        />
      </div>

      {myTurnBlocked ? (
        <p className="text-center text-sm text-amber-300">
          You flipped the first card — your partner flips the match.
        </p>
      ) : null}
      {phase === 'level-clear' ? (
        <p className="text-center text-sm text-emerald-300">Board cleared! Next level loading…</p>
      ) : null}

      <div
        className="mx-auto grid w-full max-w-[min(94vw,30rem)] gap-2"
        style={{ gridTemplateColumns: `repeat(${state.cols}, minmax(0, 1fr))` }}
        role="grid"
        aria-label="Couple Memory board"
      >
        {state.cards.map((card) => {
          const hinted = hintRef.current === card.id && !card.faceUp && !card.matched;
          const disabled = !playing || card.faceUp || card.matched;
          return (
            <motion.button
              key={card.id}
              type="button"
              whileTap={disabled ? undefined : { scale: 0.9 }}
              disabled={disabled}
              onClick={() => flip(card.id)}
              aria-label={card.symbol ? `Card showing ${card.symbol}` : 'Face-down card'}
              className={cn(
                'grid aspect-square place-items-center rounded-xl border text-2xl transition',
                card.matched
                  ? card.bonus
                    ? 'border-amber-400/70 bg-amber-500/25 text-amber-100'
                    : 'border-emerald-400/60 bg-emerald-500/20 text-emerald-100'
                  : card.faceUp
                    ? 'border-sky-400/60 bg-sky-500/20 text-white'
                    : 'border-white/10 bg-white/5 text-slate-600',
                hinted && 'ring-2 ring-amber-300',
                !disabled && 'active:scale-95',
              )}
            >
              {card.symbol ?? '?'}
            </motion.button>
          );
        })}
      </div>

      <div className="flex justify-center">
        <Button
          variant="ghost"
          onClick={askHint}
          disabled={phase !== 'playing'}
          icon={<Lightbulb className="h-4 w-4" />}
        >
          Hint (−40)
        </Button>
      </div>

      <div className="flex flex-wrap justify-center gap-3 text-xs text-slate-400">
        {players.map((player) => {
          const slot = state.players?.[player.id];
          if (!slot) return null;
          return (
            <span key={player.id}>
              {player.nickname}: {slot.matchesHelped} pairs helped
              {slot.disconnected ? ' (offline)' : ''}
            </span>
          );
        })}
      </div>

      <p className="text-center text-xs text-slate-500">
        Every pair needs one card from each of you — say what you see out loud.
      </p>
    </div>
  );
}

export const coupleMemoryClient: ClientGameModule = {
  metadata: COUPLE_MEMORY_METADATA,
  Component: CoupleMemoryGame as unknown as ComponentType<GameComponentProps<never>>,
};
