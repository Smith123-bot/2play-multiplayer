import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import { TRAFFIC_CONTROL_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';

export interface TrafficPublicState {
  phase: 'idle' | 'playing' | 'finished';
  stepMs: number;
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  zones: Record<
    string,
    {
      axis: 'ns' | 'ew';
      score: number;
      cleared: number;
      jams: number;
      collisions: number;
      disconnected: boolean;
      cars: Array<{ id: string; approach: 'n' | 's' | 'e' | 'w'; progress: number; waiting: boolean }>;
    }
  >;
}

function TrafficControlGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<TrafficPublicState>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previousEvent = useRef<string | null>(null);
  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.zones?.[myPlayerId] : undefined;
  const playing = phase === 'playing' && Boolean(me);

  const flip = useCallback(() => {
    if (!playing) return;
    sendAction({ type: 'switch' } satisfies GameAction);
    play('click');
    vibrate('buttonPress');
  }, [playing, sendAction, play, vibrate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.key !== 'l' && event.key !== 'L') return;
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      event.preventDefault();
      flip();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [flip]);

  useEffect(() => {
    const lastEvent = state?.lastEvent ?? null;
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (lastEvent === 'jam' || lastEvent === 'collision') {
      play('wrong');
      vibrate('error');
    } else if (lastEvent?.startsWith('switch:')) {
      play('click');
    }
  }, [state?.lastEvent, play, vibrate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !me) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssWidth = canvas.clientWidth || 360;
    const cssHeight = cssWidth;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    const road = cssWidth * 0.28;
    const mid = cssWidth / 2;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(mid - road / 2, 0, road, cssHeight);
    ctx.fillRect(0, mid - road / 2, cssWidth, road);
    ctx.fillStyle = me.axis === 'ns' ? '#22c55e' : '#ef4444';
    ctx.fillRect(mid - 10, mid - road / 2 - 18, 20, 12);
    ctx.fillRect(mid - 10, mid + road / 2 + 6, 20, 12);
    ctx.fillStyle = me.axis === 'ew' ? '#22c55e' : '#ef4444';
    ctx.fillRect(mid - road / 2 - 18, mid - 10, 12, 20);
    ctx.fillRect(mid + road / 2 + 6, mid - 10, 12, 20);
    for (const car of me.cars) {
      const t = car.progress / 6;
      let x = mid;
      let y = mid;
      if (car.approach === 'n') y = t * cssHeight;
      if (car.approach === 's') y = cssHeight - t * cssHeight;
      if (car.approach === 'w') x = t * cssWidth;
      if (car.approach === 'e') x = cssWidth - t * cssWidth;
      ctx.fillStyle = car.waiting ? '#fbbf24' : '#38bdf8';
      ctx.fillRect(x - 8, y - 8, 16, 16);
    }
  }, [me]);

  if (phase === 'idle' || !state) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Warming the traffic lights…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({ ...player, score: state.zones?.[player.id]?.score ?? player.score }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Shift clock"
      />
      <div className="flex flex-wrap items-center gap-2">
        {me ? <Badge tone="primary">{me.axis === 'ns' ? 'North–South green' : 'East–West green'}</Badge> : null}
        {me ? <Badge tone="default">Cleared {me.cleared}</Badge> : null}
        {me && me.jams > 0 ? <Badge tone="accent">Jams {me.jams}</Badge> : null}
        {phase === 'finished' ? <Badge tone="accent">Shift over</Badge> : null}
      </div>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Your intersection"
        className="touch-none mx-auto h-auto w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-slate-950 select-none"
        style={{ aspectRatio: '1 / 1' }}
        onTouchMove={(event) => event.preventDefault()}
      />
      <button
        type="button"
        disabled={!playing}
        onClick={flip}
        className="mx-auto flex min-h-12 w-full max-w-xs items-center justify-center rounded-xl border border-emerald-400/40 bg-emerald-400/10 text-sm font-semibold text-emerald-200 transition active:scale-95 disabled:opacity-40"
      >
        Switch lights
      </button>
      <p className="text-center text-xs text-slate-500">
        Space or L flips the lights. Cars, jams and collisions are scored on the server.
      </p>
    </div>
  );
}

export const trafficControlClient: ClientGameModule = {
  metadata: TRAFFIC_CONTROL_METADATA,
  Component: TrafficControlGame as unknown as ComponentType<GameComponentProps<never>>,
};
