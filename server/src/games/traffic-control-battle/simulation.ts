/**
 * Traffic Control Battle — deterministic traffic simulation.
 *
 * This is an abstract management puzzle, not a driving game and not real-world
 * traffic guidance. Every player runs an identical intersection fed by the same
 * seeded car schedule; the winner is whoever keeps their junction flowing best.
 *
 * The simulation is a fixed-step state machine so it is fully reproducible:
 * the same seed and the same signal decisions always give the same outcome.
 */

/** The four approaches feeding the junction. */
export type Approach = 'n' | 'e' | 's' | 'w';

export const APPROACHES: Approach[] = ['n', 'e', 's', 'w'];

/** Each approach has two lanes with independent queues. */
export type Lane = 'straight' | 'turn';

export const LANES: Lane[] = ['straight', 'turn'];

export type SignalState = 'red' | 'green' | 'amber';

/** A signal phase is which pair of opposing approaches currently has green. */
export type Phase = 'ns' | 'ew';

export interface Car {
  id: string;
  approach: Approach;
  lane: Lane;
  /** Ticks the car has been queued. Drives the congestion penalty. */
  waited: number;
  /** Emergency cars must be cleared quickly or they cost a heavy penalty. */
  emergency: boolean;
  /** Ticks remaining while the car is crossing the junction box. */
  crossing: number;
}

export interface Signal {
  approach: Approach;
  state: SignalState;
  /** Ticks left in the amber transition before it turns red. */
  amberLeft: number;
}

export interface Junction {
  /** Queues, keyed `${approach}:${lane}`. */
  queues: Record<string, Car[]>;
  signals: Record<Approach, Signal>;
  /** Cars currently inside the junction box. */
  inBox: Car[];
  phase: Phase;
  /** Ticks since the phase last changed — enforces a minimum green. */
  sincePhase: number;
  cleared: number;
  collisions: number;
  jams: number;
  emergenciesCleared: number;
  emergenciesLost: number;
  score: number;
  disconnected: boolean;
  left: boolean;
}

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

export const TICK_MS = 250;
export const MATCH_MS = 120_000;
/** A phase must hold this many ticks before it may change again. */
export const MIN_GREEN_TICKS = 4;
/** How long amber lasts before the approach goes red. */
export const AMBER_TICKS = 2;
/** Ticks a car spends inside the junction box. */
export const CROSS_TICKS = 2;
/** A queue at or beyond this length counts as a jam each tick. */
export const JAM_LENGTH = 6;
/** An emergency car waiting longer than this is "lost". */
export const EMERGENCY_PATIENCE = 24;
export const MAX_QUEUE = 10;

export const SCORE_CLEAR = 10;
export const SCORE_EMERGENCY = 40;
export const PENALTY_JAM = 4;
export const PENALTY_COLLISION = 60;
export const PENALTY_EMERGENCY_LOST = 50;
/** Small bonus each tick the whole junction is moving. */
export const SCORE_FLOW = 2;

export function queueKey(approach: Approach, lane: Lane): string {
  return `${approach}:${lane}`;
}

export function isNorthSouth(approach: Approach): boolean {
  return approach === 'n' || approach === 's';
}

/** The phase that would give this approach a green. */
export function phaseFor(approach: Approach): Phase {
  return isNorthSouth(approach) ? 'ns' : 'ew';
}

/** Deterministic PRNG — the car schedule must be identical for every player. */
export function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeJunction(): Junction {
  const queues: Record<string, Car[]> = {};
  for (const approach of APPROACHES) {
    for (const lane of LANES) queues[queueKey(approach, lane)] = [];
  }
  const signals = {} as Record<Approach, Signal>;
  for (const approach of APPROACHES) {
    signals[approach] = {
      approach,
      // North/south starts green, east/west red.
      state: isNorthSouth(approach) ? 'green' : 'red',
      amberLeft: 0,
    };
  }
  return {
    queues,
    signals,
    inBox: [],
    phase: 'ns',
    sincePhase: MIN_GREEN_TICKS,
    cleared: 0,
    collisions: 0,
    jams: 0,
    emergenciesCleared: 0,
    emergenciesLost: 0,
    score: 0,
    disconnected: false,
    left: false,
  };
}

/**
 * Requests a phase change. Returns false when the change is illegal — the
 * minimum green has not elapsed, or the junction is already on that phase.
 * This is the ONLY lever a player has, and the server owns the decision.
 */
export function requestPhase(junction: Junction, phase: Phase): boolean {
  if (junction.phase === phase) return false;
  if (junction.sincePhase < MIN_GREEN_TICKS) return false;

  // The outgoing direction goes amber first; it turns red when amber expires.
  for (const approach of APPROACHES) {
    const signal = junction.signals[approach];
    if (phaseFor(approach) === junction.phase) {
      signal.state = 'amber';
      signal.amberLeft = AMBER_TICKS;
    }
  }
  junction.phase = phase;
  junction.sincePhase = 0;
  return true;
}

/** Total cars waiting on an approach across both lanes. */
export function queuedOn(junction: Junction, approach: Approach): number {
  return LANES.reduce((total, lane) => total + (junction.queues[queueKey(approach, lane)]?.length ?? 0), 0);
}

export function totalQueued(junction: Junction): number {
  return APPROACHES.reduce((total, approach) => total + queuedOn(junction, approach), 0);
}

/** Longest-waiting emergency car still queued, or null. */
export function worstEmergency(junction: Junction): Car | null {
  let worst: Car | null = null;
  for (const queue of Object.values(junction.queues)) {
    for (const car of queue) {
      if (!car.emergency) continue;
      if (!worst || car.waited > worst.waited) worst = car;
    }
  }
  return worst;
}

export interface TickOutcome {
  cleared: number;
  collision: boolean;
  jammed: boolean;
  emergencyLost: boolean;
}

/**
 * Advances one junction by a single fixed step.
 *
 * Order of operations matters and is deliberate:
 *  1. amber timers expire (amber -> red)
 *  2. cars already in the box finish crossing
 *  3. green approaches release their front cars into the box
 *  4. a collision is detected if the box holds conflicting directions
 *  5. queues age, spawns arrive, jams and lost emergencies are charged
 */
export function tickJunction(
  junction: Junction,
  tick: number,
  random: () => number,
  spawnChance: number,
  carId: () => string,
): TickOutcome {
  const outcome: TickOutcome = { cleared: 0, collision: false, jammed: false, emergencyLost: false };
  if (junction.left) return outcome;

  junction.sincePhase += 1;

  /* 1. Amber -> red, and bring the incoming phase to green. */
  for (const approach of APPROACHES) {
    const signal = junction.signals[approach];
    if (signal.state === 'amber') {
      signal.amberLeft -= 1;
      if (signal.amberLeft <= 0) signal.state = 'red';
      continue;
    }
    signal.state = phaseFor(approach) === junction.phase ? 'green' : 'red';
  }

  /* 2. Cars in the box finish crossing. */
  const stillCrossing: Car[] = [];
  for (const car of junction.inBox) {
    car.crossing -= 1;
    if (car.crossing > 0) {
      stillCrossing.push(car);
      continue;
    }
    junction.cleared += 1;
    outcome.cleared += 1;
    junction.score += SCORE_CLEAR;
    if (car.emergency) {
      junction.emergenciesCleared += 1;
      junction.score += SCORE_EMERGENCY;
    }
  }
  junction.inBox = stillCrossing;

  /* 3. Green approaches release their front car. Turn lanes move slower, so
        they only release on alternate ticks — this is what makes lane choice
        and phase timing an actual decision. */
  for (const approach of APPROACHES) {
    if (junction.signals[approach].state !== 'green') continue;
    for (const lane of LANES) {
      if (lane === 'turn' && tick % 2 === 1) continue;
      const queue = junction.queues[queueKey(approach, lane)];
      if (!queue || queue.length === 0) continue;
      const car = queue.shift() as Car;
      car.crossing = CROSS_TICKS;
      junction.inBox.push(car);
    }
  }

  /* 4. A collision means conflicting axes are inside the box together. This
        can only happen if a signal was mismanaged during a transition. */
  const nsInBox = junction.inBox.some((car) => isNorthSouth(car.approach));
  const ewInBox = junction.inBox.some((car) => !isNorthSouth(car.approach));
  if (nsInBox && ewInBox) {
    junction.collisions += 1;
    junction.score = Math.max(0, junction.score - PENALTY_COLLISION);
    outcome.collision = true;
    // Clear the box: the junction is reset after an incident.
    junction.inBox = [];
  }

  /* 5. Queues age; jams and abandoned emergencies are charged. */
  let jammedThisTick = false;
  for (const approach of APPROACHES) {
    for (const lane of LANES) {
      const queue = junction.queues[queueKey(approach, lane)];
      if (!queue) continue;
      for (const car of queue) car.waited += 1;
      if (queue.length >= JAM_LENGTH) jammedThisTick = true;
    }
  }
  if (jammedThisTick) {
    junction.jams += 1;
    junction.score = Math.max(0, junction.score - PENALTY_JAM);
    outcome.jammed = true;
  }

  // Emergency vehicles left too long are removed and heavily penalised.
  for (const key of Object.keys(junction.queues)) {
    const queue = junction.queues[key];
    if (!queue) continue;
    const kept = queue.filter((car) => {
      if (car.emergency && car.waited > EMERGENCY_PATIENCE) {
        junction.emergenciesLost += 1;
        junction.score = Math.max(0, junction.score - PENALTY_EMERGENCY_LOST);
        outcome.emergencyLost = true;
        return false;
      }
      return true;
    });
    junction.queues[key] = kept;
  }

  // Reward a junction that is actively moving and not backed up.
  if (!jammedThisTick && junction.inBox.length > 0) junction.score += SCORE_FLOW;

  /* Spawns. Identical across players because the RNG is seeded per tick. */
  if (random() < spawnChance) {
    const approach = APPROACHES[Math.floor(random() * APPROACHES.length)] as Approach;
    const lane = random() < 0.7 ? 'straight' : 'turn';
    const queue = junction.queues[queueKey(approach, lane)];
    if (queue && queue.length < MAX_QUEUE) {
      queue.push({
        id: carId(),
        approach,
        lane,
        waited: 0,
        // Emergencies become slightly more common as the match progresses.
        emergency: random() < Math.min(0.12, 0.02 + tick * 0.0004),
        crossing: 0,
      });
    }
  }

  return outcome;
}

/**
 * Picks the phase a competent controller would choose: prioritise a waiting
 * emergency vehicle, otherwise serve the busier axis. Used by the AI and by
 * the timeout fallback.
 */
export function bestPhaseFor(junction: Junction): Phase {
  const emergency = worstEmergency(junction);
  if (emergency) return phaseFor(emergency.approach);

  const ns = queuedOn(junction, 'n') + queuedOn(junction, 's');
  const ew = queuedOn(junction, 'e') + queuedOn(junction, 'w');
  if (ns === ew) return junction.phase;
  return ns > ew ? 'ns' : 'ew';
}
