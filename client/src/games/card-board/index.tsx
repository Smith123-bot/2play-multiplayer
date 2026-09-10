import { useState, type ComponentType } from 'react';
import { DOMINOES_METADATA, SIM_METADATA, UNO_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';

type State = any;
function CardBoard({ state, myPlayerId, sendAction, play, vibrate }: GameComponentProps<State>) {
  const [color, setColor] = useState('red');
  const [selected, setSelected] = useState<string | null>(null);
  if (!state) return <div className="card p-6">Waiting for the match…</div>;
  const viewerId = myPlayerId ?? '';
  const mine = state.currentPlayerId === viewerId;
  const act = (action: GameAction) => {
    if (mine || action.type === 'call-uno') {
      sendAction(action);
      play('click');
      vibrate('buttonPress');
    }
  };
  if (state.kind === 'sim') {
    const points = [
      [15, 10],
      [50, 10],
      [85, 10],
      [15, 85],
      [50, 85],
      [85, 85],
    ];
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Sim</h2>
        <div className="relative mx-auto aspect-square max-w-lg rounded-2xl bg-slate-900 p-3">
          <svg viewBox="0 0 100 100" className="h-full w-full" aria-label="Sim graph board">
            {Object.entries(state.edges).map(([edge, owner]: [string, any]) => {
              const [a, b] = edge.split('-').map(Number);
              const p = points[a]!,
                q = points[b]!;
              return (
                <line
                  key={edge}
                  x1={p[0]}
                  y1={p[1]}
                  x2={q[0]}
                  y2={q[1]}
                  stroke={owner === 'red' ? '#f87171' : owner === 'blue' ? '#60a5fa' : '#475569'}
                  strokeWidth={owner ? 2.6 : 1}
                  className={!owner && mine ? 'cursor-pointer hover:stroke-white' : ''}
                  onClick={() => !owner && act({ type: 'edge', payload: { edge } })}
                />
              );
            })}
            {points.map(([x, y], i) => (
              <circle
                key={i}
                cx={x}
                cy={y}
                r="5"
                fill="#e2e8f0"
                className={mine ? 'cursor-pointer' : ''}
              />
            ))}
          </svg>
        </div>
        <p className="text-center">
          {mine ? `Your turn — ${state.currentColor}` : 'Opponent turn'} · {state.moves} edges
        </p>
      </div>
    );
  }
  if (state.kind === 'uno')
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">UNO</h2>
          <span className="rounded-full bg-slate-800 px-3 py-1 text-sm">
            {state.currentColor} · {mine ? 'Your turn' : 'Waiting'}
          </span>
        </div>
        <div className="flex justify-center gap-3">
          <div className="rounded-xl border-2 border-slate-600 bg-slate-800 p-5 text-center">
            <div className="text-2xl font-black">{String(state.discard?.at(-1)?.value ?? '?')}</div>
            <div className="text-xs">{state.currentColor}</div>
          </div>
          <button className="btn" disabled={!mine} onClick={() => act({ type: 'draw' })}>
            Draw
          </button>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {(state.hands?.[viewerId] ?? []).map((card: any) => (
            <button
              key={card.id}
              disabled={!mine}
              onClick={() => {
                setSelected(card.id);
                act({
                  type: 'play',
                  payload: { cardId: card.id, color: card.color === 'wild' ? color : undefined },
                });
              }}
              className={`min-w-16 rounded-xl border-2 p-3 text-center shadow ${card.color === 'red' ? 'border-red-400 bg-red-600' : card.color === 'yellow' ? 'border-yellow-300 bg-yellow-500 text-slate-900' : card.color === 'green' ? 'border-green-400 bg-green-600' : 'border-blue-400 bg-blue-600'} ${selected === card.id ? 'ring-4 ring-white' : ''}`}
            >
              {String(card.value)}
            </button>
          ))}
        </div>
        <div className="flex justify-center gap-2">
          <span className="text-sm">Wild color:</span>
          {['red', 'yellow', 'green', 'blue'].map((c) => (
            <button key={c} className="btn px-2" onClick={() => setColor(c)}>
              {c[0]?.toUpperCase()}
            </button>
          ))}
        </div>
        {state.unoPending === myPlayerId && (
          <button className="btn mx-auto block" onClick={() => act({ type: 'call-uno' })}>
            Call UNO!
          </button>
        )}
        <div className="grid grid-cols-2 gap-2 text-sm">
          {Object.entries(state.handCounts ?? {}).map(([id, count]: any) => (
            <div key={id} className="rounded bg-slate-800 p-2">
              {id === viewerId ? 'You' : id}: {count} cards
            </div>
          ))}
        </div>
      </div>
    );
  const hand = state.hands?.[viewerId] ?? [];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Dominoes</h2>
        <span>
          {mine ? 'Your turn' : 'Opponent turn'} · Boneyard {state.boneyard?.length ?? 0}
        </span>
      </div>
      <div className="flex min-h-24 flex-wrap items-center justify-center gap-2 rounded-xl bg-emerald-950 p-3">
        {(state.chain ?? []).map((tile: any) => (
          <div
            key={tile.id}
            className="rounded border border-white/30 bg-white px-3 py-2 text-slate-900"
          >
            {tile.a} | {tile.b}
          </div>
        ))}
        {!state.chain?.length && (
          <span className="text-sm text-slate-400">Choose any tile to open the chain.</span>
        )}
      </div>
      <div className="flex justify-center gap-2">
        <button
          className="btn"
          disabled={!selected || !mine}
          onClick={() => {
            act({ type: 'play', payload: { tileId: selected, side: 'left' } });
            setSelected(null);
          }}
        >
          Place left
        </button>
        <button
          className="btn"
          disabled={!selected || !mine}
          onClick={() => {
            act({ type: 'play', payload: { tileId: selected, side: 'right' } });
            setSelected(null);
          }}
        >
          Place right
        </button>
        <button className="btn" disabled={!mine} onClick={() => act({ type: 'draw' })}>
          Draw until playable
        </button>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {hand.map((tile: any) => (
          <button
            key={tile.id}
            onClick={() => setSelected(tile.id)}
            disabled={!mine}
            className={`rounded-lg border-2 bg-white px-3 py-2 text-slate-900 ${selected === tile.id ? 'border-cyan-300 ring-2 ring-cyan-300' : 'border-slate-400'}`}
          >
            {tile.a} | {tile.b}
          </button>
        ))}
      </div>
    </div>
  );
}
const make = (metadata: any): ClientGameModule => ({
  metadata,
  Component: CardBoard as unknown as ComponentType<GameComponentProps<never>>,
});
export const unoClient = make(UNO_METADATA);
export const simClient = make(SIM_METADATA);
export const dominoesClient = make(DOMINOES_METADATA);
