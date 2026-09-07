import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Bomb, Flame } from 'lucide-react';
import { BOMB_PASS_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface BombPlayerPublic {
  strikes: number;
  points: number;
  eliminated: boolean;
  disconnected: boolean;
  left: boolean;
}

export interface BombPassPublicState {
  phase: 'idle' | 'countdown' | 'running' | 'roundResult' | 'finished';
  round: number;
  totalRounds: number;
  fuseMs: number;
  fuseEndsAt: number | null;
  roundEndsAt: number | null;
  passCooldownMs: number;
  strikesToEliminate: number;
  holderId: string | null;
  lastExplosionHolder: string | null;
  passAvailableAt: number | null;
  players: Record<string, BombPlayerPublic | null>;
  startedAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
}

function BombPassGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<BombPassPublicState>) {
  const clockOffset = useRef(0);
  const previousEvent = useRef<string | null>(null);
  const warned = useRef(false);
  const [, forceTick] = useState(0);

  const phase = state?.phase ?? 'idle';
  const iHold = state?.holderId === myPlayerId && phase === 'running';

  useEffect(() => {
    if (state) clockOffset.current = state.serverTime - Date.now();
  }, [state]);

  // Live fuse countdown.
  useEffect(() => {
    if (phase !== 'running') {
      warned.current = false;
      return;
    }
    const id = window.setInterval(() => forceTick((tick) => tick + 1), 100);
    return () => window.clearInterval(id);
  }, [phase]);

  const serverNow = (Date.now() + clockOffset.current);
  const fuseLeft =
    state?.fuseEndsAt !== null && state?.fuseEndsAt !== undefined && phase === 'running'
      ? Math.max(0, state.fuseEndsAt - serverNow)
      : null;
  const fuseRatio = fuseLeft !== null && state ? Math.max(0, Math.min(1, fuseLeft / state.fuseMs)) : 0;
  const canPass =
    iHold && state?.passAvailableAt !== null && state?.passAvailableAt !== undefined
      ? serverNow >= state.passAvailableAt
      : iHold;

  // Event feedback: passes, warnings, booms, the finish.
  const lastEvent = state?.lastEvent ?? null;
  useEffect(() => {
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (!lastEvent) return;
    const [kind, actor] = lastEvent.split(':');
    if (kind === 'pass') {
      play('click');
      vibrate('buttonPress');
    } else if (kind === 'boom') {
      if (actor === myPlayerId) {
        play('defeat');
        vibrate('error');
      } else {
        play('wrong');
        vibrate('success');
      }
    } else if (kind === 'armed') {
      play('notification');
    } else if (kind === 'finished') {
      const mine = state?.players?.[myPlayerId ?? ''];
      const best = mine && !mine.eliminated;
      play(best ? 'victory' : 'defeat');
      vibrate(best ? 'victory' : 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent]);

  // Fuse warning in the final 1.5 s.
  useEffect(() => {
    if (fuseLeft !== null && fuseLeft < 1500 && fuseLeft > 0 && !warned.current) {
      warned.current = true;
      play('notification');
      vibrate('error');
    }
    if (fuseLeft === null) warned.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fuseLeft !== null && fuseLeft < 1500]);

  if (phase === 'idle' || !state) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Lighting the (virtual) fuse…</p>
        </div>
      </div>
    );
  }

  const pass = (targetId: string) => {
    if (!canPass || targetId === myPlayerId) return;
    sendAction({ type: 'pass', payload: { targetId } } satisfies GameAction);
    vibrate('buttonPress');
  };

  const seats = players;
  const n = Math.max(2, seats.length);
  const mine = myPlayerId ? state.players?.[myPlayerId] : undefined;
  const iWon = phase === 'finished' && mine && !mine.eliminated;

  const banner =
    phase === 'countdown'
      ? { tone: 'warning' as const, text: `Round ${state.round} — the firework is handed out…` }
      : phase === 'running'
        ? iHold
          ? { tone: 'danger' as const, text: 'You hold it — pass it, fast!' }
          : { tone: 'primary' as const, text: 'Watch the fuse…' }
        : phase === 'roundResult'
          ? { tone: 'accent' as const, text: 'Boom! Next round in a moment…' }
          : { tone: 'default' as const, text: 'Match over' };

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.players?.[player.id]?.points ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        label={`Round ${state.round}/${state.totalRounds}`}
      />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge tone={banner.tone} icon={<Flame className="h-3 w-3" aria-hidden />}>
          {banner.text}
        </Badge>
        {mine ? (
          <Badge tone={mine.eliminated ? 'danger' : 'success'}>
            {mine.strikes}/{state.strikesToEliminate} strikes · {mine.points} pts
          </Badge>
        ) : null}
        {phase === 'finished' ? (
          <Badge tone={iWon ? 'success' : 'accent'}>{iWon ? 'You survive!' : 'Better luck next time'}</Badge>
        ) : null}
      </div>

      {/* Arena: players in a circle around the fuse */}
      <div className="mx-auto w-full max-w-md">
        <div
          className="relative w-full pt-[100%]"
          role="img"
          aria-label="Firework passing arena"
        >
          {/* centre fuse dial */}
          <div className="absolute inset-0 grid place-items-center">
            <div className="relative grid h-28 w-28 place-items-center">
              <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
                <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
                {phase === 'running' ? (
                  <circle
                    cx="50"
                    cy="50"
                    r="44"
                    fill="none"
                    stroke={fuseRatio < 0.25 ? '#f43f5e' : fuseRatio < 0.5 ? '#f59e0b' : '#34d399'}
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 44}`}
                    strokeDashoffset={`${2 * Math.PI * 44 * (1 - fuseRatio)}`}
                    className="transition-[stroke-dashoffset] duration-100"
                  />
                ) : null}
              </svg>
              <Bomb
                className={cn(
                  'h-10 w-10 transition-transform',
                  phase === 'running' && fuseRatio < 0.25 && 'animate-pulse text-rose-400',
                  phase === 'running' && fuseRatio >= 0.25 && 'text-amber-300',
                  phase !== 'running' && 'text-slate-500',
                )}
                aria-hidden
              />
              {phase === 'running' && fuseLeft !== null ? (
                <span className="absolute -bottom-7 text-sm font-bold tabular-nums text-slate-200">
                  {(fuseLeft / 1000).toFixed(1)}s
                </span>
              ) : phase === 'roundResult' && state.lastExplosionHolder ? (
                <span className="absolute -bottom-7 text-2xl" aria-label="boom">
                  💥
                </span>
              ) : null}
            </div>
          </div>

          {/* players around the circle */}
          {seats.map((player, index) => {
            const angle = (-90 + (index * 360) / n) * (Math.PI / 180);
            const x = 50 + 42 * Math.cos(angle);
            const y = 50 + 42 * Math.sin(angle);
            const view = state.players?.[player.id];
            const holding = state.holderId === player.id;
            const targetable =
              canPass && player.id !== myPlayerId && view && !view.eliminated && !view.disconnected && !view.left;
            return (
              <button
                key={player.id}
                type="button"
                aria-label={`Pass to ${player.nickname}`}
                disabled={!targetable}
                onClick={() => pass(player.id)}
                className={cn(
                  'absolute flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5 rounded-2xl border p-1 text-center transition',
                  holding
                    ? 'border-amber-400 bg-amber-400/20 shadow-[0_0_20px_rgba(245,158,11,0.5)]'
                    : 'border-white/10 bg-white/5',
                  view?.eliminated && 'opacity-35 grayscale',
                  view?.disconnected && !view.eliminated && 'opacity-60',
                  player.id === myPlayerId && !holding && 'border-indigo-400/60',
                  targetable && 'scale-105 border-emerald-400/70 shadow-[0_0_16px_rgba(52,211,153,0.35)]',
                )}
                style={{ left: `${x}%`, top: `${y}%` }}
              >
                <span className="truncate text-[11px] font-semibold text-slate-200">
                  {player.id === myPlayerId ? 'You' : player.nickname}
                </span>
                <span className="text-xs leading-none" aria-label="strikes">
                  {'💥'.repeat(view?.strikes ?? 0)}
                  {'·'.repeat(Math.max(0, state.strikesToEliminate - (view?.strikes ?? 0)))}
                </span>
                <span className="text-[10px] tabular-nums text-slate-400">{view?.points ?? 0} pts</span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-center text-xs text-slate-500">
        {iHold
          ? 'Tap a highlighted player to pass — hold it at the boom and you take a strike.'
          : 'Three strikes put a player out. Survive — last one standing wins.'}
      </p>
    </div>
  );
}

export const bombPassClient: ClientGameModule = {
  metadata: BOMB_PASS_METADATA,
  Component: BombPassGame as unknown as ComponentType<GameComponentProps<never>>,
};
