import type { AIDifficulty } from '../types/player';
import type { GameMetadata } from '../types/game';

/**
 * Canonical game metadata, shared by the client and the server.
 *
 * Keeping this in `shared` guarantees the browser, the REST catalogue, the
 * lobby rules panel and the server registry can never drift apart.
 */

export const REACTION_RACE_METADATA = {
  id: 'reaction-race',
  name: 'Reaction Race',
  description:
    'Wait for the signal, then tap first. Tap too early and you false start. Best of five rounds wins.',
  category: 'reflex' as const,
  icon: '⚡',
  thumbnail: '⚡',
  minPlayers: 2,
  maxPlayers: 4,
  supportedPlayerCounts: [2, 3, 4],
  hasAI: true,
  aiDifficulties: ['easy', 'medium', 'hard'] as AIDifficulty[],
  estimatedDuration: 90,
  difficulty: 'easy' as const,
  controls: 'Tap / click / press Space as fast as you can after the GO signal.',
  rules: [
    'Each round the server waits a random 1.5–5 seconds before showing GO.',
    'Tapping before GO is a false start: you score nothing this round.',
    'The first valid reaction wins the round.',
    'Reactions faster than 150ms are impossible and are rejected as false starts.',
    'Best of 5 rounds — the player with the most round wins takes the match.',
  ],
  scoring: '1 point per round won. Ties are broken by average reaction time.',
  winCondition: 'Win the most of five rounds.',
  tags: ['reflex', 'fast', 'party', '2-4 players'],
  featured: true,
  hasRounds: true,
  defaultRounds: 5,
  version: '1.0.0',
} satisfies GameMetadata;


export const MEMORY_MATCH_METADATA = {
  id: 'memory-match',
  name: 'Memory Match',
  description:
    'Flip two cards, remember what you saw and collect the most pairs. The full layout never leaves the server.',
  category: 'memory' as const,
  icon: '🧠',
  thumbnail: '🧠',
  minPlayers: 2,
  maxPlayers: 4,
  supportedPlayerCounts: [2, 3, 4],
  hasAI: true,
  aiDifficulties: ['easy', 'medium', 'hard'] as AIDifficulty[],
  estimatedDuration: 240,
  difficulty: 'medium' as const,
  controls: 'Tap a card to flip it. Match a pair to keep your turn.',
  rules: [
    'Players take turns flipping two cards.',
    'A matching pair scores 1 point and the player continues.',
    'A mismatch flips both cards back and the turn passes on.',
    'The player with the most pairs when the board is clear wins.',
    'Only revealed cards are ever sent to clients — the hidden layout stays on the server.',
  ],
  scoring: '1 point per pair collected.',
  winCondition: 'Collect the most pairs.',
  tags: ['memory', 'turn-based', 'family', '2-4 players'],
  featured: true,
  gridOptions: ['4x4', '6x4', '6x6'],
  version: '1.0.0',
} satisfies GameMetadata;


export const WORD_RACE_METADATA = {
  id: 'word-race',
  name: 'Word Race',
  description:
    'Name as many valid words as you can in the given category before the clock runs out. The server owns the dictionary.',
  category: 'word' as const,
  icon: '🔤',
  thumbnail: '🔤',
  minPlayers: 2,
  maxPlayers: 4,
  supportedPlayerCounts: [2, 3, 4],
  hasAI: true,
  aiDifficulties: ['easy', 'medium', 'hard'] as AIDifficulty[],
  estimatedDuration: 180,
  difficulty: 'medium' as const,
  controls: 'Type a word that fits the category and press Enter.',
  rules: [
    'Each round gives a category and 60 seconds.',
    'A valid, unused word scores 1 point.',
    'Invalid or repeated words score nothing.',
    'Only the server dictionary decides what is valid — clients cannot invent words.',
    'Best of 3 rounds wins.',
  ],
  scoring: '1 point per unique valid word. Highest total after 3 rounds wins.',
  winCondition: 'Score the most valid words across three rounds.',
  tags: ['word', 'typing', 'party', '2-4 players'],
  featured: true,
  hasRounds: true,
  defaultRounds: 3,
  version: '1.0.0',
} satisfies GameMetadata;


export const DOTS_AND_BOXES_METADATA = {
  id: 'dots-and-boxes',
  name: 'Dots and Boxes',
  description:
    'Draw lines, complete boxes and chain your way to victory. Completing a box earns another turn.',
  category: 'strategy' as const,
  icon: '🔲',
  thumbnail: '🔲',
  minPlayers: 2,
  maxPlayers: 4,
  supportedPlayerCounts: [2, 3, 4],
  hasAI: true,
  aiDifficulties: ['easy', 'medium', 'hard'] as AIDifficulty[],
  estimatedDuration: 300,
  difficulty: 'medium' as const,
  controls: 'Tap the gap between two dots to draw a horizontal or vertical line.',
  rules: [
    'Players take turns drawing one horizontal or vertical line.',
    'Completing the fourth side of a box scores 1 point and earns another turn.',
    'The board is finished when every box is claimed.',
    'The player with the most boxes wins.',
  ],
  scoring: '1 point per completed box.',
  winCondition: 'Own the most boxes when the grid is full.',
  tags: ['strategy', 'turn-based', 'classic', '2-4 players'],
  featured: false,
  gridOptions: ['4x4', '6x6', '8x8'],
  version: '1.0.0',
} satisfies GameMetadata;


export const MATH_RUSH_METADATA = {
  id: 'math-rush',
  name: 'Math Rush',
  description:
    'Solve arithmetic challenges against the clock. Faster correct answers score more. The server owns every question and answer.',
  category: 'math' as const,
  icon: '🧮',
  thumbnail: '🧮',
  minPlayers: 2,
  maxPlayers: 4,
  supportedPlayerCounts: [2, 3, 4],
  hasAI: true,
  aiDifficulties: ['easy', 'medium', 'hard'] as AIDifficulty[],
  estimatedDuration: 180,
  difficulty: 'medium' as const,
  controls: 'Type your answer and press Enter (or use the on-screen keypad).',
  rules: [
    'Everyone gets the same question at the same time.',
    'A correct answer scores 10 points plus a speed bonus of up to 10.',
    'A wrong answer scores nothing and locks you out of that question.',
    'Unanswered questions score nothing when the timer runs out.',
    'Highest score after the final question wins.',
  ],
  scoring: '10 points per correct answer + up to 10 bonus points for speed.',
  winCondition: 'Score the most points across all questions.',
  tags: ['math', 'speed', 'skill', '2-4 players'],
  featured: true,
  version: '1.0.0',
} satisfies GameMetadata;
