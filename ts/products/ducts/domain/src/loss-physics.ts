/**
 * Duct pressure-drop physics, pure. Same arithmetic as the campaign hand calc (`handcalc.py`), US units.
 * - Velocity V = Q / A (fpm; cfm, ft2).
 * - Velocity pressure Pv = RHO (V / 1097)^2 in-wg, RHO 0.075 lb/ft3.
 * - Straight run dp = f (L / D) Pv, with D the hydraulic diameter 4A/P (inches; L in ft, so 12 f L / D).
 * - f is Altshul-Tsal: Re = 8.56 D V; f' = 0.11 (12 eps / D + 68 / Re)^0.25 (eps in ft, D in in);
 *   f = f' when f' >= 0.018, else 0.85 f' + 0.0028.
 * - Fitting dp = C Pv, the Pv basis per rule (see loss-rules.ts).
 */
const RHO = 0.075;
/** Revit's default rigid duct roughness, ft. */
const DEFAULT_ROUGHNESS_FT = 0.0003;

/** A flow cross-section: area (ft2) and hydraulic diameter (in). */
export interface Section {
  areaFt2: number;
  dhIn: number;
}

export const roundSection = (dIn: number): Section => ({
  areaFt2: (Math.PI / 4) * (dIn / 12) ** 2,
  dhIn: dIn,
});
const rectSection = (wIn: number, hIn: number): Section => ({
  areaFt2: (wIn * hIn) / 144,
  dhIn: (2 * wIn * hIn) / (wIn + hIn),
});

/** The section of a connector or segment; null where Pe cannot state one (oval, other, no size). */
export function sectionOf(
  shape: string,
  diameterIn?: number | null,
  widthIn?: number | null,
  heightIn?: number | null,
): Section | null {
  if (shape === "round" && diameterIn) return roundSection(diameterIn);
  if (shape === "rectangular" && widthIn && heightIn) return rectSection(widthIn, heightIn);
  return null;
}

const velocityPressure = (fpm: number) => RHO * (fpm / 1097) ** 2;

export interface Friction {
  dp: number;
  fpm: number;
  pv: number;
  f: number;
  re: number;
}

export function friction(
  section: Section,
  cfm: number,
  lengthFt: number,
  roughnessFt = DEFAULT_ROUGHNESS_FT,
): Friction {
  const fpm = cfm / section.areaFt2;
  const pv = velocityPressure(fpm);
  if (!(fpm > 0)) return { dp: 0, fpm: 0, pv: 0, f: 0, re: 0 };
  const re = 8.56 * section.dhIn * fpm;
  const fp = 0.11 * ((12 * roughnessFt) / section.dhIn + 68 / re) ** 0.25;
  const f = fp >= 0.018 ? fp : 0.85 * fp + 0.0028;
  return { dp: ((12 * f * lengthFt) / section.dhIn) * pv, fpm, pv, f, re };
}
