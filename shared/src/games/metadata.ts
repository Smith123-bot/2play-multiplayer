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


export const SNAKE_BATTLE_METADATA = {
  id: 'snake-battle',
  name: 'Snake Battle',
  description:
    'Two snakes, one arena. Grab the food, cut off your rival and be the last serpent sliding. The server moves every snake on a fixed clock.',
  category: 'reflex' as const,
  icon: '🐍',
  thumbnail: '🐍',
  minPlayers: 2,
  maxPlayers: 2,
  supportedPlayerCounts: [2],
  hasAI: true,
  aiDifficulties: ['easy', 'medium', 'hard'] as AIDifficulty[],
  estimatedDuration: 180,
  difficulty: 'medium' as const,
  controls: 'Steer with WASD / arrow keys, swipe on the arena or use the D-pad below it.',
  rules: [
    'Both snakes slide on the same 17x17 grid, one cell every quarter second.',
    'Turn up, down, left or right — reversing into yourself is rejected by the server.',
    'Eating food grows your snake by one segment and scores 10 points.',
    'Hitting a wall, any snake body or another head kills your snake instantly.',
    'A dead snake is out, but the survivor keeps eating until the clock or their own crash.',
    'Survive longer to win; if both die on the same step the higher score takes it.',
  ],
  scoring: '10 points per food. Survival beats score; score breaks survival ties.',
  winCondition: 'Outlive your rival (or outhunt them on the fatal step).',
  tags: ['reflex', 'arcade', 'classic', '2 players'],
  featured: false,
  version: '1.0.0',
} satisfies GameMetadata;


export const TRAFFIC_DODGE_METADATA = {
  id: 'traffic-dodge-race',
  name: 'Traffic Dodge Race',
  description:
    'A five-lane arcade sprint: weave through oncoming traffic, survive the crashes and outrun your rival to the finish line.',
  category: 'reflex' as const,
  icon: '🏎️',
  thumbnail: '🏎️',
  minPlayers: 2,
  maxPlayers: 2,
  supportedPlayerCounts: [2],
  hasAI: true,
  aiDifficulties: ['easy', 'medium', 'hard'] as AIDifficulty[],
  estimatedDuration: 150,
  difficulty: 'medium' as const,
  controls: 'Switch lanes with A/D, the left/right arrow keys, swipe or the side buttons.',
  rules: [
    'Both racers share one five-lane road and accelerate automatically — steering is all you do.',
    'Traffic ahead of you is generated from the server seed; every racer sees the same road.',
    'Hitting a car stuns you for 1.5 seconds and drops you behind it — the race goes on.',
    'The finish line is 2000 units away; the first racer across wins.',
    'If the clock runs out, the racer closest to the finish wins.',
  ],
  scoring: 'Progress decides: finishing first wins, otherwise the furthest racer takes it.',
  winCondition: 'Cross the finish line first (or lead at the timeout).',
  tags: ['reflex', 'racing', 'arcade', '2 players'],
  featured: false,
  version: '1.0.0',
} satisfies GameMetadata;


export const TARGET_RUSH_METADATA = {
  id: 'target-rush',
  name: 'Target Rush',
  description:
    'Three targets, one symbol to hit. Read the prompt, tap the right target first and build a streak your rival cannot match.',
  category: 'reflex' as const,
  icon: '🎯',
  thumbnail: '🎯',
  minPlayers: 2,
  maxPlayers: 2,
  supportedPlayerCounts: [2],
  hasAI: true,
  aiDifficulties: ['easy', 'medium', 'hard'] as AIDifficulty[],
  estimatedDuration: 120,
  difficulty: 'easy' as const,
  controls: 'Tap or click the target that matches the prompt symbol.',
  rules: [
    'Every round shows a prompt symbol and three large targets — exactly one matches.',
    'The first correct tap scores: 10 points, up to 10 extra for speed, plus a combo bonus for your streak.',
    'Tapping a wrong target scores nothing, breaks your streak and locks you out for a second.',
    'A round ends on the first correct tap or when its timer runs out (all streaks reset).',
    'Eight rounds — the highest total score wins, equal totals are a draw.',
  ],
  scoring: '10 points per hit + up to 10 speed points + 2 per streak step (max +6).',
  winCondition: 'Score the most points across eight rounds.',
  tags: ['reflex', 'speed', 'focus', '2 players'],
  featured: false,
  hasRounds: true,
  defaultRounds: 8,
  version: '1.0.0',
} satisfies GameMetadata;


export const CAPTURE_THE_FLAG_METADATA = {
  id: 'capture-the-flag-2d',
  name: 'Capture the Flag 2D',
  description:
    'Sneak across the arena, grab the enemy flag and carry it home — but one touch sends you back to your base. First team to three captures.',
  category: 'strategy' as const,
  icon: '🚩',
  thumbnail: '🚩',
  minPlayers: 2,
  maxPlayers: 4,
  supportedPlayerCounts: [2, 4],
  hasAI: true,
  aiDifficulties: ['easy', 'medium', 'hard'] as AIDifficulty[],
  estimatedDuration: 180,
  difficulty: 'medium' as const,
  controls: 'Move one cell at a time with WASD / arrow keys, swipe or the D-pad.',
  rules: [
    'Two teams: with four players, seats 1 & 3 face seats 2 & 4; with two it is a duel.',
    'Enter the enemy flag cell to pick the flag up — it moves with you.',
    'Carry it onto your own base to score a capture; first team to 3 captures wins.',
    'Moving onto an opponent tags them: they respawn at their base and any carried flag returns home.',
    'Players standing on their own base cannot be tagged (no spawn camping).',
    'If the clock runs out, the team with more captures wins.',
  ],
  scoring: '1 point per captured flag for the whole team.',
  winCondition: 'Reach 3 captures or lead when the clock ends.',
  tags: ['strategy', 'teams', 'arcade', '2-4 players'],
  featured: false,
  version: '1.0.0',
} satisfies GameMetadata;
