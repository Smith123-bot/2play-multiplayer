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
    // --- Original ---
    'lion','tiger','elephant','giraffe','zebra','monkey','kangaroo','dolphin','whale','shark',
    'eagle','owl','parrot','penguin','bear','wolf','fox','deer','rabbit','horse',
    'camel','panda','koala','otter','turtle','frog','snake','lizard','crocodile','hippo',
    'rhino','cheetah','leopard','panther','gorilla','sloth','moose','bison','antelope','gazelle',
    'raccoon','squirrel','hedgehog','badger','beaver','seal','walrus','octopus','crab','lobster',
    'butterfly','bee','ant','spider','mosquito','peacock','flamingo','swan','duck','goose',
    'chicken','rooster','cow','sheep','goat','pig','donkey','llama','ferret','hamster',
    // --- Expanded Common Animals & Insects ---
    'dog','cat','mouse','rat','bat','hyena','jackal','coyote','bison','elk','reindeer',
    'yak','alpaca','mule','pony','leopard','cheetah','hyena','baboon','chimpanzee','lemur',
    'hedgehog','mole','shrew','porcupine','armadillo','platypus','walrus','manatee','narwhal',
    'stingray','jellyfish','starfish','snail','worm','caterpillar','ladybug','fly','wasp',
    'hornet','moth','turkey','stork','heron','ostrich','falcon','hawk','woodpecker','sparrow',
    'robin','swallow','canary','pelican','seagull','vulture','pigeon','crow','magpie','cuckoo',
    'woodpecker','nightingale','swan','turkey','quail','partridge','pheasant','peafowl','condor',
    'viper','python','cobra','iguana','gecko','chameleon','alligator','tortoise','newt','salamander',
    'tadpole','carp','salmon','tuna','trout','goldfish','catfish','eel','jellyfish','squid',
    'oyster','clam','mussel','snail','slug','centipede','millipede','scorpion','beetle','grasshopper',
    'cricket','termite','flea','tick','louse','aphid','dragonfly','firefly','cicada','bumblebee',
  ],
  Countries: [
    // --- Original ---
    'france','germany','spain','italy','portugal','brazil','argentina','chile','mexico','canada',
    'japan','china','india','egypt','kenya','nigeria','ghana','morocco','turkey','greece',
    'poland','sweden','norway','finland','denmark','ireland','scotland','england','wales','australia',
    'russia','ukraine','austria','switzerland','belgium','netherlands','thailand','vietnam','korea','indonesia',
    'philippines','malaysia','singapore','pakistan','bangladesh','nepal','peru','cuba','jamaica','haiti',
    'bolivia','ecuador','uruguay','paraguay','colombia','venezuela','panama','ireland','iceland','malta',
    'cyprus','israel','jordan','lebanon','qatar','kuwait','oman','yemen','sudan','ethiopia',
    'tanzania','uganda','zimbabwe','zambia','botswana','namibia','senegal','tunisia','algeria','libya',
    // --- Expanded Common Countries ---
    'usa','america','uk','brazil','mexico','cuba','honduras','guatemala','nicaragua','costarica',
    'bahamas','barbadors','trinidad','guyana','suriname','haiti','dominican','puerto','greenland',
    'iceland','norway','sweden','finland','denmark','estonia','latvia','lithuania','belarus',
    'ukraine','moldova','romania','bulgaria','serbia','croatia','slovenia','slovakia','hungary',
    'czechia','austria','switzerland','germany','poland','netherlands','belgium','luxembourg',
    'france','monaco','spain','portugal','andorra','italy','vatican','sanmarino','malta','greece',
    'albania','macedonia','montenegro','bosnia','cyprus','turkey','syria','lebanon','israel',
    'palestine','jordan','iraq','iran','saudiarabia','yemen','oman','uae','qatar','bahrain',
    'kuwait','egypt','libya','tunisia','algeria','morocco','sudan','ethiopia','somalia','kenya',
    'uganda','tanzania','rwanda','burundi','congo','angola','zambia','zimbabwe','botswana',
    'namibia','southafrica','madagascar','mozambique','malawi','cameroon','nigeria','ghana',
    'ivorycoast','senegal','mali','niger','chad','afghanistan','pakistan','india','nepal','bhutan',
    'bangladesh','srilanka','maldives','china','mongolia','japan','northkorea','southkorea',
    'taiwan','myanmar','thailand','laos','cambodia','vietnam','malaysia','singapore','indonesia',
    'brunei','philippines','timor','australia','newzealand','fiji','papuanewguinea','samoa','tonga',
  ],
  Foods: [
    // --- Original ---
    'pizza','pasta','burger','sushi','taco','burrito','salad','soup','sandwich','rice',
    'noodles','bread','cheese','butter','chocolate','pancake','waffle','cereal','yogurt','honey',
    'jam','steak','bacon','sausage','chicken','fish','shrimp','eggplant','carrot','potato',
    'tomato','onion','garlic','pepper','cucumber','lettuce','broccoli','mushroom','apple','banana',
    'orange','grape','strawberry','mango','pineapple','watermelon','peach','pear','cherry','lemon',
    'lime','coconut','almond','peanut','walnut','cookie','cake','donut','muffin','croissant',
    'bagel','hummus','curry','kebab','dumpling','porridge','pudding','popcorn','pretzel','waffles',
    // --- Expanded Common Foods, Fruits, Vegetables & Drinks ---
    'papaya','guava','plum','kiwi','fig','date','apricot','pomegranate','blackberry','blueberry',
    'raspberry','cranberry','cantaloupe','honeydew','radish','beetroot','cabbage','cauliflower',
    'spinach','celery','zucchini','pumpkin','squash','peas','beans','lentils','chickpeas','oats',
    'barley','corn','flour','paneer','curd','cream','egg','mutton','prawn','crab','lobster',
    'salt','sugar','oil','ghee','vinegar','sauce','ketchup','mayonnaise','mustard','pickle',
    'tea','coffee','milk','juice','soda','water','lemonade','smoothie','shake','wine','beer',
    'whisky','vodka','biscuit','pastry','brownie','pie','tart','pudding','custard','icecream',
    'candytoffee','marshmallow','chewinggum','nachos','hotdog','wrap','lasagna','risotto','paella',
    'stew','broth','omelet','pancake','crepe','toast','cereal','oatmeal','pulao','biryani','daal',
    'roti','chapati','naan','paratha','samosa','pakora','momos','springroll','chowmein','manchurian',
  ],
  Sports: [
    // --- Original ---
    'soccer','football','basketball','baseball','tennis','golf','cricket','rugby','hockey','volleyball',
    'swimming','running','cycling','boxing','wrestling','judo','karate','fencing','archery','skiing',
    'snowboarding','surfing','skating','rowing','sailing','climbing','hiking','badminton','squash','handball',
    'polo','bowling','darts','snooker','billiards','gymnastics','athletics','triathlon','marathon','sprint',
    'kayaking','rafting','motocross','rally','cricket','netball','softball','lacrosse','sumo','taekwondo',
    'surf','canoeing','paragliding','bungee','skateboarding','bmx','equestrian','biathlon','decathlon','pentathlon',
    // --- Expanded Common Sports & Games ---
    'basketball','badminton','tennis','tabletennis','pingpong','volleyball','baseball','softball',
    'rugby','americanfootball','cricket','hockey','fieldhockey','icehockey','golf','swimming','diving',
    'waterpolo','surfing','windsurfing','kitesurfing','sailing','rowing','canoeing','kayaking','skiing',
    'snowboarding','skating','figureskating','ice-skating','skateboard','cycling','mountainbiking',
    'bmx','running','jogging','sprinting','marathon','triathlon','athletics','gymnastics','weightlifting',
    'powerlifting','bodybuilding','boxing','wrestling','judo','karate','taekwondo','kungfu','aikido',
    'fencing','archery','shooting','hunting','fishing','climbing','rockclimbing','mountaineering',
    'hiking','trekking','horsebackriding','equestrian','polo','motorsport','formulaone','rally',
    'motocross','nascar','karting','billiards','snooker','pool','darts','bowling','curling','bobsleigh',
    'skeleton','luge','cheerleading','dancesport','yoga','pilates','zumba','aerobics','pentathlon',
    'decathlon','heptathlon','netball','handball','dodgeball','frisbee','ultimatefrisbee','kabaddi',
    'kho-kho','pehlwani','sumo','kalaripayattu','muaythai','kickboxing','capoeira','triathlon',
  ],
  Objects: [
    // --- Original ---
    'chair','table','sofa','lamp','mirror','clock','phone','laptop','keyboard','mouse',
    'camera','radio','television','fridge','oven','microwave','kettle','toaster','blender','vacuum',
    'broom','bucket','ladder','hammer','screwdriver','wrench','nail','rope','tape','scissors',
    'pencil','pen','eraser','notebook','book','magazine','newspaper','envelope','stamp','wallet',
    'keys','umbrella','backpack','suitcase','pillow','blanket','towel','curtain','carpet','vase',
    'candle','basket','bottle','cup','mug','plate','bowl','spoon','fork','knife',
    'pot','pan','speaker','headphones','charger','remote','battery','cable','router','printer',
    // --- Expanded Common Objects & Household Items ---
    'desk','stool','wardrobe','cupboard','shelf','drawer','mattress','bedsheet','quilt','cushion',
    'mat','rug','doormat','fan','heater','ac','cooler','iron','hairdryer','trimmer','shaver',
    'toothbrush','toothpaste','soap','shampoo','comb','brush','towel','bucket','mug','tub',
    'basin','tap','shower','mirror','comb','lotion','perfume','powder','deodorant','watch',
    'ring','necklace','bracelet','earring','bangle','purse','handbag','wallet','pouch','specs',
    'sunglasses','helmet','cap','hat','umbrella','raincoat','lock','key','chain','torch',
    'flashlight','bulb','tubelight','candle','matchbox','lighter','gasstove','cylinder','plate',
    'bowl','spoon','fork','knife','glass','cup','mug','bottle','jar','container','lunchbox',
    'pot','pan','cooker','spatula','ladle','grater','peeler','strainer','whisk','rollingpin',
    'choppingboard','tray','dustbin','broom','mop','wiper','detergent','phenyl','phenyl',
    'scissors','glue','stapler','puncher','scale','ruler','sharpener','eraser','pen','pencil',
    'marker','highlighter','sketchpen','crayon','notebook','diary','notepad','calendar','file',
    'folder','envelope','sticker','calculator','laptop','computer','tablet','smartphone','charger',
    'earphone','headphone','speaker','microphone','webcam','router','modem','pendrive','harddisk',
  ],
  Nature: [
    // --- Original ---
    'river','lake','ocean','mountain','valley','forest','desert','island','canyon','waterfall',
    'glacier','volcano','beach','cliff','cave','meadow','swamp','marsh','jungle','savanna',
    'tundra','prairie','hill','plain','creek','pond','stream','spring','geyser','rainbow',
    'cloud','storm','thunder','lightning','rain','snow','hail','frost','fog','mist',
    'wind','breeze','hurricane','tornado','sunrise','sunset','moon','star','planet','comet',
    'meteor','aurora','coral','reef','dune','oasis','cavern','plateau','ridge','glade',
    // --- Expanded Common Nature & Weather Elements ---
    'stream','brook','rivulet','lagoon','estuary','delta','sea','ocean','gulf','bay','cove',
    'fjord','peninsula','archipelago','atoll','reef','shores','coast','bank','sandbar','dune',
    'cliff','bluff','peak','summit','ridge','foothill','mountainside','volcano','crater','caldera',
    'lava','magma','ash','canyon','gorge','ravine','gully','valley','basin','plateau','mesa',
    'plain','savanna','prairie','steppe','tundra','meadow','pasture','glade','woodland',
    'thicket','grove','rainforest','taiga','jungle','swamp','marsh','bog','wetland','fen',
    'oasis','cave','cavern','grotto','tunnel','spring','geyser','hotspring','waterfall','cascade',
    'glacier','iceberg','icesheet','snowfield','avalanche','blizzard','storm','hurricane','typhoon',
    'cyclone','tornado','waterspout','monsoon','gale','squall','breeze','wind','draft','air',
    'atmosphere','cloud','cumulus','stratus','fog','mist','dew','frost','rime','hail','sleet',
    'rain','downpour','drizzle','shower','lightning','thunder','rainbow','aurora','eclipse',
    'solstice','equinox','sunrise','sunset','dawn','dusk','twilight','night','day','sky','space',
    'cosmos','galaxy','star','planet','moon','satellite','comet','meteor','meteorite','asteroid',
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
