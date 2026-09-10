/**
 * Build Together — 10 handcrafted blueprints.
 *
 * The target structure is a character map. Each non-space character is a cell
 * that must be filled by a piece of the matching kind:
 *
 *   `A` — a piece only partner A can place
 *   `B` — a piece only partner B can place
 *   `S` — a shared piece either partner may place
 *
 * That split is what makes cooperation structural: neither partner can finish
 * a blueprint alone, because they physically cannot place the other's pieces.
 */

export type PieceKind = 'a' | 'b' | 'shared';

export interface BuildLevel {
  id: number;
  name: string;
  hint: string;
  /** Seconds allowed for this blueprint. */
  timeLimit: number;
  /** Spare pieces beyond the exact requirement (0 = exact inventory). */
  spare: number;
  /** Pieces that must be rotated to fit (see `rotations`). */
  rotationRequired: boolean;
  blueprint: string[];
}

export const BUILD_LEVELS: BuildLevel[] = [
  {
    id: 1,
    name: 'Foundation',
    hint: 'Each of you places your own colour. Blue is A, green is B.',
    timeLimit: 90,
    spare: 2,
    rotationRequired: false,
    blueprint: [
      'AABB',
    ],
  },
  {
    id: 2,
    name: 'Two Towers',
    hint: 'Build up. Your partner cannot place your pieces.',
    timeLimit: 90,
    spare: 2,
    rotationRequired: false,
    blueprint: [
      'A..B',
      'A..B',
      'AABB',
    ],
  },
  {
    id: 3,
    name: 'The Bridge',
    hint: 'Shared pieces (grey) can be placed by either of you.',
    timeLimit: 100,
    spare: 2,
    rotationRequired: false,
    blueprint: [
      'ASSB',
      'A..B',
      'A..B',
    ],
  },
  {
    id: 4,
    name: 'Archway',
    hint: 'More pieces, same idea. Split the work and call out gaps.',
    timeLimit: 110,
    spare: 2,
    rotationRequired: false,
    blueprint: [
      '.SSSS.',
      'A....B',
      'A....B',
      'AA..BB',
    ],
  },
  {
    id: 5,
    name: 'Pinwheel',
    hint: 'Rotation unlocks here — some pieces only fit one way.',
    timeLimit: 120,
    spare: 2,
    rotationRequired: true,
    blueprint: [
      '.AA.',
      'BSSA',
      'BSSA',
      '.BB.',
    ],
  },
  {
    id: 6,
    name: 'Interlock',
    hint: 'Alternating columns. Take turns so you do not block each other.',
    timeLimit: 120,
    spare: 2,
    rotationRequired: true,
    blueprint: [
      'ABABAB',
      'BABABA',
      'SSSSSS',
    ],
  },
  {
    id: 7,
    name: 'The Keep',
    hint: 'A hollow structure. Walls first, then the shared roof.',
    timeLimit: 140,
    spare: 1,
    rotationRequired: true,
    blueprint: [
      'SSSSSS',
      'A....B',
      'A....B',
      'A....B',
      'AASSBB',
    ],
  },
  {
    id: 8,
    name: 'Cathedral',
    hint: 'The biggest build yet. Agree on who takes which side.',
    timeLimit: 150,
    spare: 1,
    rotationRequired: true,
    blueprint: [
      '..SS..',
      '.ASSB.',
      'AASSBB',
      'A.SS.B',
      'AASSBB',
    ],
  },
  {
    id: 9,
    name: 'Exact Fit',
    hint: 'No spare pieces at all. Every placement has to be right.',
    timeLimit: 150,
    spare: 0,
    rotationRequired: true,
    blueprint: [
      'ASBASB',
      'SABSAB',
      'ABSABS',
      'SSAABB',
    ],
  },
  {
    id: 10,
    name: 'Grand Design',
    hint: 'Exact inventory, full board. Communicate every move.',
    timeLimit: 180,
    spare: 0,
    rotationRequired: true,
    blueprint: [
      '..SSSS..',
      '.ASSSSB.',
      'AASSSSBB',
      'A.S..S.B',
      'AAS..SBB',
      'ASSSSSSB',
    ],
  },
];

export const BUILD_TOTAL_LEVELS = BUILD_LEVELS.length;
