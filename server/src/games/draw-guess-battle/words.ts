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
  'nature',
  'household',
  'transport',
  'clothing',
  'body',
] as const;
export type DrawCategory = (typeof DRAW_CATEGORIES)[number];

/**
 * 200+ Purely visual, concrete, and super easy words to draw within 30 seconds.
 * Extracted all abstract terms like 'party', 'hospital', 'sports' etc.
 */
export const DRAW_WORDS: Record<DrawCategory, readonly string[]> = {
  animals: [
    'cat', 'dog', 'cow', 'horse', 'pig', 'goat', 'sheep', 'lion', 'tiger', 'bear',
    'monkey', 'elephant', 'rabbit', 'fish', 'bird', 'duck', 'frog', 'turtle', 'snake', 'crab',
    'shark', 'whale', 'mouse', 'owl', 'bee', 'ant', 'spider', 'camel', 'deer', 'fox'
  ],

  food: [
    'apple', 'banana', 'mango', 'orange', 'grape', 'cake', 'pizza', 'burger', 'bread', 'egg',
    'cheese', 'cookie', 'donut', 'ice cream', 'carrot', 'potato', 'tomato', 'corn', 'milk', 'juice',
    'candy', 'lollipop', 'watermelon', 'strawberry', 'pineapple', 'pear', 'lemon', 'popcorn', 'taco', 'eggplant'
  ],

  objects: [
    'ball', 'book', 'pen', 'pencil', 'bag', 'chair', 'table', 'clock', 'phone', 'cup',
    'key', 'lamp', 'box', 'bottle', 'umbrella', 'scissors', 'glasses', 'hammer', 'comb', 'spoon',
    'fork', 'knife', 'ring', 'coin', 'mirror', 'brush', 'guitar', 'drum', 'bell', 'whistle',
    'ladder', 'kite', 'balloon', 'trophy', 'medal', 'crown', 'mask', 'candle', 'ribbon', 'key'
  ],

  nature: [
    'tree', 'flower', 'sun', 'moon', 'star', 'cloud', 'rain', 'river', 'mountain', 'grass',
    'leaf', 'mushroom', 'rainbow', 'volcano', 'fire', 'rock', 'wave', 'desert', 'island', 'lake',
    'cactus', 'shell', 'feather', 'snowflake', 'seed', 'stick', 'bush', 'dirt', 'web', 'planet'
  ],

  household: [
    'bed', 'sofa', 'door', 'window', 'fan', 'broom', 'pillow', 'blanket', 'bucket', 'mug',
    'plate', 'fridge', 'television', 'computer', 'curtain', 'mat', 'towel', 'soap', 'sink', 'toilet',
    'toothbrush', 'mirror', 'clock', 'lamp', 'bin', 'plug', 'key', 'hammer', 'picture', 'vase'
  ],

  transport: [
    'car', 'bus', 'train', 'bike', 'boat', 'ship', 'plane', 'truck', 'taxi', 'scooter',
    'bicycle', 'rocket', 'helicopter', 'submarine', 'tractor', 'ambulance', 'jeep', 'van', 'skateboard', 'parachute'
  ],

  clothing: [
    'shirt', 'pants', 'dress', 'shoe', 'sock', 'hat', 'cap', 'coat', 'skirt', 'belt',
    'gloves', 'scarf', 'boots', 'jacket', 'tie', 'shorts', 'ring', 'watch', 'glasses', 'crown',
    'purse', 'mask', 'helmet', 'apron', 'slipper'
  ],

  body: [
    'head', 'eye', 'ear', 'nose', 'mouth', 'hand', 'arm', 'leg', 'foot', 'hair',
    'teeth', 'tongue', 'face', 'finger', 'thumb', 'nail', 'knee', 'elbow', 'heart', 'bone'
  ],
};

export interface DrawWordEntry {
  word: string;
  category: DrawCategory;
}

export function allDrawWords(): DrawWordEntry[] {
  const seen = new Set<string>();
  const entries: DrawWordEntry[] = [];

  for (const category of DRAW_CATEGORIES) {
    for (const raw of DRAW_WORDS[category]) {
      const word = raw.trim().toLowerCase();

      if (word.length === 0) continue;
      if (!/^[a-z0-9 -]+$/.test(word)) continue;
      if (seen.has(word)) continue;

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

export class WordDeck {
  private remaining: string[];
  private cycle = 1;

  constructor(
    words: readonly DrawWordEntry[],
    random: () => number,
    exclude: readonly string[] = [],
  ) {
    const excluded = new Set(exclude);
    const pool = words.filter((entry) => !excluded.has(entry.word));

    this.remaining = shuffled(
      pool.length > 0 ? pool : words,
      random,
    ).map((entry) => entry.word);
  }

  get left(): string[] {
    return [...this.remaining];
  }

  get cycles(): number {
    return this.cycle;
  }

  get size(): number {
    return this.remaining.length;
  }

  draw(random: () => number): string | null {
    if (this.remaining.length === 0) {
      this.remaining = shuffled(ALL_WORDS, random).map((entry) => entry.word);
      this.cycle += 1;
    }
    return this.remaining.shift() ?? null;
  }
}

export const ALL_WORDS: readonly DrawWordEntry[] = allDrawWords();
