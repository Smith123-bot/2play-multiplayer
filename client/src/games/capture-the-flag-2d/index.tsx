import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Flag } from 'lucide-react';
import { CAPTURE_THE_FLAG_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export type CTFTeam = 'A' | 'B';

export interface CTFPlayerPublic {
  x: number;
  y: number;
  team: CTFTeam;
  carrying: CTFTeam | null;
  respawnAt: number | null;
  steps: number;
  captures: number;
  tags: number;
  disconnected: boolean;
}

export interface CTFFlagPublic {
  owner: CTFTeam;
  x: number;
  y: number;
  carrier: string | null;
}

export interface CaptureTheFlagPublicState {
  phase: 'idle' | 'playing' | 'finished';
  cols: number;
  rows: number;
  walls: boolean[];
  bases: Record<CTFTeam, { x: number; y: number }>;
  flags: Record<CTFTeam, CTFFlagPublic>;
  scores: Record<CTFTeam, number>;
  capturesToWin: number;
  respawnMs: number;
  startedAt: number | null;
  endsAt: number | null;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  players: Record<string, CTFPlayerPublic | null>;
}

const DPAD: Array<{
  direction: 'up' | 'down' | 'left' | 'right';
  icon: typeof ArrowUp;
  label: string;
  area: string;
}> = [
  { direction: 'up', icon: ArrowUp, label: 'Move up', area: 'col-start-2 row-start-1' },
  { direction: 'left', icon: ArrowLeft, label: 'Move left', area: 'col-start-1 row-start-2' },
  { direction: 'down', icon: ArrowDown, label: 'Move down', area: 'col-start-2 row-start-2' },
  { direction: 'right', icon: ArrowRight, label: 'Move right', area: 'col-start-3 row-start-2' },
];

const TEAM_COLORS: Record<CTFTeam, string> = { A: '#818cf8', B: '#34d399' };

function CaptureTheFlagGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<CaptureTheFlagPublicState>) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousEvent = useRef<string | null>(null);
  const previousRespawn = useRef<number | null>(null);
  const [, forceTick] = useState(0);

  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.players?.[myPlayerId] : undefined;
  const myTeam = me?.team ?? null;
  const canMove = phase === 'playing' && !!me && me.respawnAt === null;

  const move = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      if (!canMove) return;
      sendAction({ type: 'move', payload: { direction } } satisfies GameAction);
      vibrate('buttonPress');
    },
    [canMove, sendAction, vibrate],
  );

  // Keyboard: arrows + WASD (never while typing in chat/inputs).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const map: Record<string, 'up' | 'down' | 'left' | 'right'> = {
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
        w: 'up', s: 'down', a: 'left', d: 'right',
        W: 'up', S: 'down', A: 'left', D: 'right',
      };
      const direction = map[event.key];
      if (!direction) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      move(direction);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [move]);

  // Smooth respawn countdown: re-render twice a second while I am down.
  const respawnAt = me?.respawnAt ?? null;
  useEffect(() => {
    if (respawnAt === null) return;
    const id = window.setInterval(() => forceTick((tick) => tick + 1), 250);
    return () => window.clearInterval(id);
  }, [respawnAt]);

  // Event feedback: pickups, captures, being tagged.
  const lastEvent = state?.lastEvent ?? null;
  useEffect(() => {
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (!lastEvent) return;
    const [kind, actor] = lastEvent.split(':');
    if (kind === 'pickup' && actor === myPlayerId) {
      play('notification');
      vibrate('success');
    } else if (kind === 'capture') {
      const capturer = actor ? state?.players?.[actor] : undefined;
      if (capturer?.team === myTeam) {
        play('victory');
        vibrate('victory');
      } else {
        play('wrong');
        vibrate('error');
      }
    } else if (kind === 'won') {
      const iWon = (state?.scores?.[myTeam ?? 'A'] ?? 0) > (state?.scores?.[myTeam === 'A' ? 'B' : 'A'] ?? 0);
      play(iWon ? 'victory' : 'defeat');
      vibrate(iWon ? 'victory' : 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent]);
  useEffect(() => {
    if (respawnAt !== null && previousRespawn.current === null) {
      play('defeat');
      vibrate('error');
    }
    previousRespawn.current = respawnAt;
  }, [respawnAt, play, vibrate]);

  if (phase === 'idle' || !state) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Building the arena and planting the flags…</p>
        </div>
      </div>
    );
  }

  const { cols, rows, walls, bases, flags, scores, capturesToWin } = state;
  const cellPlayer = new Map<string, Array<{ playerId: string; view: CTFPlayerPublic }>>();
  for (const player of players) {
    const view = state.players?.[player.id];
    if (!view) continue;
    const key = `${view.x},${view.y}`;
    const list = cellPlayer.get(key) ?? [];
    list.push({ playerId: player.id, view });
    cellPlayer.set(key, list);
  }
  const flagCells = new Map<string, CTFTeam>();
  for (const team of ['A', 'B'] as CTFTeam[]) {
    const flag = flags[team];
    if (flag && flag.carrier === null) flagCells.set(`${flag.x},${flag.y}`, team);
  }
  const respawnIn = respawnAt !== null ? Math.max(0, respawnAt - state.serverTime) : null;
  const isDraw = scores.A === scores.B;
  const winningTeam = scores.A >= scores.B ? 'A' : 'B';
  const iWon = phase === 'finished' && !isDraw && myTeam !== null && scores[myTeam] === scores[winningTeam];

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.players?.[player.id]?.captures ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Match time"
      />

      {/* Team scoreboard */}
      <div className="card flex items-center justify-center gap-4 p-3">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: TEAM_COLORS.A }} aria-hidden />
          <span className="text-sm font-semibold text-slate-200">Team A</span>
          <span className="text-2xl font-bold tabular-nums" style={{ color: TEAM_COLORS.A }}>
            {scores.A}
          </span>
        </div>
        <span className="text-xs uppercase tracking-wider text-slate-500">captures · first to {capturesToWin}</span>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold tabular-nums" style={{ color: TEAM_COLORS.B }}>
            {scores.B}
          </span>
          <span className="text-sm font-semibold text-slate-200">Team B</span>
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: TEAM_COLORS.B }} aria-hidden />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {me ? (
          me.carrying !== null ? (
            <Badge tone="warning" icon={<Flag className="h-3 w-3" aria-hidden />}>
              You carry the {me.carrying} flag — run home!
            </Badge>
          ) : respawnAt !== null ? (
            <Badge tone="danger">
              Tagged! Respawning… {respawnIn !== null ? `${(respawnIn / 1000).toFixed(1)}s` : ''}
            </Badge>
          ) : (
            <Badge tone="primary">Team {me.team} · {me.captures} captures · {me.tags} tags</Badge>
          )
        ) : null}
        {phase === 'finished' ? (
          <Badge tone={iWon ? 'success' : 'accent'}>
            {isDraw ? 'Draw — nobody reached the captures' : iWon ? 'Your team wins!' : `Team ${winningTeam} wins`}
          </Badge>
        ) : null}
      </div>

      <div className="mx-auto w-full max-w-md">
        <div
          role="grid"
          aria-label="Capture the Flag arena"
          className="touch-none grid gap-0 overflow-hidden rounded-2xl border border-white/10 bg-black/50 p-1 select-none"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          onTouchStart={(event) => {
            const touch = event.changedTouches[0];
            touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
          }}
          onTouchEnd={(event) => {
            const start = touchStart.current;
            touchStart.current = null;
            const touch = event.changedTouches[0];
            if (!start || !touch) return;
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
            if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
            else move(dy > 0 ? 'down' : 'up');
          }}
        >
          {Array.from({ length: cols * rows }, (_, index) => {
            const x = index % cols;
            const y = Math.floor(index / cols);
            const key = `${x},${y}`;
            const isWall = walls[index] === true;
            const occupants = cellPlayer.get(key);
            const first = occupants?.[0];
            const baseTeam = (['A', 'B'] as CTFTeam[]).find(
              (team) => bases[team].x === x && bases[team].y === y,
            );
            const flagTeam = flagCells.get(key);
            return (
              <div
                key={key}
                className={cn(
                  'relative grid aspect-square place-items-center rounded-[2px]',
                  !isWall && !first && !flagTeam && 'bg-white/[0.03]',
                  isWall && 'bg-slate-700/90 shadow-inner',
                )}
                style={
                  baseTeam
                    ? {
                        backgroundColor: `${TEAM_COLORS[baseTeam]}33`,
                        boxShadow: `inset 0 0 0 1.5px ${TEAM_COLORS[baseTeam]}`,
                      }
                    : undefined
                }
              >
                {flagTeam !== undefined && !first ? (
                  <Flag
                    className="h-3.5 w-3.5 drop-shadow-[0_0_4px_rgba(0,0,0,0.8)]"
                    style={{ color: TEAM_COLORS[flagTeam] }}
                    aria-label={`${flagTeam} flag`}
                  />
                ) : null}
                {first ? (
                  <span
                    className={cn(
                      'grid h-4/5 w-4/5 place-items-center rounded-full text-[8px] font-bold text-white',
                      first.view.disconnected && 'opacity-40',
                    )}
                    style={{
                      backgroundColor: TEAM_COLORS[first.view.team],
                      boxShadow:
                        first.playerId === myPlayerId
                          ? `0 0 0 2px #fff, 0 0 8px ${TEAM_COLORS[first.view.team]}`
                          : `0 0 6px ${TEAM_COLORS[first.view.team]}80`,
                      opacity: first.view.respawnAt !== null ? 0.35 : 1,
                    }}
                    aria-label={`Team ${first.view.team} player${first.view.carrying !== null ? ' carrying a flag' : ''}`}
                  >
                    {first.view.carrying !== null ? <Flag className="h-2.5 w-2.5" aria-hidden /> : null}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* D-pad below the arena — never covering gameplay. */}
      <div className="mx-auto grid w-44 grid-cols-3 grid-rows-2 gap-2">
        {DPAD.map(({ direction, icon: Icon, label, area }) => (
          <button
            key={direction}
            type="button"
            aria-label={label}
            disabled={!canMove}
            onClick={() => move(direction)}
            className={cn(
              'grid h-14 place-items-center rounded-xl border border-white/10 bg-white/5 text-white transition active:scale-95 disabled:opacity-40',
              area,
            )}
          >
            <Icon className="h-6 w-6" aria-hidden />
          </button>
        ))}
      </div>
      <p className="text-center text-xs text-slate-500">
        WASD / arrows / swipe / D-pad — grab their flag, run it to your base, dodge tags. First to {capturesToWin} captures wins.
      </p>
    </div>
  );
}

export const captureTheFlagClient: ClientGameModule = {
  metadata: CAPTURE_THE_FLAG_METADATA,
  Component: CaptureTheFlagGame as unknown as ComponentType<GameComponentProps<never>>,
};
