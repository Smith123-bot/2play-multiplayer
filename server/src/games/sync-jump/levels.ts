/**
 * Sync Jump — 10 handcrafted courses.
 *
 * Legend (one character per cell, left to right)
 *   `=` solid ground   `_` gap (jump it)   `^` obstacle (jump it)
 *   `C` checkpoint     `F` finish zone
 *
 * A runner that steps onto a gap or an obstacle while grounded falls back to
 * their last checkpoint, so courses always open with solid ground.
 */

export interface SyncLevel {
  id: number;
  name: string;
  hint: string;
  /** Seconds allowed for this course. */
  timeLimit: number;
  course: string;
}

export const SYNC_LEVELS: SyncLevel[] = [
  {
    id: 1,
    name: 'Warm Up',
    hint: 'Move right together. Nothing can hurt you here.',
    timeLimit: 60,
    course: '=====C=====F',
  },
  {
    id: 2,
    name: 'First Gap',
    hint: 'Jump just before the gap, then keep pace with your partner.',
    timeLimit: 60,
    course: '====_===C===_===F',
  },
  {
    id: 3,
    name: 'Low Bars',
    hint: 'Obstacles work like gaps — jump them.',
    timeLimit: 70,
    course: '===^===C==^===^==F',
  },
  {
    id: 4,
    name: 'Stagger',
    hint: 'Gaps and bars alternate. Stay within three cells of each other.',
    timeLimit: 75,
    course: '===_==^==C==_==^===F',
  },
  {
    id: 5,
    name: 'Double Trouble',
    hint: 'Two hazards back to back. Two jumps, timed together.',
    timeLimit: 80,
    course: '===_==_=C===^==^=C==F',
  },
  {
    id: 6,
    name: 'Long Haul',
    hint: 'A longer run. Bank the checkpoints.',
    timeLimit: 90,
    course: '====^===_===C===^===_===C====F',
  },
  {
    id: 7,
    name: 'Rhythm',
    hint: 'A steady beat: run, jump, run, jump.',
    timeLimit: 90,
    course: '==_==^==_==^==C==_==^==_==F',
  },
  {
    id: 8,
    name: 'Tight Window',
    hint: 'Few checkpoints. A fall costs a lot of ground.',
    timeLimit: 95,
    course: '===_==^==_==^==_==^==C==_==^==_=F',
  },
  {
    id: 9,
    name: 'Gauntlet',
    hint: 'Keep the sync meter high — the multiplier is worth more than speed.',
    timeLimit: 110,
    course: '==_==^==_==^=C==_==^==_==^=C==_==^=F',
  },
  {
    id: 10,
    name: 'Final Run',
    hint: 'Everything at once. Move as one pair.',
    timeLimit: 130,
    course: '==_==^==_=C==^==_==^==_=C==_==^==_==^=C==_==^==_=F',
  },
];

export const SYNC_TOTAL_LEVELS = SYNC_LEVELS.length;
