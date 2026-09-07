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


export const BATTLE_2048_METADATA = {
  id: '2048-battle',
  name: '2048 Battle',
  description:
    'Two private 2048 boards, one clock. Slide, merge and outscore your rival — the server owns every tile.',
  category: 'strategy' as const,
  icon: '🔢',
  thumbnail: '🔢',
  minPlayers: 2,
  maxPlayers: 2,
  supportedPlayerCounts: [2],
  hasAI: true,
  aiDifficulties: ['easy', 'medium', 'hard'] as AIDifficulty[],
  estimatedDuration: 200,
  difficulty: 'medium' as const,
  controls: 'Arrow keys, swipe on your board or use the on-screen D-pad. Both players play at the same time.',
  rules: [
    'Each player gets their own private 4x4 board playing standard 2048.',
    'Swipe or press a direction: every tile slides and equal neighbours merge once per move.',
    'Every valid move spawns a new tile (a 2, occasionally a 4) on your board.',
    'Merging tiles adds their combined value to your score.',
    'When a board has no legal moves left it locks — that player stays in the match and waits.',
    'The match ends when both boards lock or the clock runs out; the higher score wins.',
  ],
  scoring: 'Merges add their value to your score. Higher total wins; equal totals are a draw.',
  winCondition: 'Finish with a higher score than your rival.',
  tags: ['strategy', 'puzzle', 'numbers', '2 players'],
  featured: false,
  version: '1.0.0',
} satisfies GameMetadata;


export const MAZE_RACE_METADATA = {
  id: 'maze-race-2d',
  name: 'Maze Race 2D',
  description:
    'A maze generated fresh from the server seed — everyone races from their own start to the flag. Walls are real: only the server moves you.',
  category: 'reflex' as const,
  icon: '🧩',
  thumbnail: '🧩',
  minPlayers: 2,
  maxPlayers: 4,
  supportedPlayerCounts: [2, 3, 4],
  hasAI: true,
  aiDifficulties: ['easy', 'medium', 'hard'] as AIDifficulty[],
  estimatedDuration: 150,
  difficulty: 'medium' as const,
  controls: 'Arrow keys, swipe or the on-screen D-pad to move one cell at a time.',
  rules: [
    'The maze is generated deterministically from the server seed — identical for everyone in the match.',
    'Every player starts from their own start cell, the same distance from the goal.',
    'Move up, down, left or right — one cell per move, walls block you.',
    'The first player to reach the flag wins rank 1; later finishers take the next ranks.',
    'Players who never reach the goal before the timeout are ranked below every finisher (closer to the goal ranks higher).',
  ],
  scoring: 'Faster finishers score more (remaining time bonus). Unfinished players score 0.',
  winCondition: 'Reach the goal first.',
  tags: ['reflex', 'maze', 'race', '2-4 players'],
  featured: false,
  gridOptions: ['11x11', '15x15', '19x19'],
  version: '1.0.0',
} satisfies GameMetadata;


export const WORD_SCRAMBLE_METADATA = {
  id: 'word-scramble-battle',
  name: 'Word Scramble Battle',
  description:
    'Unscramble the shuffled letters faster than everyone else. The original word never leaves the server until the round ends.',
  category: 'word' as const,
  icon: '🔤',
  thumbnail: '🔀',
  minPlayers: 2,
  maxPlayers: 4,
  supportedPlayerCounts: [2, 3, 4],
  hasAI: true,
  aiDifficulties: ['easy', 'medium', 'hard'] as AIDifficulty[],
  estimatedDuration: 140,
  difficulty: 'medium' as const,
  controls: 'Type what you think is the hidden word and press Enter.',
  rules: [
    'Each round the server picks a word and shuffles its letters for everyone.',
    'Type the original word and submit — first correct answer scores.',
    'Correct answers earn 1 point, plus 1 bonus point for solving in the first half of the round.',
    'Wrong answers score nothing and you can simply try again.',
    'A round ends when every active player has solved it, or when its timer runs out.',
    'The original word is revealed between rounds; after the final round the highest score wins.',
  ],
  scoring: '1 point per solved word + 1 speed bonus for early solves. Equal totals are a draw.',
  winCondition: 'Solve more words than your rivals across all rounds.',
  tags: ['word', 'typing', 'puzzle', '2-4 players'],
  featured: false,
  hasRounds: true,
  defaultRounds: 5,
  version: '1.0.0',
} satisfies GameMetadata;


export const SHAPE_MATCH_METADATA = {
  id: 'shape-match-battle',
  name: 'Shape Match Battle',
  description:
    'Spot the shape that matches the target — fast, sharp eyes win. The correct option is decided by the server alone.',
  category: 'reflex' as const,
  icon: '🔶',
  thumbnail: '🔶',
  minPlayers: 2,
  maxPlayers: 4,
  supportedPlayerCounts: [2, 3, 4],
  hasAI: true,
  aiDifficulties: ['easy', 'medium', 'hard'] as AIDifficulty[],
  estimatedDuration: 130,
  difficulty: 'easy' as const,
  controls: 'Tap the option that matches the target shape.',
  rules: [
    'Every round shows one target shape and four options — exactly one matches.',
    'Tap an option: a correct match scores 1 point, plus 1 bonus point in the first half of the round.',
    'A wrong option scores nothing — you only get one pick per round.',
    'The round ends when every active player has picked, or when its timer runs out.',
    'After the final round the highest score wins; equal scores are a draw.',
  ],
  scoring: '1 point per correct match + 1 speed bonus for fast picks.',
  winCondition: 'Match more shapes than your rivals.',
  tags: ['reflex', 'pattern', 'speed', '2-4 players'],
  featured: false,
  hasRounds: true,
  defaultRounds: 10,
  version: '1.0.0',
} satisfies GameMetadata;
