import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { ONE_BUTTON_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export type ButtonContext = 'jump' | 'dash' | 'dodge' | 'switch' | 'collect' | 'shield';

export interface OneButtonPublicState {
  phase: 'idle' | 'playing' | 'finished';
  elapsed: number;
  currentIndex: number;
  totalEvents: number;
  current: {
    id: number;
    context: ButtonContext;
    appearAt: number;
    windowStart: number;
    windowEnd: number;
    myResult: 'hit' | 'miss' | 'pending';
  } | null;
  endsAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  players: Record<
    string,
    {
      score: number;
      streak: number;
      hits: number;
      misses: number;
      lastResult: 'hit' | 'miss' | 'idle';
      disconnected: boolean;
    }
  >;
}

const CONTEXT_COPY: Record<ButtonContext, { title: string; hint: string }> = {
  jump: { title: 'JUMP', hint: 'Press as the ledge arrives.' },
  dash: { title: 'DASH', hint: 'Burst through the gap.' },
  dodge: { title: 'DODGE', hint: 'Sidestep the hazard.' },
  switch: { title: 'SWITCH', hint: 'Flip the track.' },
  collect: { title: 'COLLECT', hint: 'Grab the pickup.' },
  shield: { title: 'SHIELD', hint: 'Raise the guard.' },
};

function OneButtonGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<OneButtonPublicState>) {
  const previousEvent = useRef<string | null>(null);
  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.players?.[myPlayerId] : undefined;
  const cue = state?.current ?? null;
  const inWindow =
    Boolean(cue) && state != null && state.elapsed >= cue!.windowStart && state.elapsed <= cue!.windowEnd;
  const canTap = phase === 'playing' && Boolean(me) && !me?.disconnected && cue?.myResult === 'pending';

  const tap = useCallback(() => {
    if (!canTap) return;
    sendAction({ type: 'tap' } satisfies GameAction);
    play('click');
    vibrate('buttonPress');
  }, [canTap, sendAction, play, vibrate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)) {
        return;
      }
      if (event.key !== ' ' && event.code !== 'Space') return;
      event.preventDefault();
      tap();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tap]);

  useEffect(() => {
    const lastEvent = state?.lastEvent ?? null;
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (!lastEvent) return;
    if (lastEvent.startsWith('hit:') && lastEvent.includes(myPlayerId ?? '')) {
      play('correct');
      vibrate('success');
    } else if (lastEvent.startsWith('miss:') && lastEvent.includes(myPlayerId ?? '')) {
      play('wrong');
      vibrate('error');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Arming the one button…</p>
        </div>
      </div>
    );
  }

  const copy = cue ? CONTEXT_COPY[cue.context] : null;
  const windowProgress =
    cue && cue.windowEnd > cue.windowStart
      ? Math.min(1, Math.max(0, (state.elapsed - cue.windowStart) / (cue.windowEnd - cue.windowStart)))
      : 0;

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({ ...player, score: state.players?.[player.id]?.score ?? player.score }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Sequence clock"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">
          Cue {Math.min(state.currentIndex + 1, state.totalEvents)}/{state.totalEvents}
        </Badge>
        <Badge tone="accent">Streak {me?.streak ?? 0}</Badge>
        {me?.lastResult === 'hit' ? <Badge tone="success">Hit</Badge> : null}
        {me?.lastResult === 'miss' ? <Badge tone="danger">Miss</Badge> : null}
      </div>
      <div className="card space-y-3 p-5 text-center">
        <p className="text-xs uppercase tracking-wider text-slate-400">{copy ? copy.hint : 'Wait for the next cue'}</p>
        <p className="text-4xl font-black text-white">{copy?.title ?? '…'}</p>
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className={cn('h-full rounded-full', inWindow ? 'bg-emerald-400' : 'bg-amber-400/70')}
            style={{ width: `${Math.round((inWindow ? windowProgress : Math.min(1, (state.elapsed - (cue?.appearAt ?? 0)) / Math.max(1, (cue?.windowStart ?? 1) - (cue?.appearAt ?? 0)))) * 100)}%` }}
          />
        </div>
        <p className="text-xs text-slate-500">{inWindow ? 'NOW' : 'Wait for the window'}</p>
      </div>
      <button
        type="button"
        aria-label="Action"
        disabled={!canTap}
        onClick={tap}
        className={cn(
          'mx-auto flex min-h-[112px] w-full max-w-sm items-center justify-center rounded-3xl border-4 text-2xl font-black uppercase tracking-wide transition active:scale-95 disabled:opacity-40',
          inWindow ? 'border-emerald-300 bg-emerald-500/30 text-white' : 'border-white/15 bg-white/5 text-slate-200',
        )}
      >
        Tap / Space
      </button>
      <p className="text-center text-xs text-slate-500">
        One button. The server owns the window, the context and the score.
      </p>
    </div>
  );
}

export const oneButtonClient: ClientGameModule = {
  metadata: ONE_BUTTON_METADATA,
  Component: OneButtonGame as unknown as ComponentType<GameComponentProps<never>>,
};
