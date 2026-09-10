/**
 * UNO-style deck.
 *
 * Original implementation of the classic colour/number shedding card game —
 * no proprietary artwork, branding or assets are used. Cards are plain data
 * and the client renders them with CSS.
 *
 * Standard 108 card composition:
 *   - four colours (red, yellow, green, blue)
 *   - one `0` per colour                            =  4
 *   - two each of `1`-`9` per colour                = 72
 *   - two each of skip / reverse / draw-two         = 24
 *   - four wild                                     =  4
 *   - four wild draw four                           =  4
 */

export type UnoColor = 'red' | 'yellow' | 'green' | 'blue';
/** A wild card has no colour until its owner chooses one. */
export type UnoCardColor = UnoColor | 'wild';

export type UnoValue =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | 'skip'
  | 'reverse'
  | 'draw-two'
  | 'wild'
  | 'wild-draw-four';

export interface UnoCard {
  /** Server-assigned unique id. Clients may only ever reference these. */
  id: string;
  color: UnoCardColor;
  value: UnoValue;
}

export const UNO_COLORS: UnoColor[] = ['red', 'yellow', 'green', 'blue'];

export const ACTION_VALUES: UnoValue[] = ['skip', 'reverse', 'draw-two'];
export const WILD_VALUES: UnoValue[] = ['wild', 'wild-draw-four'];

export function isColor(value: unknown): value is UnoColor {
  return typeof value === 'string' && (UNO_COLORS as string[]).includes(value);
}

export function isWild(card: UnoCard): boolean {
  return card.value === 'wild' || card.value === 'wild-draw-four';
}

export function isNumberCard(card: UnoCard): boolean {
  return /^[0-9]$/.test(card.value);
}

/**
 * Official card values used for round scoring:
 *   number cards  = face value
 *   action cards  = 20
 *   wild cards    = 50
 */
export function cardPoints(card: UnoCard): number {
  if (isNumberCard(card)) return Number(card.value);
  if (card.value === 'wild' || card.value === 'wild-draw-four') return 50;
  return 20;
}

/** Builds the full, ordered 108 card deck. Shuffling is a separate step. */
export function buildDeck(): UnoCard[] {
  const deck: UnoCard[] = [];
  let serial = 0;
  const push = (color: UnoCardColor, value: UnoValue) => {
    deck.push({ id: `c${serial}`, color, value });
    serial += 1;
  };

  for (const color of UNO_COLORS) {
    push(color, '0');
    for (let digit = 1; digit <= 9; digit += 1) {
      push(color, String(digit) as UnoValue);
      push(color, String(digit) as UnoValue);
    }
    for (const action of ACTION_VALUES) {
      push(color, action);
      push(color, action);
    }
  }
  for (let i = 0; i < 4; i += 1) {
    push('wild', 'wild');
    push('wild', 'wild-draw-four');
  }
  return deck;
}

/**
 * Fisher-Yates shuffle driven by the platform's seeded PRNG.
 * Randomness is always server-side — a client can never influence the order.
 */
export function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

/**
 * Playability under the ruleset documented in How To Play:
 *  - a wild is always playable
 *  - otherwise the card must match the ACTIVE colour or the top card's value
 *
 * `activeColor` is the colour currently in force: the top card's own colour,
 * or the colour chosen by whoever played the last wild.
 */
export function isPlayable(card: UnoCard, topCard: UnoCard, activeColor: UnoColor): boolean {
  if (isWild(card)) return true;
  if (card.color === activeColor) return true;
  return card.value === topCard.value;
}

/** Total points held in a hand — used for round scoring. */
export function handPoints(hand: UnoCard[]): number {
  return hand.reduce((total, card) => total + cardPoints(card), 0);
}
