import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { FAKE_DOOR_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export interface DoorFaceView {
  id: string;
  color: string;
  symbol: string;
  number: number;
  position: number;
}

export interface FakeDoorPublicState {
  phase: 'idle' | 'round' | 'reveal' | 'finished';
  round: number;
  totalRounds: number;
  clue: string;
  clueKind: string;
  doors: DoorFaceView[];
  correctDoorId: string | null;
  endsAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  players: Record<
    string,
    { score: number; correct: number; wrongs: number; picked: string | null; frozen: boolean; disconnected: boolean }
  >;
  myPick: string | null;
}

const COLOR: Record<string, string> = {
  crimson: '#ef4444',
  azure: '#38bdf8',
  lime: '#84cc16',
  gold: '#fbbf24',
};
const SYMBOL: Record<string, string> = {
  star: '★',
  moon: '☾',
  sun: '☀',
  leaf: '☘',
};

function FakeDoorGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<FakeDoorPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.players?.[myPlayerId] : undefined;
  const picking = phase === 'round' && Boolean(me) && !me?.picked && !me?.frozen;

  const pick = useCallback(
    (doorId: string) => {
      if (!picking) return;
      sendAction({ type: 'pick', payload: { doorId } } satisfies GameAction);
      play('click');
      vibrate('buttonPress');
    },
    [picking, sendAction, play, vibrate],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)) {
        return;
      }
      const index = ['1', '2', '3', '4'].indexOf(event.key);
      if (index < 0) return;
      event.preventDefault();
      const door = state?.doors?.[index];
      if (door) pick(door.id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pick, state?.doors]);

  useEffect(() => {
    const lastEvent = state?.lastEvent ?? null;
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (!lastEvent) return;
    if (lastEvent.startsWith('correct:') && lastEvent.includes(myPlayerId ?? '')) {
      play('correct');
      vibrate('success');
    } else if (lastEvent.startsWith('wrong:') && lastEvent.includes(myPlayerId ?? '')) {
      play('wrong');
      vibrate('error');
    } else if (lastEvent === 'clue' || lastEvent === 'reveal') {
      play('notification');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state?.doors?.length) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Hanging the four doors…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({ ...player, score: state.players?.[player.id]?.score ?? player.score }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Clue timer"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">
          Round {state.round + 1}/{state.totalRounds}
        </Badge>
        <Badge tone="accent">{state.clueKind}</Badge>
        {me?.frozen ? <Badge tone="danger">Fake door — wait</Badge> : null}
        {phase === 'reveal' ? <Badge tone="success">Reveal</Badge> : null}
      </div>
      <div className="card p-4 text-center">
        <p className="text-xs uppercase tracking-wider text-slate-400">Clue</p>
        <p className="mt-1 text-lg font-semibold text-white">{state.clue}</p>
        <p className="mt-2 text-xs text-slate-500">The server owns the safe door. You only send a pick.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {state.doors.map((door, index) => {
          const mine = state.myPick === door.id;
          const revealed = phase === 'reveal' || phase === 'finished';
          const correct = revealed && state.correctDoorId === door.id;
          const wrong = revealed && mine && !correct;
          return (
            <button
              key={door.id}
              type="button"
              aria-label={`Door ${index + 1}, ${door.color} ${door.symbol}, number ${door.number}`}
              disabled={!picking}
              onClick={() => pick(door.id)}
              className={cn(
                'flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-2xl border-2 px-3 py-4 transition active:scale-95 disabled:opacity-70',
                mine && !revealed && 'border-primary-400/70 bg-primary-500/15',
                correct && 'border-success bg-success/20',
                wrong && 'border-danger bg-danger/20',
                !mine && !correct && 'border-white/10 bg-white/5',
              )}
            >
              <span className="text-[10px] uppercase tracking-wide text-slate-400">Key {index + 1}</span>
              <span
                className="grid h-14 w-10 place-items-center rounded-t-lg border-2 text-xl"
                style={{ borderColor: COLOR[door.color] ?? '#fff', color: COLOR[door.color] ?? '#fff' }}
              >
                {SYMBOL[door.symbol] ?? door.symbol}
              </span>
              <span className="text-sm font-semibold capitalize text-white">{door.color}</span>
              <span className="text-xs text-slate-400">#{door.number}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const fakeDoorClient: ClientGameModule = {
  metadata: FAKE_DOOR_METADATA,
  Component: FakeDoorGame as unknown as ComponentType<GameComponentProps<never>>,
};
