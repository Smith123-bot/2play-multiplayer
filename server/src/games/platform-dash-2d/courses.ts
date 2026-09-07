export type PlatformKind = 'solid' | 'moving' | 'crumble' | 'pad' | 'spike' | 'checkpoint' | 'finish';

export interface CoursePlatform {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: PlatformKind;
  /** Horizontal travel for moving platforms (world units). */
  travel?: number;
  periodMs?: number;
}

export interface DashCourse {
  id: string;
  name: string;
  width: number;
  height: number;
  spawn: { x: number; y: number };
  platforms: CoursePlatform[];
}

const W = 1100;
const H = 360;
const GROUND = 40;

function plat(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  kind: PlatformKind = 'solid',
  extra: Partial<CoursePlatform> = {},
): CoursePlatform {
  return { id, x, y, w, h, kind, ...extra };
}

export const COURSE_SUMMIT: DashCourse = {
  id: 'summit',
  name: 'Summit',
  width: W,
  height: H,
  spawn: { x: 36, y: 80 },
  platforms: [
    plat('g0', 0, 0, 160, GROUND),
    plat('p1', 200, 50, 90, 16),
    plat('gap1', 320, 90, 80, 16),
    plat('mv1', 430, 70, 70, 16, 'moving', { travel: 70, periodMs: 2200 }),
    plat('pad1', 560, 50, 50, 16, 'pad'),
    plat('p2', 640, 140, 90, 16),
    plat('ck1', 760, 140, 40, 16, 'checkpoint'),
    plat('p3', 830, 90, 80, 16),
    plat('cr1', 930, 90, 70, 16, 'crumble'),
    plat('p4', 1020, 70, 80, 16),
    plat('fin', 1060, 70, 36, 48, 'finish'),
  ],
};

export const COURSE_CAVES: DashCourse = {
  id: 'caves',
  name: 'Caves',
  width: W,
  height: H,
  spawn: { x: 30, y: 80 },
  platforms: [
    plat('g0', 0, 0, 140, GROUND),
    plat('sp1', 160, 0, 50, 18, 'spike'),
    plat('p1', 230, 40, 80, 16),
    plat('p2', 340, 80, 70, 16),
    plat('cr1', 430, 80, 60, 16, 'crumble'),
    plat('ck1', 520, 50, 40, 16, 'checkpoint'),
    plat('mv1', 590, 90, 64, 16, 'moving', { travel: 90, periodMs: 1800 }),
    plat('sp2', 720, 0, 40, 18, 'spike'),
    plat('pad1', 780, 40, 48, 16, 'pad'),
    plat('p3', 860, 130, 80, 16),
    plat('p4', 970, 80, 90, 16),
    plat('fin', 1040, 80, 36, 48, 'finish'),
  ],
};

export const COURSE_SKYWAY: DashCourse = {
  id: 'skyway',
  name: 'Skyway',
  width: W,
  height: H,
  spawn: { x: 28, y: 60 },
  platforms: [
    plat('g0', 0, 0, 120, GROUND),
    plat('p1', 160, 60, 70, 16),
    plat('mv1', 250, 110, 64, 16, 'moving', { travel: 80, periodMs: 2000 }),
    plat('p2', 400, 160, 70, 16),
    plat('pad1', 500, 90, 48, 16, 'pad'),
    plat('ck1', 560, 180, 40, 16, 'checkpoint'),
    plat('mv2', 640, 150, 64, 16, 'moving', { travel: 70, periodMs: 1600 }),
    plat('cr1', 780, 120, 60, 16, 'crumble'),
    plat('p3', 870, 80, 70, 16),
    plat('p4', 970, 50, 80, 16),
    plat('fin', 1048, 50, 40, 48, 'finish'),
  ],
};

export const DASH_COURSES: Record<string, DashCourse> = {
  summit: COURSE_SUMMIT,
  caves: COURSE_CAVES,
  skyway: COURSE_SKYWAY,
};

export const COURSE_IDS = ['summit', 'caves', 'skyway'] as const;
export type CourseId = (typeof COURSE_IDS)[number];

export function courseById(id: string | undefined, rng: () => number): DashCourse {
  if (id && DASH_COURSES[id]) return DASH_COURSES[id]!;
  return DASH_COURSES[COURSE_IDS[Math.floor(rng() * COURSE_IDS.length)]!]!;
}

/** Moving platform x at time `now` (deterministic). */
export function movingX(platform: CoursePlatform, now: number): number {
  if (platform.kind !== 'moving') return platform.x;
  const travel = platform.travel ?? 60;
  const period = platform.periodMs ?? 2000;
  const t = ((now % period) + period) % period;
  const wave = Math.sin((t / period) * Math.PI * 2);
  return platform.x + wave * travel;
}
