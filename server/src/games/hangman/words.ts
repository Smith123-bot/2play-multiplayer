/**
 * Server-owned Hangman dictionary.
 *
 * These words NEVER reach a client while a round is live — `getPublicState`
 * only ever sends the masked pattern. Each entry carries a short, spoiler-free
 * hint that is safe to show alongside the blanks.
 *
 * Words are plain uppercase A-Z (no spaces, accents or punctuation) so the
 * masking and letter matching stay trivial.
 */

export const HANGMAN_CATEGORIES = ['Animals', 'Countries', 'Food', 'Science', 'Sports', 'Objects'] as const;
export type HangmanCategory = (typeof HANGMAN_CATEGORIES)[number];

export interface HangmanEntry {
  word: string;
  hint: string;
}

export const HANGMAN_WORDS: Record<HangmanCategory, HangmanEntry[]> = {
  Animals: [
    { word: 'ELEPHANT', hint: 'The largest land animal' },
    { word: 'DOLPHIN', hint: 'A clever ocean swimmer' },
    { word: 'PENGUIN', hint: 'A bird that swims but cannot fly' },
    { word: 'GIRAFFE', hint: 'Tallest animal on the savanna' },
    { word: 'KANGAROO', hint: 'It carries its young in a pouch' },
    { word: 'BUTTERFLY', hint: 'It starts life as a caterpillar' },
    { word: 'CROCODILE', hint: 'An ancient river reptile' },
    { word: 'SQUIRREL', hint: 'It buries nuts for winter' },
    { word: 'HEDGEHOG', hint: 'A small animal covered in spines' },
    { word: 'FLAMINGO', hint: 'A pink bird that stands on one leg' },
    { word: 'OCTOPUS', hint: 'Eight arms and three hearts' },
    { word: 'CHEETAH', hint: 'The fastest land sprinter' },
  ],
  Countries: [
    { word: 'PORTUGAL', hint: 'Western edge of Europe' },
    { word: 'THAILAND', hint: 'Land of smiles in Southeast Asia' },
    { word: 'MOROCCO', hint: 'North African country with blue cities' },
    { word: 'DENMARK', hint: 'Scandinavian home of Lego' },
    { word: 'ARGENTINA', hint: 'Tango and vast pampas' },
    { word: 'MONGOLIA', hint: 'Famous for its steppe and yurts' },
    { word: 'ETHIOPIA', hint: 'Where coffee was first discovered' },
    { word: 'MALAYSIA', hint: 'Twin towers in its capital' },
    { word: 'ICELAND', hint: 'Volcanoes, geysers and long nights' },
    { word: 'COLOMBIA', hint: 'South American coffee producer' },
    { word: 'VIETNAM', hint: 'Known for pho and Ha Long Bay' },
    { word: 'AUSTRIA', hint: 'Alpine home of Mozart' },
  ],
  Food: [
    { word: 'PANCAKE', hint: 'Flat breakfast favourite' },
    { word: 'CHOCOLATE', hint: 'Made from cocoa beans' },
    { word: 'SPAGHETTI', hint: 'Long thin pasta' },
    { word: 'PINEAPPLE', hint: 'Spiky tropical fruit' },
    { word: 'SANDWICH', hint: 'Filling between two slices' },
    { word: 'AVOCADO', hint: 'Green fruit with a big stone' },
    { word: 'CINNAMON', hint: 'Warm spice from tree bark' },
    { word: 'DUMPLING', hint: 'Filled parcel of dough' },
    { word: 'BROCCOLI', hint: 'A little green tree on your plate' },
    { word: 'LASAGNE', hint: 'Layered baked pasta dish' },
    { word: 'PORRIDGE', hint: 'Warm oats for breakfast' },
    { word: 'MANDARIN', hint: 'Small easy-peel citrus' },
  ],
  Science: [
    { word: 'GRAVITY', hint: 'It keeps your feet on the ground' },
    { word: 'MOLECULE', hint: 'A group of bonded atoms' },
    { word: 'TELESCOPE', hint: 'It brings distant stars closer' },
    { word: 'VOLCANO', hint: 'A mountain that can erupt' },
    { word: 'ELECTRON', hint: 'A tiny negatively charged particle' },
    { word: 'MAGNETIC', hint: 'Describes a force that attracts iron' },
    { word: 'PHOTOSYNTHESIS', hint: 'How plants turn light into food' },
    { word: 'ASTEROID', hint: 'A rock orbiting the sun' },
    { word: 'BACTERIA', hint: 'Microscopic single-celled life' },
    { word: 'PENDULUM', hint: 'It swings back and forth' },
    { word: 'ECLIPSE', hint: 'When one body hides another' },
    { word: 'OXYGEN', hint: 'The gas you breathe in' },
  ],
  Sports: [
    { word: 'BASKETBALL', hint: 'Played with hoops and a bouncing ball' },
    { word: 'BADMINTON', hint: 'Racket sport with a shuttlecock' },
    { word: 'MARATHON', hint: 'A very long running race' },
    { word: 'SWIMMING', hint: 'Raced in lanes in a pool' },
    { word: 'CRICKET', hint: 'Bats, wickets and overs' },
    { word: 'CYCLING', hint: 'Two wheels and a lot of pedalling' },
    { word: 'ARCHERY', hint: 'Bow, arrow and a target' },
    { word: 'GYMNASTICS', hint: 'Beams, bars and floor routines' },
    { word: 'VOLLEYBALL', hint: 'A net sport played with the hands' },
    { word: 'SKATING', hint: 'Glide across ice or concrete' },
    { word: 'ROWING', hint: 'A boat race using oars' },
    { word: 'CLIMBING', hint: 'Going up walls or mountains' },
  ],
  Objects: [
    { word: 'UMBRELLA', hint: 'It keeps the rain off' },
    { word: 'KEYBOARD', hint: 'You type on it' },
    { word: 'LANTERN', hint: 'A portable light' },
    { word: 'COMPASS', hint: 'It always points north' },
    { word: 'BACKPACK', hint: 'Carried on your shoulders' },
    { word: 'TELEPHONE', hint: 'Used to call someone' },
    { word: 'MIRROR', hint: 'It shows your reflection' },
    { word: 'SCISSORS', hint: 'Two blades for cutting paper' },
    { word: 'BLANKET', hint: 'Keeps you warm on the sofa' },
    { word: 'CANDLE', hint: 'Wax with a wick' },
    { word: 'HAMMER', hint: 'For driving in nails' },
    { word: 'NOTEBOOK', hint: 'Bound pages for writing' },
  ],
};

/** Total distinct words available to the round generator. */
export const HANGMAN_WORD_COUNT = Object.values(HANGMAN_WORDS).reduce(
  (total, entries) => total + entries.length,
  0,
);
