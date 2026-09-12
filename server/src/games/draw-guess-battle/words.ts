/**
 * Server-owned drawing prompts. The secret word never leaves this module
 * except as a per-viewer field for the current drawer.
 */
export const DRAW_CATEGORIES = [
  'animals',
  'food',
  'objects',
  'places',
  'sports',
  'actions',
  'nature',
  'emotions',
] as const;
export type DrawCategory = (typeof DRAW_CATEGORIES)[number];

export const DRAW_WORDS: Record<DrawCategory, readonly string[]> = {
  animals: [
    'cat', 'dog', 'fish', 'bird', 'lion', 'frog', 'duck', 'bear', 'owl', 'bee',
    'snake', 'horse', 'crab', 'whale', 'mouse', 'pig', 'cow', 'sheep', 'goat', 'ant',
    'rabbit', 'elephant', 'giraffe', 'penguin', 'turtle', 'butterfly', 'shark', 'kangaroo',
  ],
  food: [
    'pizza', 'cake', 'apple', 'banana', 'bread', 'egg', 'cheese', 'cookie', 'taco', 'rice',
    'soup', 'corn', 'grape', 'lemon', 'donut', 'burger', 'ice cream', 'carrot', 'milk', 'honey',
    'pancake', 'popcorn', 'sandwich', 'strawberry', 'watermelon', 'pineapple', 'noodles', 'chocolate',
  ],
  objects: [
    'chair', 'lamp', 'clock', 'phone', 'book', 'key', 'hat', 'shoe', 'ball', 'cup',
    'pencil', 'umbrella', 'guitar', 'camera', 'bag', 'ladder', 'broom', 'mirror', 'bottle', 'star',
    'scissors', 'toothbrush', 'wallet', 'glasses', 'candle', 'hanger', 'hammer', 'helmet',
  ],
  places: [
    'beach', 'park', 'school', 'farm', 'castle', 'bridge', 'mountain', 'island', 'city', 'tent',
    'house', 'tree', 'cave', 'river', 'desert', 'forest', 'lake', 'zoo', 'store', 'station',
    'airport', 'lighthouse', 'stadium', 'harbor', 'village', 'waterfall', 'igloo', 'skyscraper',
  ],
  sports: [
    'soccer', 'tennis', 'golf', 'swim', 'ski', 'run', 'bike', 'box', 'surf', 'skate',
    'basketball', 'baseball', 'volleyball', 'hockey', 'bowling', 'archery', 'climb', 'dive', 'yoga', 'hike',
    'fencing', 'rowing', 'karate', 'cycling', 'skating', 'gymnastics', 'polo', 'rugby',
  ],
  actions: [
    'jump', 'sleep', 'eat', 'read', 'wave', 'dance', 'sing', 'fly', 'swim', 'cook',
    'paint', 'build', 'drive', 'catch', 'throw', 'kick', 'hug', 'laugh', 'cry', 'think',
    'sneeze', 'whisper', 'clap', 'dig', 'sweep', 'push', 'pull', 'balance',
  ],
  nature: [
    'rainbow', 'snowman', 'rain', 'storm', 'sun', 'moon', 'comet', 'cloud', 'wind', 'tide',
    'flower', 'leaf', 'acorn', 'mushroom', 'shell', 'cactus', 'volcano', 'rock', 'snowflake', 'lightning',
    'coral', 'fern', 'pebble', 'sunrise', 'sunset', 'tornado', 'hail', 'blossom',
  ],
  emotions: [
    'happy', 'sad', 'angry', 'scared', 'surprised', 'shy', 'proud', 'tired', 'excited', 'bored',
    'nervous', 'calm', 'jealous', 'confused', 'brave', 'lonely', 'silly', 'grumpy',
  ],
};

export function allDrawWords(): Array<{ word: string; category: DrawCategory }> {
  const entries: Array<{ word: string; category: DrawCategory }> = [];
  for (const category of DRAW_CATEGORIES) {
    for (const word of DRAW_WORDS[category]) {
      entries.push({ word: word.trim(), category });
    }
  }
  return entries.filter((entry) => entry.word.length > 0);
}

export function normalizeGuess(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ');
}
