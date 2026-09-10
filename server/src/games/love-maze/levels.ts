/**
 * Love Maze — 10 handcrafted cooperative levels.
 *
 * Each level is a character map so the layout is easy to audit and easy to
 * extend: adding an eleventh level means appending one entry here.
 *
 * Legend
 *   `#` wall              `.` floor            `A` player A spawn
 *   `B` player B spawn    `a` switch A (only A can hold it)
 *   `b` switch B (only B can hold it)          `p` shared pressure plate
 *   `D` door (opens when its switches/plates are satisfied)
 *   `K` key               `H` hazard           `C` checkpoint
 *   `E` exit (BOTH players must stand here)
 */

export interface MazeLevel {
  id: number;
  name: string;
  hint: string;
  /** Seconds allowed for this level. */
  timeLimit: number;
  /** Keys that must be collected before the exit accepts the team. */
  keysRequired: number;
  layout: string[];
}

export const MAZE_LEVELS: MazeLevel[] = [
  {
    id: 1,
    name: 'First Steps',
    hint: 'Walk to the exit together. Both of you must stand on it.',
    timeLimit: 90,
    keysRequired: 0,
    layout: [
      '#########',
      '#A......#',
      '#.#####.#',
      '#B....#.#',
      '#####.#.#',
      '#EE...#.#',
      '#########',
    ],
  },
  {
    id: 2,
    name: 'Hold the Way',
    hint: 'One of you holds a switch while the other slips through the door.',
    timeLimit: 90,
    keysRequired: 0,
    layout: [
      '###########',
      '#A...a#...#',
      '#.###.#.#.#',
      '#B...b#.#.#',
      '#.#####D#.#',
      '#.......#E#',
      '#......##E#',
      '###########',
    ],
  },
  {
    id: 3,
    name: 'Two Hands',
    hint: 'Stand on both pressure plates at the same time to open the gate.',
    timeLimit: 100,
    keysRequired: 0,
    layout: [
      '###########',
      '#A.......p#',
      '#.#######.#',
      '#B.......p#',
      '#.#######D#',
      '#........E#',
      '#........E#',
      '###########',
    ],
  },
  {
    id: 4,
    name: 'Key Exchange',
    hint: 'Collect both keys, then meet at the exit.',
    timeLimit: 110,
    keysRequired: 2,
    layout: [
      '#############',
      '#A....#....K#',
      '#.###.#.###.#',
      '#.#...#...#.#',
      '#.#.#####.#.#',
      '#B#.....#.#.#',
      '#K..###.#..E#',
      '#..##...#..E#',
      '#############',
    ],
  },
  {
    id: 5,
    name: 'Mind the Sparks',
    hint: 'Hazards send you back to the last checkpoint. Take turns scouting.',
    timeLimit: 110,
    keysRequired: 1,
    layout: [
      '#############',
      '#A..H....H..#',
      '#.#.#.##.#.##',
      '#B..C..H...K#',
      '##.#####.##.#',
      '#....H.....C#',
      '#.####.####.#',
      '#EE........##',
      '#############',
    ],
  },
  {
    id: 6,
    name: 'Split Corridor',
    hint: 'Your switches are colour coded: A holds a, B holds b.',
    timeLimit: 120,
    keysRequired: 1,
    layout: [
      '#############',
      '#A....a#....#',
      '#.####.#.##.#',
      '#......#.#K.#',
      '#.####D#.#..#',
      '#B....b#.#.##',
      '#.#######.#E#',
      '#.........#E#',
      '#############',
    ],
  },
  {
    id: 7,
    name: 'Double Duty',
    hint: 'Two doors, two keys, one clock. Divide the work.',
    timeLimit: 130,
    keysRequired: 2,
    layout: [
      '###############',
      '#A...p#...K...#',
      '#.###.#.#####.#',
      '#.#...#.....#.#',
      '#.#.#######.#.#',
      '#B..p#...H..#.#',
      '####D#.###..#.#',
      '#..C...#K...#.#',
      '#.#####..####.#',
      '#EE..........##',
      '###############',
    ],
  },
  {
    id: 8,
    name: 'Relay',
    hint: 'Checkpoints matter here. Bank your progress before the hazards.',
    timeLimit: 130,
    keysRequired: 2,
    layout: [
      '###############',
      '#A..H..a#..K..#',
      '#.####..#.###.#',
      '#....C..#...#.#',
      '###.#####.#.#.#',
      '#B....H...#.#.#',
      '#.#####D###.#.#',
      '#K..C.....H.#.#',
      '#.#########.#.#',
      '#EE.........#.#',
      '###############',
    ],
  },
  {
    id: 9,
    name: 'Lockstep',
    hint: 'Both plates must be held at once, and both keys are behind the gate.',
    timeLimit: 150,
    keysRequired: 2,
    layout: [
      '###############',
      '#A.....p#..K..#',
      '#.#####.#.###.#',
      '#.#...#.#...#.#',
      '#.#.#.#.###.#.#',
      '#B..#..p#...#.#',
      '#####D###.###.#',
      '#..C....H...#K#',
      '#.#########.#.#',
      '#EE.........#.#',
      '###############',
    ],
  },
  {
    id: 10,
    name: 'Final Challenge',
    hint: 'Switches, plates, keys and hazards. Talk before you move.',
    timeLimit: 180,
    keysRequired: 3,
    layout: [
      '#################',
      '#A....a#..H...K.#',
      '#.####.#.####.#.#',
      '#.#..C.#....#.#.#',
      '#.#.####.##.#.#.#',
      '#B..p...#..H..#.#',
      '####.####.#####.#',
      '#K.....p#.....C.#',
      '#.#####D#.#####.#',
      '#...H.....#..K..#',
      '#.#######.#.###.#',
      '#EE.......#.....#',
      '#################',
    ],
  },
];

export const MAZE_TOTAL_LEVELS = MAZE_LEVELS.length;
