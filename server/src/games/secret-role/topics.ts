/**
 * Family-friendly locations. The current topic is private to Citizens;
 * the Secret Agent never receives it through public state.
 */
export interface SecretTopic {
  id: string;
  name: string;
}

export const SECRET_TOPICS: readonly SecretTopic[] = [
  { id: 'school', name: 'School' },
  { id: 'beach', name: 'Beach' },
  { id: 'airport', name: 'Airport' },
  { id: 'restaurant', name: 'Restaurant' },
  { id: 'hospital', name: 'Hospital' },
  { id: 'library', name: 'Library' },
  { id: 'park', name: 'Park' },
  { id: 'cinema', name: 'Cinema' },
  { id: 'supermarket', name: 'Supermarket' },
  { id: 'train-station', name: 'Train Station' },
  { id: 'museum', name: 'Museum' },
  { id: 'zoo', name: 'Zoo' },
  { id: 'farm', name: 'Farm' },
  { id: 'stadium', name: 'Stadium' },
  { id: 'hotel', name: 'Hotel' },
  { id: 'bakery', name: 'Bakery' },
  { id: 'swimming-pool', name: 'Swimming Pool' },
  { id: 'playground', name: 'Playground' },
];

export const AGENT_CLUES = [
  'busy place',
  'lots of people',
  'I go there sometimes',
  'sounds familiar',
  'kind of everyday',
  'maybe outdoors',
  'could be indoors',
  'not sure honestly',
];

export const CITIZEN_CLUES: Record<string, readonly string[]> = {
  school: ['homework', 'classroom', 'bell rings'],
  beach: ['sand', 'waves', 'sunscreen'],
  airport: ['boarding', 'luggage', 'runway'],
  restaurant: ['menu', 'waiter', 'table for two'],
  hospital: ['nurse', 'waiting room', 'checkup'],
  library: ['quiet please', 'bookshelves', 'late fees'],
  park: ['picnic', 'benches', 'playground nearby'],
  cinema: ['popcorn', 'trailers', 'big screen'],
  supermarket: ['aisles', 'checkout', 'shopping cart'],
  'train-station': ['platform', 'timetable', 'ticket gate'],
  museum: ['exhibits', 'guided tour', 'gift shop'],
  zoo: ['enclosures', 'feeding time', 'maps'],
  farm: ['barn', 'fields', 'early morning'],
  stadium: ['crowd roar', 'seats', 'scoreboard'],
  hotel: ['front desk', 'room key', 'elevator'],
  bakery: ['fresh bread', 'oven', 'pastries'],
  'swimming-pool': ['lanes', 'whistle', 'chlorine'],
  playground: ['swings', 'slide', 'after school'],
};

export function normalizeTopicGuess(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9- ]/g, '').replace(/\s+/g, ' ');
}

export function topicMatches(topic: SecretTopic, guess: string): boolean {
  const needle = normalizeTopicGuess(guess);
  if (!needle) return false;
  return needle === topic.id || needle === topic.name.toLowerCase();
}
