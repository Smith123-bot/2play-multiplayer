/**
 * Server-owned drawing prompts. The secret word never leaves this module
 * except as a per-viewer field for the current drawer.
 *
 * The pool contains easy, common, family-friendly words that are simple
 * enough for casual players and children to understand and draw.
 */

export const DRAW_CATEGORIES = [
  'animals',
  'food',
  'objects',
  'places',
  'sports',
  'actions',
  'school',
  'nature',
  'household',
  'transport',
  'colors',
  'professions',
  'games',
  'clothing',
  'body',
  'weather',
  'music',
  'celebration',
] as const;
export type DrawCategory = (typeof DRAW_CATEGORIES)[number];

/**
 * Easy drawing prompts. Every entry must be lowercase, non-empty and
 * common enough for casual players to draw and guess.
 */
export const DRAW_WORDS: Record<DrawCategory, readonly string[]> = {
  animals: [
    'cat', 'dog', 'cow', 'horse', 'pig', 'goat', 'sheep', 'lion', 'tiger', 'bear',
    'monkey', 'elephant', 'rabbit', 'fish', 'bird',
  ],

  food: [
    'apple', 'banana', 'mango', 'orange', 'grape', 'cake', 'pizza', 'burger', 'bread', 'egg',
  ],

  objects: [
    'ball', 'book', 'pen', 'pencil', 'bag', 'chair', 'table', 'clock', 'phone', 'cup',
    'key', 'lamp', 'box', 'bottle', 'umbrella',
  ],

  places: [
    'home', 'school', 'park', 'shop', 'farm', 'zoo', 'beach', 'hospital', 'market', 'garden',
  ],

  sports: [
    'football', 'cricket', 'tennis', 'basketball', 'baseball', 'hockey', 'boxing', 'swimming',
    'running', 'cycling',
  ],

  actions: [
    'run', 'walk', 'jump', 'sit', 'sleep', 'eat', 'drink', 'read', 'write', 'dance',
  ],

  school: [
    'teacher', 'student', 'book', 'pen', 'pencil', 'ruler', 'bag', 'desk', 'bell', 'board',
  ],

  nature: [
    'tree', 'flower', 'sun', 'moon', 'star', 'cloud', 'rain', 'river', 'mountain', 'grass',
  ],

  household: [
    'bed', 'chair', 'table', 'door', 'window', 'fan', 'sofa', 'broom', 'mirror', 'lamp',
  ],

  transport: [
    'car', 'bus', 'train', 'bike', 'boat', 'ship', 'plane', 'truck', 'taxi', 'scooter',
  ],

  colors: [
    'red', 'blue', 'green', 'yellow', 'orange', 'pink', 'purple', 'black', 'white', 'brown',
    'gray', 'gold', 'silver', 'violet', 'rainbow',
  ],

  professions: [
    'doctor', 'teacher', 'farmer', 'chef', 'nurse', 'pilot', 'police', 'driver', 'artist',
    'firefighter',
  ],

  games: [
    'ball', 'doll', 'blocks', 'puzzle', 'cards', 'dice', 'kite', 'swing', 'slide', 'yo-yo',
  ],

  clothing: [
    'shirt', 'pants', 'dress', 'shoe', 'sock', 'hat', 'cap', 'coat', 'skirt', 'belt',
  ],

  body: [
    'head', 'eye', 'ear', 'nose', 'mouth', 'hand', 'arm', 'leg', 'foot', 'hair',
  ],

  weather: [
    'sun', 'rain', 'cloud', 'snow', 'wind', 'storm', 'fog', 'rainbow', 'hot', 'cold',
  ],

  music: [
    'song', 'music', 'drum', 'piano', 'guitar', 'flute', 'bell', 'microphone', 'speaker', 'dance',
  ],

  celebration: [
    'birthday', 'cake', 'candle', 'balloon', 'party', 'gift', 'hat', 'confetti', 'star', 'parade',
  ],
};

export interface DrawWordEntry {
  word: string;
  category: DrawCategory;
}

/**
 * Validates and flattens the pool. Empty, malformed or duplicated entries are
 * rejected here so the deck builder never sees dirty data — a duplicated word
 * would break the "no repetition before exhaustion" guarantee.
 */
export function allDrawWords(): DrawWordEntry[] {
  const seen = new Set<string>();
  const entries: DrawWordEntry[] = [];

  for (const category of DRAW_CATEGORIES) {
    for (const raw of DRAW_WORDS[category]) {
      const word = raw.trim().toLowerCase();

      // Reject empty fragments and anything with stray punctuation:
      // prompts are plain lowercase words/phrases only.
      if (word.length === 0) continue;
      if (!/^[a-z0-9 -]+$/.test(word)) continue;
      if (seen.has(word)) continue; // duplicate entry rejected

      seen.add(word);
      entries.push({ word, category });
    }
  }

  return entries;
}

export function normalizeGuess(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Fisher–Yates shuffle driven by an injected RNG (the match's seeded stream).
 * Returns a new array; the input is never mutated.
 */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const pool = [...items];

  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = pool[i]!;
    const b = pool[j]!;

    pool[i] = b;
    pool[j] = a;
  }

  return pool;
}

/**
 * The shuffled draw deck.
 *
 * INVARIANT: `draw()` never returns a word that was already drawn in the
 * current cycle. A fresh shuffle is created only when every word in the deck
 * has been used once. Any session/server restart simply starts a new cycle.
 */
export class WordDeck {
  private remaining: string[];
  private cycle = 1;

  constructor(
    words: readonly DrawWordEntry[],
    random: () => number,
    /** Words to exclude from the FIRST build (rematch continuity). */
    exclude: readonly string[] = [],
  ) {
    const excluded = new Set(exclude);
    const pool = words.filter((entry) => !excluded.has(entry.word));

    this.remaining = shuffled(
      pool.length > 0 ? pool : words,
      random,
    ).map((entry) => entry.word);
  }

  /** Words not yet drawn in the current cycle. */
  get left(): string[] {
    return [...this.remaining];
  }

  get cycles(): number {
    return this.cycle;
  }

  get size(): number {
    return this.remaining.length;
  }

  /**
   * Draws the next unused word. Only when the deck is EMPTY does it reshuffle
   * the full pool and start a new cycle — never earlier.
   */
  draw(random: () => number): string | null {
    if (this.remaining.length === 0) {
      this.remaining = shuffled(ALL_WORDS, random).map((entry) => entry.word);
      this.cycle += 1;
    }

    return this.remaining.shift() ?? null;
  }
}

/** The validated master list (built once per process). */
export const ALL_WORDS: readonly DrawWordEntry[] = allDrawWords();
