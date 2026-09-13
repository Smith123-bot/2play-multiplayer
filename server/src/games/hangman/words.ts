/**
 * Server-owned Hangman dictionary.
 *
 * These words NEVER reach a client while a round is live — `getPublicState`
 * only ever sends the masked pattern. Each entry carries a short, spoiler-free
 * hint that is safe to show alongside the blanks.
 *
 * Words are plain uppercase A-Z (no spaces, accents or punctuation) so the
 * masking and letter matching stay trivial.
 *
 * ## Tiers
 *
 * Every entry declares a `tier`. `easy` is reserved for words a casual player
 * genuinely knows — short, everyday vocabulary (animals, food, colours, common
 * objects, simple actions, places, nature, the body). Obscure words are NOT
 * used to pad the pool: they are tiered `hard` and only appear late in a match.
 *
 * Round difficulty escalates with match progress (see `tierForRound`), so an
 * early round plays CAT and a final round plays PHOTOSYNTHESIS.
 *
 * The pool is deliberately large relative to a match (5 rounds by default) so
 * that repetition across rounds and across games is uncommon even before the
 * anti-repeat bag in `beginRound` is taken into account.
 */

export type WordTier = 'easy' | 'medium' | 'hard';

export const HANGMAN_CATEGORIES = [
  'Animals',
  'Food',
  'Colours',
  'Objects',
  'Nature',
  'Places',
  'Actions',
  'Body',
  'Countries',
  'Science',
  'Sports',
] as const;
export type HangmanCategory = (typeof HANGMAN_CATEGORIES)[number];

export interface HangmanEntry {
  word: string;
  hint: string;
  tier: WordTier;
}

export const HANGMAN_WORDS: Record<HangmanCategory, HangmanEntry[]> = {
  Animals: [
    { word: 'CAT', hint: 'A pet that purrs', tier: 'easy' },
    { word: 'DOG', hint: 'A pet that barks', tier: 'easy' },
    { word: 'FISH', hint: 'It lives in water', tier: 'easy' },
    { word: 'BIRD', hint: 'It has wings and feathers', tier: 'easy' },
    { word: 'DUCK', hint: 'It says quack', tier: 'easy' },
    { word: 'FROG', hint: 'A green hopper near ponds', tier: 'easy' },
    { word: 'LION', hint: 'King of the jungle', tier: 'easy' },
    { word: 'BEAR', hint: 'A big furry animal that likes honey', tier: 'easy' },
    { word: 'HORSE', hint: 'You can ride it', tier: 'easy' },
    { word: 'SHEEP', hint: 'It gives us wool', tier: 'easy' },
    { word: 'MOUSE', hint: 'A tiny animal that likes cheese', tier: 'easy' },
    { word: 'RABBIT', hint: 'Long ears and a fluffy tail', tier: 'easy' },
    { word: 'TIGER', hint: 'A big striped cat', tier: 'easy' },
    { word: 'ZEBRA', hint: 'Black and white stripes', tier: 'easy' },
    { word: 'MONKEY', hint: 'It swings from trees', tier: 'easy' },
    { word: 'ELEPHANT', hint: 'The largest land animal', tier: 'medium' },
    { word: 'DOLPHIN', hint: 'A clever ocean swimmer', tier: 'medium' },
    { word: 'PENGUIN', hint: 'A bird that swims but cannot fly', tier: 'medium' },
    { word: 'GIRAFFE', hint: 'Tallest animal on the savanna', tier: 'medium' },
    { word: 'BUTTERFLY', hint: 'It starts life as a caterpillar', tier: 'medium' },
    { word: 'OCTOPUS', hint: 'Eight arms and three hearts', tier: 'medium' },
    { word: 'KANGAROO', hint: 'It carries its young in a pouch', tier: 'hard' },
    { word: 'CROCODILE', hint: 'An ancient river reptile', tier: 'hard' },
    { word: 'SQUIRREL', hint: 'It buries nuts for winter', tier: 'hard' },
    { word: 'HEDGEHOG', hint: 'A small animal covered in spines', tier: 'hard' },
    { word: 'FLAMINGO', hint: 'A pink bird that stands on one leg', tier: 'hard' },
    { word: 'CHEETAH', hint: 'The fastest land sprinter', tier: 'hard' },
  ],
  Food: [
    { word: 'CAKE', hint: 'Sweet treat for birthdays', tier: 'easy' },
    { word: 'SOUP', hint: 'Warm liquid in a bowl', tier: 'easy' },
    { word: 'RICE', hint: 'A grain eaten all over the world', tier: 'easy' },
    { word: 'MILK', hint: 'A white drink from cows', tier: 'easy' },
    { word: 'BREAD', hint: 'Used for toast and sandwiches', tier: 'easy' },
    { word: 'APPLE', hint: 'A round red or green fruit', tier: 'easy' },
    { word: 'EGG', hint: 'Fried, boiled or scrambled', tier: 'easy' },
    { word: 'PIZZA', hint: 'Round, cheesy and sliced', tier: 'easy' },
    { word: 'CANDY', hint: 'A sweet you suck on', tier: 'easy' },
    { word: 'LEMON', hint: 'A sour yellow fruit', tier: 'easy' },
    { word: 'MANGO', hint: 'A sweet tropical fruit', tier: 'easy' },
    { word: 'HONEY', hint: 'Made by bees', tier: 'easy' },
    { word: 'CHEESE', hint: 'Goes on top of pizza', tier: 'easy' },
    { word: 'BANANA', hint: 'A long yellow fruit', tier: 'easy' },
    { word: 'CARROT', hint: 'An orange vegetable rabbits love', tier: 'easy' },
    { word: 'POTATO', hint: 'Made into chips and mash', tier: 'easy' },
    { word: 'TOMATO', hint: 'A red fruit used in sauce', tier: 'easy' },
    { word: 'PANCAKE', hint: 'Flat breakfast favourite', tier: 'easy' },
    { word: 'CHOCOLATE', hint: 'Made from cocoa beans', tier: 'easy' },
    { word: 'SANDWICH', hint: 'Filling between two slices', tier: 'easy' },
    { word: 'SPAGHETTI', hint: 'Long thin pasta', tier: 'medium' },
    { word: 'PINEAPPLE', hint: 'Spiky tropical fruit', tier: 'medium' },
    { word: 'AVOCADO', hint: 'Green fruit with a big stone', tier: 'medium' },
    { word: 'BROCCOLI', hint: 'A little green tree on your plate', tier: 'medium' },
    { word: 'DUMPLING', hint: 'Filled parcel of dough', tier: 'medium' },
    { word: 'CINNAMON', hint: 'Warm spice from tree bark', tier: 'hard' },
    { word: 'LASAGNE', hint: 'Layered baked pasta dish', tier: 'hard' },
    { word: 'PORRIDGE', hint: 'Warm oats for breakfast', tier: 'hard' },
    { word: 'MANDARIN', hint: 'Small easy-peel citrus', tier: 'hard' },
  ],
  Colours: [
    { word: 'RED', hint: 'The colour of a rose', tier: 'easy' },
    { word: 'BLUE', hint: 'The colour of the sky', tier: 'easy' },
    { word: 'GREEN', hint: 'The colour of grass', tier: 'easy' },
    { word: 'BLACK', hint: 'The darkest colour', tier: 'easy' },
    { word: 'WHITE', hint: 'The colour of snow', tier: 'easy' },
    { word: 'PINK', hint: 'A pale shade of red', tier: 'easy' },
    { word: 'BROWN', hint: 'The colour of chocolate', tier: 'easy' },
    { word: 'GREY', hint: 'Between black and white', tier: 'easy' },
    { word: 'ORANGE', hint: 'The colour of a pumpkin', tier: 'easy' },
    { word: 'YELLOW', hint: 'The colour of the sun', tier: 'easy' },
    { word: 'PURPLE', hint: 'Mix of red and blue', tier: 'easy' },
    { word: 'VIOLET', hint: 'A blue-purple flower colour', tier: 'medium' },
    { word: 'SILVER', hint: 'A shiny metallic grey', tier: 'medium' },
    { word: 'GOLDEN', hint: 'The colour of honey', tier: 'medium' },
  ],
  Objects: [
    { word: 'CUP', hint: 'You drink tea from it', tier: 'easy' },
    { word: 'BOOK', hint: 'You read it', tier: 'easy' },
    { word: 'KEY', hint: 'It opens a lock', tier: 'easy' },
    { word: 'BAG', hint: 'You carry things in it', tier: 'easy' },
    { word: 'PEN', hint: 'You write with it', tier: 'easy' },
    { word: 'CHAIR', hint: 'You sit on it', tier: 'easy' },
    { word: 'TABLE', hint: 'Furniture you eat at', tier: 'easy' },
    { word: 'CLOCK', hint: 'It tells the time', tier: 'easy' },
    { word: 'PHONE', hint: 'You call people with it', tier: 'easy' },
    { word: 'DOOR', hint: 'You walk through it', tier: 'easy' },
    { word: 'LAMP', hint: 'It lights a room', tier: 'easy' },
    { word: 'BOX', hint: 'A container with four sides', tier: 'easy' },
    { word: 'SPOON', hint: 'Used for soup', tier: 'easy' },
    { word: 'PLATE', hint: 'Food is served on it', tier: 'easy' },
    { word: 'GLASS', hint: 'A clear cup for water', tier: 'easy' },
    { word: 'BALL', hint: 'Round toy you throw', tier: 'easy' },
    { word: 'KITE', hint: 'Flies on a windy day', tier: 'easy' },
    { word: 'COAT', hint: 'Keeps you warm outside', tier: 'easy' },
    { word: 'SHOE', hint: 'Worn on your foot', tier: 'easy' },
    { word: 'SOFA', hint: 'A long soft seat', tier: 'easy' },
    { word: 'MIRROR', hint: 'It shows your reflection', tier: 'easy' },
    { word: 'CANDLE', hint: 'Wax with a wick', tier: 'easy' },
    { word: 'HAMMER', hint: 'For driving in nails', tier: 'easy' },
    { word: 'BLANKET', hint: 'Keeps you warm on the sofa', tier: 'medium' },
    { word: 'UMBRELLA', hint: 'It keeps the rain off', tier: 'medium' },
    { word: 'KEYBOARD', hint: 'You type on it', tier: 'medium' },
    { word: 'BACKPACK', hint: 'Carried on your shoulders', tier: 'medium' },
    { word: 'SCISSORS', hint: 'Two blades for cutting paper', tier: 'medium' },
    { word: 'NOTEBOOK', hint: 'Bound pages for writing', tier: 'medium' },
    { word: 'LANTERN', hint: 'A portable light', tier: 'hard' },
    { word: 'COMPASS', hint: 'It always points north', tier: 'hard' },
    { word: 'TELEPHONE', hint: 'Used to call someone', tier: 'hard' },
  ],
  Nature: [
    { word: 'SUN', hint: 'It shines during the day', tier: 'easy' },
    { word: 'MOON', hint: 'It shines at night', tier: 'easy' },
    { word: 'STAR', hint: 'It twinkles at night', tier: 'easy' },
    { word: 'TREE', hint: 'It has leaves and branches', tier: 'easy' },
    { word: 'RAIN', hint: 'Water falling from clouds', tier: 'easy' },
    { word: 'SNOW', hint: 'Cold white flakes', tier: 'easy' },
    { word: 'SEA', hint: 'A large body of salt water', tier: 'easy' },
    { word: 'RIVER', hint: 'Water that flows to the sea', tier: 'easy' },
    { word: 'CLOUD', hint: 'Floating in the sky', tier: 'easy' },
    { word: 'GRASS', hint: 'Green ground in a park', tier: 'easy' },
    { word: 'LEAF', hint: 'It grows on a tree', tier: 'easy' },
    { word: 'FLOWER', hint: 'A colourful plant with petals', tier: 'easy' },
    { word: 'STONE', hint: 'A small piece of rock', tier: 'easy' },
    { word: 'WIND', hint: 'Moving air you can feel', tier: 'easy' },
    { word: 'FOREST', hint: 'A large area of trees', tier: 'medium' },
    { word: 'ISLAND', hint: 'Land surrounded by water', tier: 'medium' },
    { word: 'DESERT', hint: 'A very dry sandy place', tier: 'medium' },
    { word: 'RAINBOW', hint: 'Colourful arc after rain', tier: 'medium' },
    { word: 'THUNDER', hint: 'The sound in a storm', tier: 'medium' },
    { word: 'VOLCANO', hint: 'A mountain that can erupt', tier: 'hard' },
    { word: 'GLACIER', hint: 'A slow river of ice', tier: 'hard' },
    { word: 'AVALANCHE', hint: 'Snow sliding down a mountain', tier: 'hard' },
  ],
  Places: [
    { word: 'HOME', hint: 'Where you live', tier: 'easy' },
    { word: 'PARK', hint: 'Green space in a town', tier: 'easy' },
    { word: 'SHOP', hint: 'Where you buy things', tier: 'easy' },
    { word: 'SCHOOL', hint: 'Where children learn', tier: 'easy' },
    { word: 'FARM', hint: 'Where animals are kept', tier: 'easy' },
    { word: 'CITY', hint: 'A very large town', tier: 'easy' },
    { word: 'STREET', hint: 'A road in a town', tier: 'easy' },
    { word: 'BEACH', hint: 'Sandy place to swim', tier: 'easy' },
    { word: 'MARKET', hint: 'Where food is sold outdoors', tier: 'easy' },
    { word: 'CAFE', hint: 'Where you buy coffee', tier: 'easy' },
    { word: 'HOSPITAL', hint: 'Where doctors work', tier: 'medium' },
    { word: 'AIRPORT', hint: 'Where planes take off', tier: 'medium' },
    { word: 'LIBRARY', hint: 'Where books are borrowed', tier: 'medium' },
    { word: 'STADIUM', hint: 'A large sports arena', tier: 'medium' },
    { word: 'VILLAGE', hint: 'A very small town', tier: 'medium' },
    { word: 'CASTLE', hint: 'A large old fortified building', tier: 'medium' },
  ],
  Actions: [
    { word: 'RUN', hint: 'Move fast on your feet', tier: 'easy' },
    { word: 'JUMP', hint: 'Leave the ground', tier: 'easy' },
    { word: 'SWIM', hint: 'Move through water', tier: 'easy' },
    { word: 'READ', hint: 'Look at words in a book', tier: 'easy' },
    { word: 'SING', hint: 'Make music with your voice', tier: 'easy' },
    { word: 'DANCE', hint: 'Move to music', tier: 'easy' },
    { word: 'SLEEP', hint: 'Rest with your eyes closed', tier: 'easy' },
    { word: 'EAT', hint: 'Put food in your mouth', tier: 'easy' },
    { word: 'DRINK', hint: 'Swallow a liquid', tier: 'easy' },
    { word: 'WALK', hint: 'Move at a normal pace', tier: 'easy' },
    { word: 'PLAY', hint: 'Have fun with a game', tier: 'easy' },
    { word: 'DRAW', hint: 'Make a picture with a pen', tier: 'easy' },
    { word: 'COOK', hint: 'Prepare food with heat', tier: 'easy' },
    { word: 'WRITE', hint: 'Put words on paper', tier: 'easy' },
    { word: 'CLIMB', hint: 'Go up something', tier: 'easy' },
    { word: 'THROW', hint: 'Send a ball through the air', tier: 'easy' },
    { word: 'CATCH', hint: 'Grab a ball out of the air', tier: 'easy' },
    { word: 'LAUGH', hint: 'React to something funny', tier: 'easy' },
    { word: 'LISTEN', hint: 'Pay attention to sound', tier: 'medium' },
    { word: 'TRAVEL', hint: 'Go on a journey', tier: 'medium' },
    { word: 'BUILD', hint: 'Put parts together', tier: 'medium' },
    { word: 'EXPLORE', hint: 'Search a new place', tier: 'medium' },
    { word: 'CELEBRATE', hint: 'Mark a special occasion', tier: 'hard' },
    { word: 'WHISTLE', hint: 'Make a high sound with your lips', tier: 'hard' },
  ],
  Body: [
    { word: 'HAND', hint: 'At the end of your arm', tier: 'easy' },
    { word: 'FOOT', hint: 'You stand on it', tier: 'easy' },
    { word: 'NOSE', hint: 'You smell with it', tier: 'easy' },
    { word: 'EYE', hint: 'You see with it', tier: 'easy' },
    { word: 'EAR', hint: 'You hear with it', tier: 'easy' },
    { word: 'MOUTH', hint: 'You eat and speak with it', tier: 'easy' },
    { word: 'ARM', hint: 'Between shoulder and hand', tier: 'easy' },
    { word: 'LEG', hint: 'You walk on it', tier: 'easy' },
    { word: 'HEAD', hint: 'The top part of your body', tier: 'easy' },
    { word: 'HAIR', hint: 'It grows on your head', tier: 'easy' },
    { word: 'TOOTH', hint: 'You chew with it', tier: 'easy' },
    { word: 'NECK', hint: 'Joins head to shoulders', tier: 'easy' },
    { word: 'FINGER', hint: 'One of ten on your hands', tier: 'medium' },
    { word: 'SHOULDER', hint: 'Where your arm joins your body', tier: 'medium' },
    { word: 'STOMACH', hint: 'Where your food goes', tier: 'medium' },
    { word: 'KNEE', hint: 'The middle joint of your leg', tier: 'medium' },
    { word: 'ELBOW', hint: 'The middle joint of your arm', tier: 'medium' },
  ],
  Countries: [
    { word: 'INDIA', hint: 'Home of the Taj Mahal', tier: 'medium' },
    { word: 'JAPAN', hint: 'Land of the rising sun', tier: 'medium' },
    { word: 'EGYPT', hint: 'Land of the pyramids', tier: 'medium' },
    { word: 'BRAZIL', hint: 'The largest South American country', tier: 'medium' },
    { word: 'CANADA', hint: 'Famous for maple syrup', tier: 'medium' },
    { word: 'FRANCE', hint: 'Home of the Eiffel Tower', tier: 'medium' },
    { word: 'SPAIN', hint: 'Iberian country famous for flamenco', tier: 'medium' },
    { word: 'KENYA', hint: 'East African safari destination', tier: 'medium' },
    { word: 'GREECE', hint: 'Birthplace of the Olympics', tier: 'medium' },
    { word: 'TURKEY', hint: 'Country spanning two continents', tier: 'medium' },
    { word: 'PORTUGAL', hint: 'Western edge of Europe', tier: 'hard' },
    { word: 'THAILAND', hint: 'Land of smiles in Southeast Asia', tier: 'hard' },
    { word: 'MOROCCO', hint: 'North African country with blue cities', tier: 'hard' },
    { word: 'MONGOLIA', hint: 'Famous for its steppe and yurts', tier: 'hard' },
    { word: 'ETHIOPIA', hint: 'Where coffee was first discovered', tier: 'hard' },
    { word: 'DENMARK', hint: 'Scandinavian home of Lego', tier: 'hard' },
    { word: 'ARGENTINA', hint: 'Tango and vast pampas', tier: 'hard' },
    { word: 'MALAYSIA', hint: 'Twin towers in its capital', tier: 'hard' },
    { word: 'ICELAND', hint: 'Volcanoes, geysers and long nights', tier: 'hard' },
    { word: 'COLOMBIA', hint: 'South American coffee producer', tier: 'hard' },
    { word: 'VIETNAM', hint: 'Known for pho and Ha Long Bay', tier: 'hard' },
    { word: 'AUSTRIA', hint: 'Alpine home of Mozart', tier: 'hard' },
  ],
  Science: [
    { word: 'ATOM', hint: 'The smallest unit of matter', tier: 'medium' },
    { word: 'ENERGY', hint: 'The ability to do work', tier: 'medium' },
    { word: 'PLANET', hint: 'The Earth is one', tier: 'medium' },
    { word: 'OXYGEN', hint: 'The gas you breathe in', tier: 'medium' },
    { word: 'ECLIPSE', hint: 'When one body hides another', tier: 'medium' },
    { word: 'GRAVITY', hint: 'It keeps your feet on the ground', tier: 'medium' },
    { word: 'MAGNET', hint: 'It attracts iron', tier: 'medium' },
    { word: 'FOSSIL', hint: 'Preserved remains of ancient life', tier: 'medium' },
    { word: 'MOLECULE', hint: 'A group of bonded atoms', tier: 'hard' },
    { word: 'TELESCOPE', hint: 'It brings distant stars closer', tier: 'hard' },
    { word: 'ELECTRON', hint: 'A tiny negatively charged particle', tier: 'hard' },
    { word: 'MAGNETIC', hint: 'Describes a force that attracts iron', tier: 'hard' },
    { word: 'ASTEROID', hint: 'A rock orbiting the sun', tier: 'hard' },
    { word: 'BACTERIA', hint: 'Microscopic single-celled life', tier: 'hard' },
    { word: 'PENDULUM', hint: 'It swings back and forth', tier: 'hard' },
    { word: 'PHOTOSYNTHESIS', hint: 'How plants turn light into food', tier: 'hard' },
  ],
  Sports: [
    { word: 'SOCCER', hint: 'The world game, played with a ball', tier: 'easy' },
    { word: 'TENNIS', hint: 'Played with a racket and a net', tier: 'easy' },
    { word: 'HOCKEY', hint: 'Played on ice with a stick', tier: 'easy' },
    { word: 'RUGBY', hint: 'An oval ball and tackling', tier: 'easy' },
    { word: 'GOLF', hint: 'Clubs, holes and a small white ball', tier: 'easy' },
    { word: 'BOXING', hint: 'A fighting sport with gloves', tier: 'easy' },
    { word: 'SKATING', hint: 'Glide across ice or concrete', tier: 'easy' },
    { word: 'ROWING', hint: 'A boat race using oars', tier: 'easy' },
    { word: 'CRICKET', hint: 'Bats, wickets and overs', tier: 'medium' },
    { word: 'CYCLING', hint: 'Two wheels and a lot of pedalling', tier: 'medium' },
    { word: 'ARCHERY', hint: 'Bow, arrow and a target', tier: 'medium' },
    { word: 'SWIMMING', hint: 'Raced in lanes in a pool', tier: 'medium' },
    { word: 'CLIMBING', hint: 'Going up walls or mountains', tier: 'medium' },
    { word: 'MARATHON', hint: 'A very long running race', tier: 'medium' },
    { word: 'VOLLEYBALL', hint: 'A net sport played with the hands', tier: 'medium' },
    { word: 'BASKETBALL', hint: 'Played with hoops and a bouncing ball', tier: 'medium' },
    { word: 'BADMINTON', hint: 'Racket sport with a shuttlecock', tier: 'hard' },
    { word: 'GYMNASTICS', hint: 'Beams, bars and floor routines', tier: 'hard' },
  ],
};

/** Total distinct words available to the round generator. */
export const HANGMAN_WORD_COUNT = Object.values(HANGMAN_WORDS).reduce(
  (total, entries) => total + entries.length,
  0,
);

/** Every entry flattened, for pool-wide selection and tests. */
export function allHangmanEntries(): Array<HangmanEntry & { category: HangmanCategory }> {
  return (Object.keys(HANGMAN_WORDS) as HangmanCategory[]).flatMap((category) =>
    HANGMAN_WORDS[category].map((entry) => ({ ...entry, category })),
  );
}

/** How many words sit in each tier. */
export function hangmanTierCounts(): Record<WordTier, number> {
  const counts: Record<WordTier, number> = { easy: 0, medium: 0, hard: 0 };
  for (const entry of allHangmanEntries()) counts[entry.tier] += 1;
  return counts;
}

/**
 * Escalates difficulty with match progress, mirroring draw-guess: the first
 * third of a match is easy, the middle third medium, the final third hard.
 *
 * `round` is 1-based and `totalRounds` is at least 1. A single-round match
 * plays easy, so a short game is never punishing.
 */
export function tierForRound(round: number, totalRounds: number): WordTier {
  const total = Math.max(1, totalRounds);
  const progress = (Math.max(1, round) - 1) / total;
  if (progress < 1 / 3) return 'easy';
  if (progress < 2 / 3) return 'medium';
  return 'hard';
}

/**
 * Picks a word for a round, honouring the tier and excluding words already used
 * in this match.
 *
 * Falls back progressively — unused words in the tier, then any word in the
 * tier, then the whole dictionary — so a round can never fail to deal a word,
 * even if a match runs longer than the pool.
 */
export function pickHangmanWord(
  used: readonly string[],
  random: () => number,
  tier: WordTier,
): HangmanEntry & { category: HangmanCategory } {
  const entries = allHangmanEntries();
  const inTier = entries.filter((entry) => entry.tier === tier);
  const unused = inTier.filter((entry) => !used.includes(entry.word));
  const pool = unused.length > 0 ? unused : inTier.length > 0 ? inTier : entries;
  return pool[Math.floor(random() * pool.length)]!;
}
