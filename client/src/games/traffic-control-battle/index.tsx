import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { TRAFFIC_CONTROL_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { HowToPlayModal, useHowToPlay } from '../../components/game/HowToPlayModal';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

type Approach = 'n' | 'e' | 's' | 'w';
type Lane = 'straight' | 'turn';
type SignalState = 'red' | 'green' | 'amber';
type Phase = 'ns' | 'ew';

interface QueueView {
  approach: Approach;
  lane: Lane;
  count: number;
  emergency: boolean;
  longestWait: number;
}

export interface TrafficPublicState {
  phase: 'idle' | 'playing' | 'finished';
  tick: number;
  endsAt: number | null;
  durationMs: number;
  lastEvent: string | null;
  finishReason: string | null;
  serverTime: number;
  minGreenTicks: number;
  junction: {
    phase: Phase;
    sincePhase: number;
    canSwitch: boolean;
    signals: Array<{ approach: Approach; state: SignalState }>;
    queues: QueueView[];
    inBox: Array<{ id: string; approach: Approach; lane: Lane; emergency: boolean }>;
    totalQueued: number;
    cleared: number;
    collisions: number;
    jams: number;
    emergenciesCleared: number;
    emergenciesLost: number;
    score: number;
  } | null;
  players: Record<
    string,
    { score: number; cleared: number; collisions: number; queued: number; disconnected: boolean }
  >;
}

const SIGNAL_COLOR: Record<SignalState, string> = {
  red: 'bg-rose-500',
  amber: 'bg-amber-400',
  green: 'bg-emerald-500',
};

/** Where each approach sits around the junction, and which way cars face. */
const LAYOUT: Record<Approach, { label: string; area: string; arrow: string }> = {
  n: { label: 'North', area: 'col-start-2 row-start-1', arrow: '↓' },
  w: { label: 'West', area: 'col-start-1 row-start-2', arrow: '→' },
  e: { label: 'East', area: 'col-start-3 row-start-2', arrow: '←' },
  s: { label: 'South', area: 'col-start-2 row-start-3', arrow: '↑' },
};

function ApproachPanel({ approach, signal, queues }: { approach: Approach; signal: SignalState; queues: QueueView[] }) {
  const layout = LAYOUT[approach];
  const straight = queues.find((entry) => entry.approach === approach && entry.lane === 'straight');
  const turn = queues.find((entry) => entry.approach === approach && entry.lane === 'turn');
  const hasEmergency = Boolean(straight?.emergency || turn?.emergency);

  return (
    <div
      className={cn(
        'rounded-xl border p-2 text-center transition',
        layout.area,
        hasEmergency ? 'border-rose-400/70 bg-rose-500/10' : 'border-white/10 bg-white/5',
      )}
    >
      <div className="flex items-center justify-center gap-1.5">
        <span
          className={cn('h-3 w-3 rounded-full', SIGNAL_COLOR[signal])}
          aria-label={`${layout.label} signal is ${signal}`}
        />
        <span className="text-[10px] uppercase tracking-wide text-slate-400">{layout.label}</span>
        {hasEmergency ? <AlertTriangle className="h-3 w-3 text-rose-300" aria-label="Emergency waiting" /> : null}
      </div>

      {/* Two lanes, each showing its queued cars. */}
      {(['straight', 'turn'] as Lane[]).map((lane) => {
        const entry = lane === 'straight' ? straight : turn;
        const count = entry?.count ?? 0;
        return (
          <div key={lane} className="mt-1 flex items-center justify-center gap-0.5" aria-label={`${lane} lane: ${count} cars`}>
            <span className="w-8 text-[9px] text-slate-500">{lane === 'straight' ? '↑' : '↰'}</span>
            {Array.from({ length: Math.min(count, 6) }, (_unused, index) => (
              <span
                key={index}
                className={cn(
                  'h-3 w-2 rounded-sm',
                  entry?.emergency && index === 0 ? 'bg-rose-400' : 'bg-sky-400/80',
                )}
              />
            ))}
            {count > 6 ? <span className="text-[9px] text-slate-400">+{count - 6}</span> : null}
            {count === 0 ? <span className="text-[9px] text-slate-600">clear</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function TrafficControlGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<TrafficPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const rules = useHowToPlay(TRAFFIC_CONTROL_METADATA.id);

  const live = state?.phase === 'playing';
  const junction = state?.junction ?? null;
  const canSwitch = live && Boolean(junction?.canSwitch);

  const setPhase = useCallback(
    (phase: Phase) => {
      if (!live) return;
      if (!canSwitch || junction?.phase === phase) {
        play('wrong');
        vibrate('error');
        return;
      }
      sendAction({ type: 'phase', payload: { phase } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [live, canSwitch, junction?.phase, sendAction, play, vibrate],
  );

  // Space toggles the phase on desktop.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)) {
        return;
      }
      if (event.key === ' ' && junction) {
        event.preventDefault();
        setPhase(junction.phase === 'ns' ? 'ew' : 'ns');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setPhase, junction]);

  useEffect(() => {
    const event = state?.lastEvent ?? null;
    if (event === previousEvent.current) return;
    previousEvent.current = event;
    if (!event) return;
    const mine = myPlayerId ? event.endsWith(`:${myPlayerId}`) : false;
    if (event.startsWith('collision:')) {
      if (mine) {
        play('wrong');
        vibrate('error');
      }
    } else if (event.startsWith('emergency-lost:')) {
      if (mine) play('wrong');
    } else if (event.startsWith('phase:')) {
      if (mine) play('click');
    } else if (event === 'start') {
      play('gameStart');
    } else if (event === 'timeout' || event === 'finished') {
      play('gameOver');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (!state || state.phase === 'idle' || !junction) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Opening the junction…</p>
        </div>
      </div>
    );
  }

  const signalOf = (approach: Approach): SignalState =>
    junction.signals.find((entry) => entry.approach === approach)?.state ?? 'red';

  return (
    <div className="space-y-4">
      <HowToPlayModal game={TRAFFIC_CONTROL_METADATA} open={rules.open} onClose={rules.close} />

      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.players?.[player.id]?.score ?? 0,
        }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Shift clock"
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge tone="success">Cleared {junction.cleared}</Badge>
        <Badge tone={junction.totalQueued >= 12 ? 'danger' : 'default'}>Queued {junction.totalQueued}</Badge>
        {junction.collisions > 0 ? <Badge tone="danger">{junction.collisions} collisions</Badge> : null}
        {junction.emergenciesCleared > 0 ? (
          <Badge tone="warning">{junction.emergenciesCleared} emergencies</Badge>
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

      {/* The junction */}
      <div className="mx-auto grid w-full max-w-[min(94vw,28rem)] grid-cols-3 grid-rows-3 gap-2">
        {(['n', 'w', 'e', 's'] as Approach[]).map((approach) => (
          <ApproachPanel
            key={approach}
            approach={approach}
            signal={signalOf(approach)}
            queues={junction.queues}
          />
        ))}

        {/* The junction box in the centre */}
        <div className="col-start-2 row-start-2 grid place-items-center rounded-xl border border-white/15 bg-slate-900/80 p-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">In junction</p>
          <div className="mt-1 flex flex-wrap justify-center gap-1">
            {junction.inBox.length === 0 ? (
              <span className="text-[10px] text-slate-600">empty</span>
            ) : (
              junction.inBox.map((car) => (
                <motion.span
                  key={car.id}
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className={cn('h-3 w-2.5 rounded-sm', car.emergency ? 'bg-rose-400' : 'bg-emerald-400')}
                />
              ))
            )}
          </div>
          <p className="mt-1 text-[10px] font-semibold text-slate-300">
            {junction.phase === 'ns' ? 'N–S green' : 'E–W green'}
          </p>
        </div>
      </div>

      {/* Phase controls */}
      <div className="flex justify-center gap-3">
        {(['ns', 'ew'] as Phase[]).map((option) => {
          const active = junction.phase === option;
          return (
            <button
              key={option}
              type="button"
              disabled={!live || active || !canSwitch}
              onClick={() => setPhase(option)}
              aria-pressed={active}
              aria-label={option === 'ns' ? 'Give north-south a green' : 'Give east-west a green'}
              className={cn(
                'min-w-36 rounded-xl border-2 px-4 py-3 text-sm font-semibold transition active:scale-95 disabled:opacity-40',
                active
                  ? 'border-emerald-400 bg-emerald-500/25 text-emerald-100'
                  : 'border-white/15 bg-white/5 text-slate-200',
              )}
            >
              {option === 'ns' ? 'North ↕ South' : 'East ↔ West'}
            </button>
          );
        })}
      </div>

      {!canSwitch && live ? (
        <p className="text-center text-xs text-amber-300">
          Minimum green running — you cannot switch again just yet.
        </p>
      ) : null}

      <div className="flex flex-wrap justify-center gap-3 text-xs text-slate-400">
        {players.map((player) => {
          const slot = state.players?.[player.id];
          if (!slot) return null;
          return (
            <span key={player.id}>
              {player.nickname}: {slot.score} pts · {slot.cleared} cleared
              {slot.collisions > 0 ? ` · ${slot.collisions} crashes` : ''}
              {slot.disconnected ? ' (offline)' : ''}
            </span>
          );
        })}
      </div>

      <p className="text-center text-xs text-slate-500">
        Red-flagged lanes hold an emergency vehicle — clear them fast. Never let both axes into the junction at once.
      </p>
    </div>
  );
}

export const trafficControlClient: ClientGameModule = {
  metadata: TRAFFIC_CONTROL_METADATA,
  Component: TrafficControlGame as unknown as ComponentType<GameComponentProps<never>>,
};
