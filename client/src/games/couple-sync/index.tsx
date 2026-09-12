import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { HelpCircle, Zap } from 'lucide-react';
import { COUPLE_SYNC_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { HowToPlayModal, useHowToPlay } from '../../components/game/HowToPlayModal';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { cn } from '../../utils/cn';

type RoundType = 'together' | 'relay' | 'match' | 'order' | 'signal';

export interface CoupleSyncPublicState {
  phase: 'idle' | 'brief' | 'active' | 'feedback' | 'finished';
  round: number;
  totalRounds: number;
  teamScore: number;
  roundsWon: number;
  streak: number;
  bestStreak: number;
  difficultyTier: number;
  lastEvent: string | null;
  finishReason: string | null;
  history: Array<{ index: number; type: RoundType; success: boolean }>;
  serverTime: number;
  current: {
    index: number;
    type: RoundType;
    options: string[];
    code: string | null;
    isCodeHolder: boolean;
    hasCodeHolder: boolean;
    requiredOrder: string[];
    signalFired: boolean;
    signalAt: number | null;
    toleranceMs: number;
    syncSpreadMs: number | null;
    endsAt: number;
    succeeded: boolean | null;
    detail: string | null;
  } | null;
  me: { acted: boolean; submitted: string | null; mistakes: number } | null;
  players: Record<
    string,
    { acted: boolean; correct: number; mistakes: number; disconnected: boolean }
  >;
}

const ROUND_TITLE: Record<RoundType, string> = {
  together: 'Tap Together',
  relay: 'Relay the Code',
  match: 'Match the Symbol',
  order: 'Correct Order',
  signal: 'Wait for the Signal',
};

const ROUND_BRIEF: Record<RoundType, string> = {
  together: 'Both of you tap at the same moment.',
  relay: 'One of you sees a code. Read it out — the other types it in.',
  match: 'Agree out loud, then both pick the same symbol.',
  order: 'Act in exactly the order shown below.',
  signal: 'Wait for the green GO, then tap. Tapping early fails the round.',
};

function CoupleSyncGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<CoupleSyncPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const rules = useHowToPlay(COUPLE_SYNC_METADATA.id);
  const [codeEntry, setCodeEntry] = useState('');

  const phase = state?.phase ?? 'idle';
  const round = state?.current ?? null;
  const acted = state?.me?.acted ?? false;
  const canAct = phase === 'active' && Boolean(round) && round?.succeeded === null && !acted;

  const act = useCallback(
    (choice?: string) => {
      if (!canAct) return;
      const action: GameAction =
        choice === undefined ? { type: 'act' } : { type: 'act', payload: { choice } };
      sendAction(action);
      vibrate('buttonPress');
    },
    [canAct, sendAction, vibrate],
  );

  // Clear the typed code whenever a new round starts.
  useEffect(() => {
    setCodeEntry('');
  }, [round?.index]);

  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (event === previousEvent.current) return;
    previousEvent.current = event;
    if (!event) return;
    if (event.startsWith('success:')) {
      play('correct');
      vibrate('success');
    } else if (event.startsWith('fail:')) {
      play('wrong');
      vibrate('error');
    } else if (event.startsWith('brief:')) {
      play('countdown');
    } else if (event.startsWith('active:')) {
      play('gameStart');
    } else if (event.startsWith('signal:')) {
      play('score');
      vibrate('success');
    } else if (event === 'finished' || event === 'timeout') {
      play('gameOver');
    }
  }, [state?.lastEvent, play, vibrate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) ||
          target.isContentEditable)
      )
        return;
      if (!canAct || !round) return;
      if (round.type === 'match') {
        const index = Number(event.key) - 1;
        const option = round.options[index];
        if (option) {
          event.preventDefault();
          act(option);
        }
        return;
      }
      if ((event.key === ' ' || event.key === 'Enter') && round.type !== 'relay') {
        event.preventDefault();
        act();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [act, canAct, round]);

  if (phase === 'idle') {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Preparing the first round…</p>
        </div>
      </div>
    );
  }

  if (!round) {
    const cleared = (state?.roundsWon ?? 0) * 2 >= (state?.totalRounds ?? 1);
    return (
      <div className="space-y-4">
        <GameHUD
          players={players.map((player) => ({ ...player, score: state?.teamScore ?? 0 }))}
          myPlayerId={myPlayerId}
          label="Final team score"
        />
        <div className="card space-y-3 p-8 text-center">
          <p className="text-4xl" aria-hidden>
            {cleared ? '🤝' : '💫'}
          </p>
          <h2 className="text-xl font-semibold text-white">
            {cleared ? 'Challenge cleared!' : 'Keep practising together'}
          </h2>
          <p className="text-sm text-slate-300">
            Won {state?.roundsWon ?? 0} of {state?.totalRounds ?? 0} rounds ·{' '}
            {state?.teamScore ?? 0} points
          </p>
          <p className="text-xs text-slate-500">Best teamwork streak: {state?.bestStreak ?? 0}</p>
        </div>
      </div>
    );
  }

  const orderNames = round.requiredOrder.map(
    (id) => players.find((player) => player.id === id)?.nickname ?? 'Partner',
  );

  return (
    <div className="space-y-4">
      <HowToPlayModal game={COUPLE_SYNC_METADATA} open={rules.open} onClose={rules.close} />

      <GameHUD
        players={players.map((player) => ({ ...player, score: state?.teamScore ?? 0 }))}
        myPlayerId={myPlayerId}
        deadline={phase === 'active' ? round.endsAt : null}
        label="Round clock"
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge tone="primary">
          Round {Math.min(state!.round + 1, state!.totalRounds)}/{state!.totalRounds}
        </Badge>
        <Badge tone="success">Team {state!.teamScore}</Badge>
        <Badge tone="default">Won {state!.roundsWon}</Badge>
        <Badge tone="accent">Tier {state!.difficultyTier}/3</Badge>
        {state!.streak > 1 ? <Badge tone="warning">Streak x{state!.streak}</Badge> : null}
        <button
          type="button"
          onClick={rules.show}
          aria-label="How to play"
          className="rounded-full border border-white/10 p-1.5 text-slate-400 transition hover:text-white"
        >
          <HelpCircle className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="card space-y-2 p-4 text-center">
        <h2 className="text-lg font-semibold text-white">{ROUND_TITLE[round.type]}</h2>
        <p className="text-sm text-slate-400">{ROUND_BRIEF[round.type]}</p>
        {phase === 'brief' ? <p className="text-xs text-amber-300">Get ready…</p> : null}
        {round.succeeded !== null ? (
          <p
            className={cn(
              'text-sm font-medium',
              round.succeeded ? 'text-emerald-300' : 'text-rose-300',
            )}
          >
            {round.succeeded ? '✅ ' : '❌ '}
            {round.detail}
          </p>
        ) : null}
      </div>

      {/* Round specific controls */}
      <div className="card space-y-3 p-4">
        {round.type === 'together' || round.type === 'order' ? (
          <div className="space-y-3 text-center">
            {round.type === 'order' ? (
              <p className="text-sm text-slate-300">
                Order: {orderNames.map((name, index) => `${index + 1}. ${name}`).join('  →  ')}
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                Window: {round.toleranceMs}ms
                {round.syncSpreadMs !== null ? ` · actual ${round.syncSpreadMs}ms` : ''}
              </p>
            )}
            <Button onClick={() => act()} disabled={!canAct} className="min-w-48">
              {acted ? 'Waiting for partner…' : 'Tap now'}
            </Button>
          </div>
        ) : null}

        {round.type === 'signal' ? (
          <div className="space-y-3 text-center">
            <div
              className={cn(
                'mx-auto grid h-28 w-full max-w-xs place-items-center rounded-2xl border-2 text-lg font-bold transition',
                round.signalFired
                  ? 'border-emerald-400 bg-emerald-500/25 text-emerald-100'
                  : 'border-white/10 bg-white/5 text-slate-500',
              )}
              aria-live="polite"
            >
              {round.signalFired ? 'GO!' : 'Wait…'}
            </div>
            <Button
              onClick={() => act()}
              disabled={!canAct}
              variant={round.signalFired ? 'primary' : 'ghost'}
              icon={<Zap className="h-4 w-4" />}
              className="min-w-48"
            >
              {acted ? 'Tapped' : 'React'}
            </Button>
          </div>
        ) : null}

        {round.type === 'match' ? (
          <div className="space-y-3">
            <p className="text-center text-xs text-slate-500">
              Both partners must choose the same symbol.
            </p>
            <div className="grid grid-cols-4 gap-2">
              {round.options.map((symbol) => (
                <button
                  key={symbol}
                  type="button"
                  disabled={!canAct}
                  onClick={() => act(symbol)}
                  aria-label={`Choose ${symbol}`}
                  className={cn(
                    'grid aspect-square place-items-center rounded-xl border text-2xl transition active:scale-95 disabled:opacity-40',
                    state?.me?.submitted === symbol
                      ? 'border-emerald-400 bg-emerald-500/20 text-emerald-100'
                      : 'border-white/10 bg-white/5 text-white',
                  )}
                >
                  {symbol}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {round.type === 'relay' ? (
          <div className="space-y-3">
            {round.isCodeHolder ? (
              <div className="space-y-2 text-center">
                <p className="text-xs text-slate-400">
                  Read this out to your partner — they type it in.
                </p>
                <p className="text-4xl font-bold tracking-[0.35em] text-amber-300">{round.code}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-center text-xs text-slate-400">
                  Your partner can see a code. Ask them, then type it here.
                </p>
                <Input
                  id="relay-code"
                  label="Code"
                  value={codeEntry}
                  maxLength={4}
                  autoComplete="off"
                  onChange={(event) => setCodeEntry(event.target.value.toUpperCase())}
                  placeholder="ABCD"
                  disabled={!canAct}
                />
                <Button
                  onClick={() => act(codeEntry)}
                  disabled={!canAct || codeEntry.trim().length === 0}
                  className="w-full"
                >
                  Submit code
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap justify-center gap-3 text-xs text-slate-400">
        {players.map((player) => {
          const slot = state?.players?.[player.id];
          if (!slot) return null;
          return (
            <span
              key={player.id}
              className={cn(
                'rounded-full px-2 py-1 transition',
                slot.acted && 'animate-pulse bg-emerald-500/15 text-emerald-300',
              )}
            >
              {player.nickname}: {slot.acted ? 'ready ✅' : 'waiting…'}
              {slot.disconnected ? ' (offline)' : ''}
            </span>
          );
        })}
      </div>

      {state!.history.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-1" aria-label="Round history">
          {state!.history.map((entry) => (
            <span
              key={entry.index}
              title={`Round ${entry.index + 1}: ${entry.type}`}
              className={cn(
                'h-2.5 w-2.5 rounded-full',
                entry.success ? 'bg-emerald-400' : 'bg-rose-400',
              )}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const coupleSyncClient: ClientGameModule = {
  metadata: COUPLE_SYNC_METADATA,
  Component: CoupleSyncGame as unknown as ComponentType<GameComponentProps<never>>,
};
