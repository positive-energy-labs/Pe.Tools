/**
 * The Ductulator's geometry. The wheel is a circular slide rule for the friction-chart power law
 *
 *     Δp = 0.109136 · Q^1.9 / D^5.02        (in. wg / 100 ft; Q cfm, D in)
 *
 * On a log scale that is a sum, and a sum on a circle is a rotation. Give the friction ring a pitch
 * of K°/decade and the cfm ring opposite it 1.9K; spin the clear top disk by −5.02K·log₁₀D and every
 * cfm reads its Δp straight across. Velocity V = 576Q/(πD²) is the same trick with exponent 2 on
 * D, so its cfm ring runs at 2.51K and the SAME spin lines it up. One rotation, two laws, no
 * arithmetic — that is the instrument.
 *
 * Fixed scales live on the base plate; cfm and diameter scales live on the clear disk. A `Face`
 * is one printing of the wheel: its pitch and the spans each ring carries. Spans are chosen so no
 * ring laps itself at that pitch; the velocity-side cfm ring runs 2.51K per decade, so it carries
 * fewer decades than the friction-side one.
 */

export const EXP = { cfm: 1.9, diameter: 5.02, velocityDiameter: 2 } as const;
export const C = 0.109136;

export type Range = readonly [number, number];
export type Face = {
  /** Friction ring pitch, degrees per decade. Every other pitch derives from it. */
  K: number;
  /** Where each pair of scales is zeroed, degrees clockwise from twelve. Paired rings share an
   *  origin so the read-across is exact; the values are taste (where the scales sit). */
  origin: { frictionPair: number; velocityPair: number };
  range: {
    friction: Range;
    cfmFriction: Range;
    cfmVelocity: Range;
    velocity: Range;
    diameter: Range;
  };
};

export const FACES = {
  commercial: {
    K: 50,
    origin: { frictionPair: -250, velocityPair: -400 },
    range: {
      friction: [0.01, 10],
      cfmFriction: [30, 100_000],
      cfmVelocity: [60, 40_000],
      velocity: [200, 8000],
      diameter: [3, 60],
    },
  },
  residential: {
    K: 90,
    origin: { frictionPair: -208.6, velocityPair: -43.6 },
    range: {
      friction: [0.01, 1],
      cfmFriction: [20, 2000],
      cfmVelocity: [40, 1500],
      velocity: [200, 2000],
      diameter: [4, 20],
    },
  },
} as const satisfies Record<string, Face>;
export type FaceKey = keyof typeof FACES;

/** Where the base plate's round-duct window sits. */
export const WINDOW = 180;

const log = Math.log10;

/** Everything angular about one face. */
export function geometry(f: Face) {
  const pitch = {
    friction: f.K,
    cfmFriction: EXP.cfm * f.K,
    velocity: EXP.diameter * f.K / EXP.velocityDiameter,
    cfmVelocity: EXP.diameter * f.K / EXP.velocityDiameter,
    diameter: EXP.diameter * f.K,
  };
  return {
    pitch,
    spinOf: (D: number) => -pitch.diameter * log(D),
    diameterOf: (spin: number) => 10 ** (-spin / pitch.diameter),
    /** Angles on the BASE plate. */
    base: {
      friction: (dp: number) => f.origin.frictionPair + f.K * (log(dp) - log(C)),
      velocity: (V: number) =>
        f.origin.velocityPair + pitch.velocity * (log(V) - log(576 / Math.PI)),
    },
    /** Angles on the clear DISK, before it is spun. */
    disk: {
      cfmFriction: (Q: number) => f.origin.frictionPair + pitch.cfmFriction * log(Q),
      cfmVelocity: (Q: number) => f.origin.velocityPair + pitch.cfmVelocity * log(Q),
      diameter: (D: number) => WINDOW + pitch.diameter * log(D),
    },
    cfmAtFriction: (diskAngle: number) =>
      10 ** ((diskAngle - f.origin.frictionPair) / pitch.cfmFriction),
  };
}

/** What the wheel says for a cfm at a diameter — the power law itself. */
export const read = (Q: number, D: number) => ({
  friction: (C * Q ** EXP.cfm) / D ** EXP.diameter,
  velocity: (576 * Q) / (Math.PI * D * D),
});
/** The law inverted: the diameter that gives this Δp at this cfm. */
export const diameterFor = (Q: number, friction: number) =>
  ((C * Q ** EXP.cfm) / friction) ** (1 / EXP.diameter);

/** Huebscher: the round duct equivalent to a × b. */
export const equivalent = (a: number, b: number) => (1.3 * (a * b) ** 0.625) / (a + b) ** 0.25;

/** The rectangular slots: for each side `a`, the side `b ≥ a` that matches D (bisection). */
export function rectSides(D: number, sides = [4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 30, 36]) {
  return sides.flatMap((a) => {
    let lo = a;
    let hi = 240;
    if (equivalent(a, lo) > D || equivalent(a, hi) < D) return [];
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (equivalent(a, mid) < D) lo = mid;
      else hi = mid;
    }
    return [{ a, b: (lo + hi) / 2 }];
  });
}

/** Log-scale tick marks between min and max: 1 2 3 … labelled, finer unlabelled. */
export function ticks([min, max]: Range, labelled = [1, 2, 3, 4, 5, 6, 8]) {
  const out: { v: number; major: boolean; label?: string }[] = [];
  for (let dec = Math.floor(log(min)); dec <= Math.ceil(log(max)); dec++) {
    const unit = 10 ** dec;
    for (let m = 10; m < 100; m += m < 20 ? 1 : m < 50 ? 2 : 5) {
      const v = (m / 10) * unit;
      if (v < min * 0.999 || v > max * 1.001) continue;
      const major = m % 10 === 0;
      out.push({ v, major, label: major && labelled.includes(m / 10) ? short(v) : undefined });
    }
  }
  return out;
}

export const short = (v: number) =>
  v >= 1000 ? `${v / 1000}k` : v < 1 ? v.toFixed(2).replace(/0$/, "") : String(v);

export const clamp = (v: number, [lo, hi]: Range) => Math.min(hi, Math.max(lo, v));

/** Shortest signed distance between two angles. */
export const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;
