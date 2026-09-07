/**
 * Server-owned drawing prompts. The secret word never leaves this module
 * except as a per-viewer field for the current drawer.
 */
export const DRAW_CATEGORIES = ['animals', 'food', 'objects', 'places', 'sports', 'actions'] as const;
export type DrawCategory = (typeof DRAW_CATEGORIES)[number];

export const DRAW_WORDS: Record<DrawCategory, readonly string[]> = {
  animals: [
    'cat', 'dog', 'fish', 'bird', 'lion', 'frog', 'duck', 'bear', 'owl', 'bee',
    'snake', 'horse', 'crab', 'whale', 'mouse', 'pig', 'cow', 'sheep', 'goat', 'ant',
  ],
  food: [
    'pizza', 'cake', 'apple', 'banana', 'bread', 'egg', 'cheese', 'cookie', 'taco', 'rice',
    'soup', 'corn', 'grape', 'lemon', 'donut', 'burger', 'ice cream', 'carrot', 'milk', 'honey',
  ],
  objects: [
    'chair', 'lamp', 'clock', 'phone', 'book', 'key', 'hat', 'shoe', 'ball', 'cup',
    'pencil', 'umbrella', 'guitar', 'camera', 'bag', 'ladder', 'broom', 'mirror', 'bottle', 'star',
  ],
  places: [
    'beach', 'park', 'school', 'farm', 'castle', 'bridge', 'mountain', 'island', 'city', 'tent',
    'house', 'tree', 'cave', 'river', 'desert', 'forest', 'lake', 'zoo', 'store', 'station',
  ],
  sports: [
    'soccer', 'tennis', 'golf', 'swim', 'ski', 'run', 'bike', 'box', 'surf', 'skate',
    'basketball', 'baseball', 'volleyball', 'hockey', 'bowling', 'archery', 'climb', 'dive', 'yoga', 'hike',
  ],
  actions: [
    'jump', 'sleep', 'eat', 'read', 'wave', 'dance', 'sing', 'fly', 'swim', 'cook',
    'paint', 'build', 'drive', 'catch', 'throw', 'kick', 'hug', 'laugh', 'cry', 'think',
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
