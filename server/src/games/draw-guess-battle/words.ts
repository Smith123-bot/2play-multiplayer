/**
 * Server-owned drawing prompts. The secret word never leaves this module
 * except as a per-viewer field for the current drawer.
 *
 * The pool is a large, hand-curated set of easy, common, family-friendly
 * words (500+) spread over everyday categories. Selection does NOT pick
 * freely from this list: the game builds a shuffled deck from it and only
 * reshuffles once every word has been drawn once (see WordDeck in ../index).
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
 * 500+ easy drawing prompts. Every entry must be lowercase, non-empty and
 * common enough for casual players to draw and guess. `allDrawWords` filters
 * and validates entries so malformed data can never reach a match.
 */
export const DRAW_WORDS: Record<DrawCategory, readonly string[]> = {
  animals: [
    'cat', 'dog', 'fish', 'bird', 'lion', 'frog', 'duck', 'bear', 'owl', 'bee',
    'snake', 'horse', 'crab', 'whale', 'mouse', 'pig', 'cow', 'sheep', 'goat', 'ant',
    'rabbit', 'turtle', 'monkey', 'elephant', 'giraffe', 'zebra', 'penguin', 'dolphin',
    'shark', 'octopus', 'spider', 'butterfly', 'snail', 'fox', 'wolf', 'deer', 'camel',
    'kangaroo', 'koala', 'panda', 'tiger', 'chicken', 'rooster', 'flamingo', 'peacock',
    'hamster', 'hedgehog', 'raccoon', 'squirrel', 'bat', 'eagle', 'parrot', 'seal',
    'lobster', 'shrimp', 'jellyfish', 'starfish', 'crocodile', 'lizard', 'dinosaur',
    'unicorn', 'dragon', 'llama', 'otter', 'skunk', 'moose', 'bison', 'pelican',
    'toucan', 'sloth', 'chimp', 'gorilla', 'hippo', 'rhino', 'donkey', 'pony',
    'kitten', 'puppy', 'chick', 'caterpillar', 'ladybug', 'mosquito', 'worm', 'scorpion',
  ],
  food: [
    'pizza', 'cake', 'apple', 'banana', 'bread', 'egg', 'cheese', 'cookie', 'taco', 'rice',
    'soup', 'corn', 'grape', 'lemon', 'donut', 'burger', 'ice cream', 'carrot', 'milk', 'honey',
    'pancake', 'waffle', 'spaghetti', 'sandwich', 'hot dog', 'popcorn', 'chocolate', 'candy',
    'lollipop', 'cupcake', 'pie', 'salad', 'tomato', 'potato', 'onion', 'garlic', 'pepper',
    'strawberry', 'watermelon', 'pineapple', 'mango', 'peach', 'cherry', 'pear', 'tangerine',
    'coconut', 'avocado', 'broccoli', 'mushroom', 'pumpkin', 'beans', 'bacon', 'steak',
    'chicken soup', 'sushi', 'noodles', 'cereal', 'yogurt', 'butter', 'jam', 'toast',
    'fries', 'chips', 'pretzel', 'muffin', 'brownie', 'milkshake', 'juice', 'lemonade',
    'tea', 'coffee', 'hot chocolate', 'smoothie', 'ketchup', 'mustard', 'mayonnaise',
    'meatball', 'sausage', 'ham', 'fried shrimp', 'spring roll', 'dumpling', 'curry',
  ],
  objects: [
    'chair', 'lamp', 'clock', 'phone', 'book', 'key', 'hat', 'shoe', 'ball', 'cup',
    'pencil', 'umbrella', 'guitar', 'camera', 'bag', 'ladder', 'broom', 'mirror', 'bottle',
    'star', 'table', 'sofa', 'bed', 'desk', 'shelf', 'basket', 'box', 'bucket', 'candle',
    'scissors', 'hammer', 'nail', 'screwdriver', 'wrench', 'saw', 'lock', 'chain', 'rope',
    'bell', 'balloon', 'kite', 'gift', 'medal', 'trophy', 'crown', 'sword', 'shield',
    'drum', 'trumpet', 'violin', 'piano', 'radio', 'television', 'laptop', 'keyboard',
    'mouse pad', 'headphones', 'watch', 'glasses', 'wallet', 'coin', 'bank card', 'stamp',
    'envelope', 'letter', 'map', 'compass', 'telescope', 'magnet', 'battery', 'bulb',
    'torch', 'plug', 'switch', 'remote', 'pillow', 'blanket', 'towel', 'soap', 'sponge',
    'toothbrush', 'comb', 'brush', 'razor', 'tissue', 'dustbin', 'vase', 'pot', 'pan',
    'plate', 'bowl', 'spoon', 'fork', 'knife', 'chopsticks', 'straw', 'napkin', 'apron',
  ],
  places: [
    'beach', 'park', 'school', 'farm', 'castle', 'bridge', 'mountain', 'island', 'city', 'tent',
    'house', 'tree', 'cave', 'river', 'desert', 'forest', 'lake', 'zoo', 'store', 'station',
    'hospital', 'library', 'museum', 'church', 'temple', 'market', 'mall', 'bakery', 'barber',
    'cinema', 'theater', 'stadium', 'pool', 'gym', 'playground', 'lighthouse', 'windmill',
    'igloo', 'cabin', 'skyscraper', 'tower', 'fountain', 'pyramid', 'volcano', 'waterfall',
    'harbor', 'airport', 'bus stop', 'parking lot', 'street', 'alley', 'square', 'garden',
    'farmyard', 'orchard', 'vineyard', 'greenhouse', 'barn', 'stable', 'henhouse', 'campsite',
  ],
  sports: [
    'soccer', 'tennis', 'golf', 'swim', 'ski', 'run', 'bike', 'box', 'surf', 'skate',
    'basketball', 'baseball', 'volleyball', 'hockey', 'bowling', 'archery', 'climb', 'dive',
    'yoga', 'hike', 'football', 'cricket', 'badminton', 'table tennis', 'rugby', 'karate',
    'judo', 'taekwondo', 'fencing', 'wrestling', 'weightlifting', 'jump rope', 'sprint',
    'marathon', 'relay', 'high jump', 'long jump', 'pole vault', 'shot put', 'skating',
    'surfing', 'sailing', 'rowing', 'canoe', 'kayak', 'fishing', 'hunting', 'darts',
    'billiards', 'chess', 'checkers', 'ping pong', 'handball', 'softball', 'lacrosse',
  ],
  actions: [
    'jump', 'sleep', 'eat', 'read', 'wave', 'dance', 'sing', 'fly', 'float', 'cook',
    'paint', 'build', 'drive', 'catch', 'throw', 'kick', 'hug', 'laugh', 'cry', 'think',
    'walk', 'talk', 'listen', 'write', 'draw', 'clap', 'snap', 'wink', 'smile', 'frown',
    'shout', 'whisper', 'jog', 'crawl', 'cartwheel', 'dig', 'push', 'pull', 'lift', 'carry',
    'sweep', 'mop', 'wash', 'rinse', 'dry', 'fold', 'iron', 'sew', 'knit', 'plant',
    'water', 'harvest', 'pick', 'peel', 'slice', 'stir', 'mix', 'pour', 'bake', 'grill',
    'skipping', 'sneezing', 'yawning', 'stretch', 'squat', 'leaning', 'riding',
  ],
  school: [
    'teacher', 'student', 'classroom', 'blackboard', 'whiteboard', 'chalk', 'eraser',
    'notebook', 'textbook', 'homework', 'exam', 'test', 'grade', 'diploma', 'graduation',
    'backpack', 'lunchbox', 'recess', 'classmate', 'principal', 'librarian', 'science',
    'math', 'history', 'geography', 'art class', 'music class', 'alphabet', 'number',
    'ruler', 'calculator', 'globe', 'poster', 'crayon', 'marker', 'glue', 'tape',
    'paper', 'page', 'story', 'poem', 'essay', 'question', 'answer', 'project',
  ],
  nature: [
    'flower', 'leaf', 'grass', 'bush', 'log', 'stone', 'rock', 'pebble', 'sand', 'soil',
    'seed', 'root', 'branch', 'trunk', 'moss', 'fern', 'cactus', 'sunflower', 'rose',
    'tulip', 'daisy', 'lily', 'orchid', 'bamboo', 'ivy', 'vine', 'petal', 'thorn',
    'acorn', 'pinecone', 'stump', 'meadow', 'field', 'hill', 'valley', 'cliff', 'canyon',
    'reef', 'dune', 'glacier', 'geyser', 'hot spring', 'creek', 'pond', 'marsh', 'swamp',
    'jungle', 'rainforest', 'oasis', 'prairie', 'tundra',
  ],
  household: [
    'kitchen', 'bathroom', 'bedroom', 'living room', 'garage', 'attic', 'basement',
    'balcony', 'chimney', 'roof', 'door', 'window', 'wall', 'floor', 'ceiling', 'stairs',
    'elevator', 'doorbell', 'curtain', 'carpet', 'rug', 'frame', 'bookshelf', 'coat rack',
    'shoe rack', 'nightstand', 'wardrobe', 'dresser', 'crib', 'highchair', 'stool',
    'fan', 'heater', 'air conditioner', 'washing machine', 'dryer', 'dishwasher',
    'refrigerator', 'freezer', 'microwave', 'oven', 'stove', 'toaster', 'kettle',
    'blender', 'mixer', 'coffeemaker', 'vacuum', 'ironing board', 'clothesline',
  ],
  transport: [
    'car', 'bus', 'train', 'plane', 'boat', 'ship', 'truck', 'taxi', 'tram', 'metro',
    'scooter', 'motorcycle', 'bicycle', 'tricycle', 'skateboard', 'ambulance', 'fire truck',
    'police car', 'tractor', 'excavator', 'bulldozer', 'forklift', 'crane', 'pickup truck',
    'van', 'jeep', 'camper', 'caravan', 'submarine', 'sailboat', 'ferry', 'raft',
    'helicopter', 'glider', 'rocket', 'space shuttle', 'hot air balloon', 'zeppelin',
    'sled', 'sleigh', 'cable car', 'gondola', 'rickshaw', 'segway', 'hoverboard',
  ],
  colors: [
    'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown', 'black',
    'white', 'gray', 'gold', 'silver', 'rainbow', 'beige', 'maroon', 'teal', 'navy',
    'olive', 'lime', 'cyan', 'magenta', 'indigo', 'violet', 'turquoise', 'cream',
  ],
  professions: [
    'doctor', 'nurse', 'dentist', 'surgeon', 'farmer', 'baker', 'chef', 'waiter',
    'barista', 'butcher', 'fisherman', 'lifeguard', 'carpenter', 'plumber', 'electrician',
    'mechanic', 'pilot', 'sailor', 'driver', 'conductor', 'guard', 'police officer',
    'firefighter', 'soldier', 'scientist', 'engineer', 'architect', 'artist', 'painter',
    'sculptor', 'photographer', 'actor', 'singer', 'dancer', 'musician', 'clown',
    'magician', 'juggler', 'astronaut', 'vet', 'coach', 'referee', 'judge', 'lawyer',
    'banker', 'shopkeeper', 'cashier', 'mail carrier', 'garbage collector', 'janitor',
    'accountant', 'journalist', 'reporter', 'tailor', 'jeweler', 'watchmaker',
  ],
  games: [
    'hide and seek', 'tag', 'hopscotch', 'tug of war', 'puzzle', 'riddle', 'quiz',
    'board game', 'card game', 'dice', 'spinner', 'marble', 'yo-yo', 'hula hoop',
    'trampoline', 'seesaw', 'swing', 'slide', 'sandbox', 'sandcastle', 'snowman',
    'snowball', 'water balloon', 'paper plane', 'paper boat', 'origami', 'puppet',
    'robot toy', 'doll', 'teddy bear', 'blocks', 'toy bricks', 'domino', 'rubik cube',
    'video game', 'joystick', 'prize wheel', 'treasure map', 'treasure chest',
  ],
  clothing: [
    'shirt', 't-shirt', 'pants', 'jeans', 'shorts', 'skirt', 'dress', 'suit', 'coat',
    'jacket', 'sweater', 'hoodie', 'vest', 'socks', 'stockings', 'belt', 'tie', 'bow tie',
    'scarf', 'gloves', 'mittens', 'cap', 'helmet', 'sun hat', 'boots', 'sandals',
    'slippers', 'sneakers', 'high heels', 'pajamas', 'bathing suit', 'raincoat',
    'uniform', 'overalls', 'button', 'zipper', 'pocket', 'collar', 'sleeve', 'hood',
  ],
  body: [
    'head', 'face', 'eye', 'ear', 'nose', 'mouth', 'lip', 'tooth', 'tongue', 'chin',
    'cheek', 'forehead', 'eyebrow', 'eyelash', 'hair', 'neck', 'shoulder', 'arm',
    'elbow', 'wrist', 'hand', 'finger', 'thumb', 'fingernail', 'chest', 'back', 'waist',
    'belly', 'leg', 'knee', 'ankle', 'foot', 'toe', 'heel', 'skin', 'bone', 'heart',
    'brain', 'stomach', 'muscle', 'beard', 'mustache', 'freckles', 'shadow',
  ],
  weather: [
    'sun', 'moon', 'starry night', 'cloud', 'rain', 'snow', 'wind', 'storm', 'thunder',
    'lightning', 'fog', 'mist', 'hail', 'frost', 'ice', 'puddle', 'sunbeam',
    'sunrise', 'sunset', 'eclipse', 'aurora', 'comet', 'meteor', 'planet', 'galaxy',
    'sky', 'horizon', 'breeze', 'heat wave', 'cold snap', 'spring', 'summer', 'autumn',
    'winter', 'monsoon', 'drizzle', 'hurricane', 'tornado', 'blizzard',
  ],
  music: [
    'song', 'melody', 'rhythm', 'beat', 'note', 'chorus', 'microphone', 'speaker',
    'record player', 'harp', 'flute', 'clarinet', 'saxophone', 'harmonica', 'accordion',
    'banjo', 'ukulele', 'cymbals', 'tambourine', 'xylophone', 'organ',
    'concert', 'orchestra', 'band', 'choir', 'ballet', 'opera', 'curtain call',
  ],
  celebration: [
    'birthday', 'party', 'birthday candles', 'party hat', 'confetti', 'parade',
    'fireworks', 'carnival', 'festival', 'holiday', 'parade float', 'marching band',
    'costume', 'mask', 'piñata', 'streamers', 'greeting card', 'banner',     'wedding', 'bride', 'groom', 'bouquet', 'ring box', 'anniversary', 'graduation cap',
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
      // Reject empty fragments and anything with stray punctuation: prompts are
      // plain lowercase words/phrases only.
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
    this.remaining = shuffled(pool.length > 0 ? pool : words, random).map((entry) => entry.word);
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
