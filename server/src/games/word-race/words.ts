/**
 * Server-owned dictionaries.
 *
 * Clients can NEVER define a valid word: submissions are matched against these
 * lists on the server only (spec §38).
 */
export const WORD_CATEGORIES = ['Animals', 'Countries', 'Foods', 'Sports', 'Objects', 'Nature'] as const;
export type WordCategory = (typeof WORD_CATEGORIES)[number];

export const WORD_LISTS: Record<WordCategory, readonly string[]> = {
  Animals: [
    'lion','tiger','elephant','giraffe','zebra','monkey','kangaroo','dolphin','whale','shark',
    'eagle','owl','parrot','penguin','bear','wolf','fox','deer','rabbit','horse',
    'camel','panda','koala','otter','turtle','frog','snake','lizard','crocodile','hippo',
    'rhino','cheetah','leopard','panther','gorilla','sloth','moose','bison','antelope','gazelle',
    'raccoon','squirrel','hedgehog','badger','beaver','seal','walrus','octopus','crab','lobster',
    'butterfly','bee','ant','spider','mosquito','peacock','flamingo','swan','duck','goose',
    'chicken','rooster','cow','sheep','goat','pig','donkey','llama','ferret','hamster',
  ],
  Countries: [
    'france','germany','spain','italy','portugal','brazil','argentina','chile','mexico','canada',
    'japan','china','india','egypt','kenya','nigeria','ghana','morocco','turkey','greece',
    'poland','sweden','norway','finland','denmark','ireland','scotland','england','wales','australia',
    'russia','ukraine','austria','switzerland','belgium','netherlands','thailand','vietnam','korea','indonesia',
    'philippines','malaysia','singapore','pakistan','bangladesh','nepal','peru','cuba','jamaica','haiti',
    'bolivia','ecuador','uruguay','paraguay','colombia','venezuela','panama','ireland','iceland','malta',
    'cyprus','israel','jordan','lebanon','qatar','kuwait','oman','yemen','sudan','ethiopia',
    'tanzania','uganda','zimbabwe','zambia','botswana','namibia','senegal','tunisia','algeria','libya',
  ],
  Foods: [
    'pizza','pasta','burger','sushi','taco','burrito','salad','soup','sandwich','rice',
    'noodles','bread','cheese','butter','chocolate','pancake','waffle','cereal','yogurt','honey',
    'jam','steak','bacon','sausage','chicken','fish','shrimp','eggplant','carrot','potato',
    'tomato','onion','garlic','pepper','cucumber','lettuce','broccoli','mushroom','apple','banana',
    'orange','grape','strawberry','mango','pineapple','watermelon','peach','pear','cherry','lemon',
    'lime','coconut','almond','peanut','walnut','cookie','cake','donut','muffin','croissant',
    'bagel','hummus','curry','kebab','dumpling','porridge','pudding','popcorn','pretzel','waffles',
  ],
  Sports: [
    'soccer','football','basketball','baseball','tennis','golf','cricket','rugby','hockey','volleyball',
    'swimming','running','cycling','boxing','wrestling','judo','karate','fencing','archery','skiing',
    'snowboarding','surfing','skating','rowing','sailing','climbing','hiking','badminton','squash','handball',
    'polo','bowling','darts','snooker','billiards','gymnastics','athletics','triathlon','marathon','sprint',
    'kayaking','rafting','motocross','rally','cricket','netball','softball','lacrosse','sumo','taekwondo',
    'surf','canoeing','paragliding','bungee','skateboarding','bmx','equestrian','biathlon','decathlon','pentathlon',
  ],
  Objects: [
    'chair','table','sofa','lamp','mirror','clock','phone','laptop','keyboard','mouse',
    'camera','radio','television','fridge','oven','microwave','kettle','toaster','blender','vacuum',
    'broom','bucket','ladder','hammer','screwdriver','wrench','nail','rope','tape','scissors',
    'pencil','pen','eraser','notebook','book','magazine','newspaper','envelope','stamp','wallet',
    'keys','umbrella','backpack','suitcase','pillow','blanket','towel','curtain','carpet','vase',
    'candle','basket','bottle','cup','mug','plate','bowl','spoon','fork','knife',
    'pot','pan','speaker','headphones','charger','remote','battery','cable','router','printer',
  ],
  Nature: [
    'river','lake','ocean','mountain','valley','forest','desert','island','canyon','waterfall',
    'glacier','volcano','beach','cliff','cave','meadow','swamp','marsh','jungle','savanna',
    'tundra','prairie','hill','plain','creek','pond','stream','spring','geyser','rainbow',
    'cloud','storm','thunder','lightning','rain','snow','hail','frost','fog','mist',
    'wind','breeze','hurricane','tornado','sunrise','sunset','moon','star','planet','comet',
    'meteor','aurora','coral','reef','dune','oasis','cavern','plateau','ridge','glade',
  ],
};

export function normalizeWord(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ');
}

export function isValidWord(category: WordCategory, word: string): boolean {
  const normalized = normalizeWord(word);
  return WORD_LISTS[category].includes(normalized);
}

export function wordsFor(category: WordCategory): readonly string[] {
  return WORD_LISTS[category];
}

export function allWords(): string[] {
  return Object.values(WORD_LISTS).flat();
}
