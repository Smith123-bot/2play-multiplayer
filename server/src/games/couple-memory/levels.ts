/**
 * Couple Memory — 10 cooperative levels.
 *
 * Boards grow, the clock tightens, mistake caps appear and later levels add
 * bonus pairs worth extra points. `cols * rows` must always be even so the
 * deck divides into pairs.
 */

export interface MemoryLevel {
  id: number;
  name: string;
  hint: string;
  cols: number;
  rows: number;
  /** Seconds allowed for this board. */
  timeLimit: number;
  /** 0 = unlimited mistakes. */
  maxMistakes: number;
  /** Pairs worth extra points. */
  bonusPairs: number;
}

export const MEMORY_LEVELS: MemoryLevel[] = [
  { id: 1, name: 'Getting Started', hint: 'One of you flips a card, the other flips its match.', cols: 4, rows: 2, timeLimit: 90, maxMistakes: 0, bonusPairs: 0 },
  { id: 2, name: 'Small Board', hint: 'Say what you see out loud — it is the fastest way through.', cols: 4, rows: 3, timeLimit: 90, maxMistakes: 0, bonusPairs: 0 },
  { id: 3, name: 'More Cards', hint: 'Twelve cards. Build a shared map of the board.', cols: 4, rows: 4, timeLimit: 110, maxMistakes: 0, bonusPairs: 0 },
  { id: 4, name: 'Wider Grid', hint: 'Call out positions by row and column.', cols: 5, rows: 4, timeLimit: 120, maxMistakes: 0, bonusPairs: 0 },
  { id: 5, name: 'Against the Clock', hint: 'Less time. Keep the combo alive for bigger points.', cols: 5, rows: 4, timeLimit: 85, maxMistakes: 0, bonusPairs: 1 },
  { id: 6, name: 'Tick Tock', hint: 'A bigger board on a tight clock.', cols: 6, rows: 4, timeLimit: 100, maxMistakes: 0, bonusPairs: 1 },
  { id: 7, name: 'Careful Now', hint: 'Only ten misses allowed. Think before you flip.', cols: 6, rows: 4, timeLimit: 120, maxMistakes: 10, bonusPairs: 1 },
  { id: 8, name: 'Steady Hands', hint: 'Eight misses. Confirm with your partner first.', cols: 6, rows: 5, timeLimit: 130, maxMistakes: 8, bonusPairs: 2 },
  { id: 9, name: 'Golden Pairs', hint: 'Bonus pairs are worth far more — hunt them together.', cols: 6, rows: 5, timeLimit: 130, maxMistakes: 10, bonusPairs: 3 },
  { id: 10, name: 'Final Challenge', hint: 'The full board, a hard clock and a mistake cap.', cols: 6, rows: 6, timeLimit: 160, maxMistakes: 12, bonusPairs: 3 },
];

export const MEMORY_TOTAL_LEVELS = MEMORY_LEVELS.length;
