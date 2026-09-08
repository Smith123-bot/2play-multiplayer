import { useEffect, useState, type ComponentType } from 'react';
import { LUDO_METADATA, type GameAction } from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';
import { GameHUD } from '../../components/game/GameHUD';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { cn } from '../../utils/cn';

interface State { phase: 'idle'|'playing'|'finished'; currentPlayerId: string|null; dice: number|null; canRoll: boolean; turnEndsAt: number|null; winnerId: string|null; lastEvent: string|null; players: Record<string, { color: string; tokens: { progress: number }[]; score: number; finished: boolean }>; }
const colors: Record<string,string> = { red: 'bg-rose-500', blue: 'bg-sky-500', green: 'bg-emerald-500', yellow: 'bg-amber-400' };
function Ludo({ state, players, myPlayerId, sendAction, play, vibrate }: GameComponentProps<State>) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(timer); }, []);
  const me = myPlayerId ? state.players[myPlayerId] : undefined;
  const roll = () => { sendAction({ type: 'roll-dice' } satisfies GameAction); play('click'); vibrate('buttonPress'); };
  return <div className="space-y-4"><GameHUD players={players.map((p) => ({ ...p, score: state.players[p.id]?.score ?? p.score }))} myPlayerId={myPlayerId} deadline={state.turnEndsAt} label="Turn timer" />
    <div className="flex flex-wrap gap-2"><Badge tone="primary">{state.currentPlayerId === myPlayerId ? 'Your turn' : 'Waiting for turn'}</Badge><Badge tone="accent">Dice: {state.dice ?? '—'}</Badge>{state.winnerId && <Badge tone="success">Winner decided</Badge>}</div>
    <div aria-label="Ludo board" className="mx-auto grid aspect-square w-full max-w-lg grid-cols-7 gap-1 rounded-2xl border border-white/10 bg-slate-950/80 p-2">{Array.from({ length: 49 }, (_, cell) => { const occupants = Object.entries(state.players).flatMap(([id, p]) => p.tokens.map((token, tokenIndex) => ({ id, token, tokenIndex, p }))).filter(({ token }) => token.progress >= 0 && token.progress < 52 && token.progress % 49 === cell); return <div key={cell} className={cn('relative rounded-md border border-white/5 bg-white/[.04]', cell % 7 === 3 || Math.floor(cell / 7) === 3 ? 'bg-white/[.12]' : '')}>{occupants.map(({ id, tokenIndex, p }) => <span key={`${id}-${tokenIndex}`} title={`${p.color} token`} className={cn('absolute left-1/4 top-1/4 h-1/2 w-1/2 rounded-full border-2 border-white/70', colors[p.color] ?? 'bg-white', id === myPlayerId && 'ring-2 ring-white')} />)}</div>; })}</div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{me?.tokens.map((token, index) => <Button key={index} variant={token.progress >= 0 ? 'secondary' : 'outline'} disabled={state.currentPlayerId !== myPlayerId || state.dice === null || state.phase !== 'playing'} onClick={() => { sendAction({ type: 'move-token', payload: { tokenIndex: index } }); play('score'); vibrate('success'); }}>{`Token ${index + 1}`}<span className="ml-1 text-xs opacity-70">{token.progress < 0 ? 'yard' : token.progress >= 56 ? 'home' : token.progress}</span></Button>)}</div>
    <Button className="mx-auto block min-w-32" disabled={!state.canRoll || state.currentPlayerId !== myPlayerId || state.phase !== 'playing'} onClick={roll}>Roll {state.dice ?? ''}</Button><p className="text-center text-xs text-slate-500">{state.turnEndsAt ? `${Math.max(0, Math.ceil((state.turnEndsAt - now) / 1000))}s remaining` : 'Bring all four tokens home.'}</p>
  </div>;
}
export const ludoClient: ClientGameModule = { metadata: LUDO_METADATA, Component: Ludo as unknown as ComponentType<GameComponentProps<never>> };
