import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { SHOP_RUSH_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../utils/cn';

export type ShopItem = 'milk' | 'bread' | 'eggs' | 'apples' | 'cereal' | 'juice' | 'rice' | 'candy';

export interface ShopPublicState {
  phase: 'idle' | 'playing' | 'finished';
  cols: number;
  rows: number;
  shelves: Array<{ x: number; y: number; item: ShopItem }>;
  till: { x: number; y: number };
  startedAt: number | null;
  endsAt: number | null;
  durationMs: number;
  finishReason: string | null;
  lastEvent: string | null;
  serverTime: number;
  eventSeq: number;
  shoppers: Record<
    string,
    {
      x: number;
      y: number;
      inventory: Array<ShopItem | 'hidden'>;
      list: ShopItem[];
      score: number;
      checkouts: number;
      combo: number;
      bestCombo: number;
      correctItems: number;
      wrongItems: number;
      missedOrders: number;
      orderNumber: number;
      orderDeadline: number;
      latestInputSeq: number;
      disconnected: boolean;
      basketSize: number;
    }
  >;
}

const DPAD = [
  { direction: 'up' as const, icon: ArrowUp, label: 'Move up', area: 'col-start-2 row-start-1' },
  {
    direction: 'left' as const,
    icon: ArrowLeft,
    label: 'Move left',
    area: 'col-start-1 row-start-2',
  },
  {
    direction: 'down' as const,
    icon: ArrowDown,
    label: 'Move down',
    area: 'col-start-2 row-start-2',
  },
  {
    direction: 'right' as const,
    icon: ArrowRight,
    label: 'Move right',
    area: 'col-start-3 row-start-2',
  },
];
const SEAT = ['#818cf8', '#34d399', '#f472b6', '#fbbf24'];
const ITEM_EMOJI: Record<ShopItem, string> = {
  milk: '🥛',
  bread: '🍞',
  eggs: '🥚',
  apples: '🍎',
  cereal: '🥣',
  juice: '🧃',
  rice: '🍚',
  candy: '🍬',
};

function ShopRushGame({
  state,
  players,
  myPlayerId,
  sendAction,
  play,
  vibrate,
}: GameComponentProps<ShopPublicState>) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const previousEvent = useRef<string | null>(null);
  const inputSequence = useRef(0);
  const [, setClock] = useState(0);
  const phase = state?.phase ?? 'idle';
  const me = myPlayerId ? state?.shoppers?.[myPlayerId] : undefined;
  const playing = phase === 'playing' && Boolean(me);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setClock((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, [playing]);

  const move = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      if (!playing) return;
      inputSequence.current = Math.max(inputSequence.current, me?.latestInputSeq ?? -1) + 1;
      sendAction({
        type: 'move',
        payload: { direction, sequence: inputSequence.current },
      } satisfies GameAction);
      vibrate('buttonPress');
    },
    [playing, me?.latestInputSeq, sendAction, vibrate],
  );

  const pickup = useCallback(() => {
    if (!playing) return;
    sendAction({ type: 'pickup' } satisfies GameAction);
    play('click');
    vibrate('buttonPress');
  }, [playing, sendAction, play, vibrate]);

  const checkout = useCallback(() => {
    if (!playing) return;
    sendAction({ type: 'checkout' } satisfies GameAction);
    play('click');
    vibrate('buttonPress');
  }, [playing, sendAction, play, vibrate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const map: Record<string, 'up' | 'down' | 'left' | 'right'> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        w: 'up',
        s: 'down',
        a: 'left',
        d: 'right',
        W: 'up',
        S: 'down',
        A: 'left',
        D: 'right',
      };
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) ||
          target.isContentEditable)
      )
        return;
      if (event.key === 'e' || event.key === 'E' || event.key === ' ') {
        event.preventDefault();
        pickup();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        checkout();
        return;
      }
      const direction = map[event.key];
      if (!direction) return;
      event.preventDefault();
      move(direction);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [move, pickup, checkout]);

  useEffect(() => {
    const lastEvent = state?.lastEvent ?? null;
    if (lastEvent === previousEvent.current) return;
    previousEvent.current = lastEvent;
    if (!lastEvent) return;
    if (lastEvent.startsWith('missed:') && lastEvent.includes(myPlayerId ?? '')) {
      play('wrong');
      vibrate('error');
    } else if (lastEvent.startsWith('checkout:') && lastEvent.includes(myPlayerId ?? '')) {
      play('score');
      vibrate('success');
    } else if (lastEvent.startsWith('pickup:') && lastEvent.includes(myPlayerId ?? '')) {
      play('notification');
    }
  }, [state?.lastEvent, myPlayerId, play, vibrate]);

  if (phase === 'idle' || !state) {
    return (
      <div className="space-y-4">
        <GameHUD players={players} myPlayerId={myPlayerId} />
        <div className="card grid place-items-center p-10 text-center">
          <p className="animate-pulse text-sm text-slate-400">Stocking the shelves…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <GameHUD
        players={players.map((player) => ({
          ...player,
          score: state.shoppers?.[player.id]?.score ?? player.score,
        }))}
        myPlayerId={myPlayerId}
        deadline={state.endsAt ?? null}
        label="Shop clock"
      />
      {me ? (
        <div className="card flex items-center justify-between gap-3 p-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400">
              Customer order {me.orderNumber}
            </p>
            <p className="text-sm font-semibold text-white">
              {me.list.length} items · {me.checkouts} served
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Order time</p>
            <p className="font-bold tabular-nums text-amber-300">
              {Math.max(
                0,
                Math.ceil(
                  (me.orderDeadline - (Date.now() + (state.serverTime - Date.now()))) / 1000,
                ),
              )}
              s
            </p>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {me?.list.map((item) => (
          <Badge key={item} tone={me.inventory.includes(item) ? 'success' : 'primary'}>
            {ITEM_EMOJI[item]} {item}
          </Badge>
        ))}
        {me && me.combo > 1 ? <Badge tone="success">Service streak x{me.combo}</Badge> : null}
        {me ? (
          <Badge tone="default">
            Accuracy{' '}
            {Math.round((me.correctItems / Math.max(1, me.correctItems + me.wrongItems)) * 100)}%
          </Badge>
        ) : null}
        {phase === 'finished' ? <Badge tone="accent">Shop closed</Badge> : null}
      </div>
      <div
        role="grid"
        aria-label="Shop floor"
        className="touch-none mx-auto grid w-full max-w-md gap-px overflow-hidden rounded-2xl border border-white/10 bg-black/40 p-1 select-none"
        style={{ gridTemplateColumns: `repeat(${state.cols}, minmax(0, 1fr))` }}
        onTouchStart={(event) => {
          const touch = event.changedTouches[0];
          touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
        }}
        onTouchMove={(event) => event.preventDefault()}
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
        {Array.from({ length: state.cols * state.rows }, (_, index) => {
          const x = index % state.cols;
          const y = Math.floor(index / state.cols);
          const shelf = state.shelves.find((entry) => entry.x === x && entry.y === y);
          const isTill = state.till.x === x && state.till.y === y;
          const occupants = players.filter((player) => {
            const shopper = state.shoppers[player.id];
            return shopper && shopper.x === x && shopper.y === y;
          });
          return (
            <div
              key={index}
              className={cn(
                'relative grid aspect-square place-items-center text-[10px]',
                shelf ? 'bg-amber-900/70' : isTill ? 'bg-emerald-700/70' : 'bg-slate-800/80',
              )}
            >
              {shelf ? <span aria-hidden>{ITEM_EMOJI[shelf.item]}</span> : null}
              {isTill && !shelf ? <span aria-hidden>🛒</span> : null}
              {occupants.map((player, position) => (
                <span
                  key={player.id}
                  className="absolute inset-[18%] rounded-full"
                  style={{
                    backgroundColor: SEAT[players.indexOf(player) % SEAT.length],
                    marginLeft: position * 2,
                    boxShadow: player.id === myPlayerId ? '0 0 0 2px #fff' : undefined,
                  }}
                />
              ))}
            </div>
          );
        })}
      </div>
      <p className="text-center text-xs text-slate-300">
        Basket {me?.inventory.filter((item) => item !== 'hidden').join(', ') || 'empty'}
      </p>
      <div className="mx-auto flex flex-col items-center gap-3">
        <div className="grid w-44 grid-cols-3 grid-rows-2 gap-2">
          {DPAD.map(({ direction, icon: Icon, label, area }) => (
            <button
              key={direction}
              type="button"
              aria-label={label}
              disabled={!playing}
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
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!playing}
            onClick={pickup}
            className="min-h-11 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 text-sm font-semibold text-amber-100 transition active:scale-95 disabled:opacity-40"
          >
            Pick up
          </button>
          <button
            type="button"
            disabled={!playing}
            onClick={checkout}
            className="min-h-11 rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-4 text-sm font-semibold text-emerald-100 transition active:scale-95 disabled:opacity-40"
          >
            Checkout
          </button>
        </div>
      </div>
      <p className="text-center text-xs text-slate-500">
        Orders grow from 2 to 4 items and get faster. Complete accurate carts before the customer
        timer for time and streak bonuses; wrong items reduce server-owned scoring.
      </p>
    </div>
  );
}

export const shopRushClient: ClientGameModule = {
  metadata: SHOP_RUSH_METADATA,
  Component: ShopRushGame as unknown as ComponentType<GameComponentProps<never>>,
};
