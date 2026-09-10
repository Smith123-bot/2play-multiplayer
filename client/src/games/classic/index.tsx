import { useState, type ComponentType } from 'react';
import {
  CONNECT_FOUR_METADATA,
  HANGMAN_METADATA,
  SOS_GAME_METADATA,
  CHESS_METADATA,
  type GameAction,
} from '@2play/shared';
import type { ClientGameModule, GameComponentProps } from '../registry/types';

type State = {
  kind: string;
  board: Array<number | string>;
  currentPlayerId: string | null;
  scores: Record<string, number>;
  guessed: string[];
  word: string;
  attemptsLeft: number;
  maxAttempts: number;
  round: number;
  totalRounds: number;
  winningLine: number[];
  phase: string;
  lastMove?: string;
};
function Classic({ state, myPlayerId, sendAction }: GameComponentProps<State>) {
  const [letter, setLetter] = useState('');
  const [sos, setSos] = useState<'S' | 'O'>('S');
  const s = state;
  if (!s) return <div className="card p-6">Waiting for the match…</div>;
  const mine = s.currentPlayerId === myPlayerId;
  if (s.kind === 'chess')
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Chess</h2>
        <div className="mx-auto grid max-w-md grid-cols-8 gap-0 border-2 border-amber-700">
          {s.board.map((v, i) => (
            <button
              key={i}
              onClick={() => {
                const from = Number((window as any).__chessFrom);
                if (v && (String(v) === String(v).toUpperCase()) === mine) {
                  (window as any).__chessFrom = i;
                } else if (from >= 0) {
                  act({ type: 'move', payload: { from, to: i } });
                  (window as any).__chessFrom = -1;
                }
              }}
              className={`aspect-square text-2xl ${(Math.floor(i / 8) + i) % 2 ? 'bg-amber-700' : 'bg-amber-100'} ${v && (String(v) === String(v).toUpperCase()) === mine ? 'cursor-pointer' : ''}`}
            >
              {v}
            </button>
          ))}
        </div>
        <p className="text-center">
          {mine ? 'Your turn' : 'Opponent turn'} · {s.lastMove ?? 'Select a piece'}
        </p>
      </div>
    );
  const act = (a: GameAction) => {
    if (mine) sendAction(a);
  };
  if (s.kind === 'connect-four')
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Connect Four</h2>
        <div className="mx-auto grid max-w-md grid-cols-7 gap-1 rounded-xl bg-blue-800 p-2">
          {s.board.map((v, i) => (
            <button
              key={i}
              aria-label={`Column ${(i % 7) + 1}`}
              disabled={!mine || v !== 0}
              onClick={() => act({ type: 'drop', payload: { column: i % 7 } })}
              className={`aspect-square rounded-full ${v === 1 ? 'bg-red-500' : v === 2 ? 'bg-yellow-300' : 'bg-slate-900'} ${s.winningLine.includes(i) ? 'ring-4 ring-white' : ''}`}
            />
          ))}
        </div>
        <p className="text-center">{mine ? 'Your turn' : 'Opponent turn'}</p>
      </div>
    );
  if (s.kind === 'sos-game')
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">
          SOS <span className="text-sm">S {sos}</span>
        </h2>
        <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
          {s.board.map((v, i) => (
            <button
              key={i}
              disabled={!mine || v !== ''}
              onClick={() => act({ type: 'place', payload: { index: i, letter: sos } })}
              className="aspect-square rounded bg-slate-800 text-2xl font-bold text-cyan-300"
            >
              {v as string}
            </button>
          ))}
        </div>
        <div className="flex justify-center gap-2">
          <button className="btn" onClick={() => setSos('S')}>
            S
          </button>
          <button className="btn" onClick={() => setSos('O')}>
            O
          </button>
        </div>
      </div>
    );
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">
        Hangman · Round {s.round}/{s.totalRounds}
      </h2>
      <p className="text-center text-4xl tracking-[.35em]">{s.word}</p>
      <p className="text-center">
        Attempts: {s.attemptsLeft}/{s.maxAttempts}
      </p>
      <div className="grid grid-cols-7 gap-1">
        {letters.map((l) => (
          <button
            key={l}
            disabled={!mine || s.guessed.includes(l)}
            onClick={() => act({ type: 'guess', payload: { letter: l } })}
            className="btn"
          >
            {l}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          maxLength={1}
          value={letter}
          onChange={(e) => setLetter(e.target.value.toUpperCase())}
          className="input"
        />
        <button
          className="btn"
          disabled={!mine || !letter}
          onClick={() => {
            act({ type: 'guess', payload: { letter } });
            setLetter('');
          }}
        >
          Guess
        </button>
      </div>
    </div>
  );
}
const make = (metadata: any): ClientGameModule => ({
  metadata,
  Component: Classic as unknown as ComponentType<GameComponentProps<never>>,
});
export const chessClient = make(CHESS_METADATA);
export const connectFourClient = make(CONNECT_FOUR_METADATA);
export const hangmanClient = make(HANGMAN_METADATA);
export const sosGameClient = make(SOS_GAME_METADATA);
