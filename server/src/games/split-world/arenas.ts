/**
 * Split World — handcrafted 2D arenas.
 *
 * Every arena is a plain character map so the true layout is easy to audit.
 * The map NEVER leaves the server: `getPublicState` projects it through a
 * per-player "lens" before anything is sent to a client.
 *
 * Legend
 *   `#` wall          `.` floor         `S` switch        `D` door (gate)
 *   `G` goal / exit   `K` key           `H` hazard        `P` pressure plate
 *   `X` decoy (looks real to some seats, is plain floor in truth)
 *   `1`-`4` spawn points (walkable floor)
 */

export type ObjectiveKind =
  | 'reach-exit'
  | 'collect-keys'
  | 'switch-order'
  | 'pressure-plates'
  | 'sequence-keys';

export interface ArenaDefinition {
  id: string;
  name: string;
  /** Short line rendered in the client HUD. */
  objectiveText: string;
  objective: ObjectiveKind;
  /** Length of the playable part of the round. */
  roundMs: number;
  /** Only used by `collect-keys` / `sequence-keys`. */
  keysRequired?: number;
  layout: string[];
}

/**
 * Five distinct arenas, ordered by difficulty:
 *  1. two switches, one gate            — learn the split-view idea
 *  2. keys + hazards                    — more hidden information
 *  3. switches in a server-chosen order — multiple objectives
 *  4. simultaneous pressure plates      — conflicting information (decoys)
 *  5. keys in sequence, sealed vault    — complex shared objective
 */
export const SPLIT_ARENAS: ArenaDefinition[] = [
  {
    id: 'twin-causeway',
    name: 'Twin Causeway',
    objective: 'reach-exit',
    objectiveText: 'Hold both switches to open the gate, then reach the exit.',
    roundMs: 45_000,
    layout: [
      '#############',
      '#1..S...#...#',
      '#...#...#...#',
      '#3.....X#...#',
      '#.......D..G#',
      '#4.....X#...#',
      '#...#...#...#',
      '#2..S..H#...#',
      '#############',
    ],
  },
  {
    id: 'key-vault',
    name: 'Key Vault',
    objective: 'collect-keys',
    objectiveText: 'Collect all 3 keys to unlock the gate, then reach the exit.',
    roundMs: 50_000,
    keysRequired: 3,
    layout: [
      '#############',
      '#1...K..#...#',
      '#..##...#...#',
      '#3.#..H.#.#.#',
      '#....XK.D..G#',
      '#4.#..H.#.#.#',
      '#..##.X.#...#',
      '#2...K..#...#',
      '#############',
    ],
  },
  {
    id: 'order-hall',
    name: 'Order Hall',
    objective: 'switch-order',
    objectiveText: 'Trigger the three switches in the correct order.',
    roundMs: 55_000,
    layout: [
      '#############',
      '#1..S...S..3#',
      '#...........#',
      '#..###D###..#',
      '#..#..G..#..#',
      '#..#######..#',
      '#...........#',
      '#2..S..X...4#',
      '#############',
    ],
  },
  {
    id: 'mirror-basin',
    name: 'Mirror Basin',
    objective: 'pressure-plates',
    objectiveText: 'Stand on the pressure plates at the same time to open the vault.',
    roundMs: 55_000,
    layout: [
      '#############',
      '#1..P...P..3#',
      '#...........#',
      '#..#######..#',
      '#..#..G..#..#',
      '#..###D###..#',
      '#....X.X....#',
      '#2..P...P..4#',
      '#############',
    ],
  },
  {
    id: 'extraction',
    name: 'Extraction',
    objective: 'sequence-keys',
    objectiveText: 'Collect the four keys in the required order, then extract.',
    roundMs: 60_000,
    keysRequired: 4,
    layout: [
      '#############',
      '#1.K.....K.3#',
      '#.K..X.X..K.#',
      '#..###D###..#',
      '#H.#.....#.H#',
      '#..#..G..#..#',
      '#..#.....#..#',
      '#2.#######.4#',
      '#############',
    ],
  },
];

export const SPLIT_TOTAL_ROUNDS = SPLIT_ARENAS.length;
