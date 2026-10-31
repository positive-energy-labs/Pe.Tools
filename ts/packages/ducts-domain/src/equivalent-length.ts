/**
 * Effective length, the way ACCA Manual D reads a duct system: a fitting or terminal drop is the
 * feet of straight duct that would lose the same (Manual D: FR = available static x 100 / TEL).
 * RHVAC shows each such loss in feet at THAT duct's own friction rate, not the design rate, so a
 * priced row's `eqFt` is `dp / rate x 100` where `rate` is the rate of the duct run the part sits
 * on along its path. Pure; the pressure drop itself stays in in-wg (`losses.ts`).
 */
import type { Row } from "./losses.ts";

// firm-default: 0.08 in-wg per 100 ft is a typical residential design friction rate; the firm's
// own number belongs in firm config. Until then it is a person-owned Work cell (`designFriction`).
export const DEFAULT_DESIGN_FRICTION_RATE = 0.08;

/** A friction row's own rate, in-wg per 100 ft; null where it has no length or loses nothing. */
export const rateOf = (dp: number, lengthFt: number): number | null =>
  lengthFt > 1e-9 && dp > 0 ? (dp / lengthFt) * 100 : null;

/**
 * A path's rows with each one's `eqFt`. A duct row is its own length. Any other priced row takes
 * the rate of the nearest friction row before it on the path (the duct feeding it), else the
 * nearest after it, else `designRate`. An unpriced row (`dp` null) has no feet.
 */
export function withEquivalentLength(rows: readonly Row[], designRate: number): Row[] {
  const rates = rows.map((r) => (r.kind === "friction" ? (r.rate ?? null) : null));
  const refRate = (i: number) => {
    for (let k = i - 1; k >= 0; k--) if (rates[k] != null) return rates[k]!;
    for (let k = i + 1; k < rows.length; k++) if (rates[k] != null) return rates[k]!;
    return designRate;
  };
  return rows.map((row, i) => {
    if (row.dp == null) return { ...row, eqFt: null };
    if (row.kind === "friction") return { ...row, eqFt: row.lengthFt ?? 0 };
    // A pressure-gaining part (a converging branch with a negative coefficient) is 0 ft, never a
    // negative length; its dp stays signed (see `kernel/price-leg.ts` `equivalentFeet`).
    return { ...row, eqFt: Math.max(0, (row.dp / refRate(i)) * 100) };
  });
}

/** Total effective length of a path: straight duct plus every fitting and terminal in feet. */
export const telOf = (rows: readonly Row[]): number =>
  rows.reduce((sum, r) => sum + (r.eqFt ?? 0), 0);
