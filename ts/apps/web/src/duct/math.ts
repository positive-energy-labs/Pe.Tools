/**
 * Imperial duct friction loss — ASHRAE Fundamentals, Duct Design (Darcy with the Altshul-Tsal
 * friction factor). Units: cfm, ft, in, fpm, lbm/ft³, in. wg.
 */
export type DuctInput = {
  shape: "round" | "rect";
  /** Round: diameter (in). Rect: width (in). */
  a: number;
  /** Rect only: height (in). */
  b: number;
  cfm: number;
  /** Duct length (ft). */
  length: number;
  /** Absolute roughness ε (ft). */
  roughness: number;
  /** Air density (lbm/ft³); 0.075 is standard air. */
  density: number;
};

/** ASHRAE absolute roughness, ft. */
export const materials = {
  "galvanized steel": 0.0003,
  "aluminum / PVC / stainless": 0.0001,
  "fibrous glass duct (lined)": 0.003,
  "flexible duct, fully extended": 0.003,
  "flexible duct, 30% compressed": 0.01,
} as const;

export type DuctResult = {
  area: number; // ft²
  velocity: number; // fpm
  hydraulicDiameter: number; // in — D_h = 4A/P, drives f
  equivalentDiameter: number; // in — Huebscher: the round duct with the same loss at the same cfm
  reynolds: number;
  friction: number; // Darcy f
  lossPer100: number; // in. wg / 100 ft
  loss: number; // in. wg over `length`
};

export function solve(d: DuctInput): DuctResult {
  const [a, b] = d.shape === "round" ? [d.a, d.a] : [d.a, d.b];
  const area = (d.shape === "round" ? (Math.PI * a * a) / 4 : a * b) / 144;
  const hydraulicDiameter = d.shape === "round" ? a : (2 * a * b) / (a + b);
  const equivalentDiameter =
    d.shape === "round" ? a : (1.3 * (a * b) ** 0.625) / (a + b) ** 0.25;
  const velocity = area > 0 ? d.cfm / area : 0;
  // Re = 8.56·D_h·V for standard air (D_h in, V fpm).
  const reynolds = 8.56 * hydraulicDiameter * velocity;
  // Altshul-Tsal: f' = 0.11(12ε/D_h + 68/Re)^0.25; f = f' if f' ≥ 0.018 else 0.85f' + 0.0028.
  const f0 =
    reynolds > 0 ? 0.11 * ((12 * d.roughness) / hydraulicDiameter + 68 / reynolds) ** 0.25 : 0;
  const friction = f0 >= 0.018 ? f0 : 0.85 * f0 + 0.0028;
  // Δp = 12·f·(L/D_h)·ρ·(V/1097)²
  const per = (L: number) =>
    hydraulicDiameter > 0
      ? 12 * friction * (L / hydraulicDiameter) * d.density * (velocity / 1097) ** 2
      : 0;
  return {
    area,
    velocity,
    hydraulicDiameter,
    equivalentDiameter,
    reynolds,
    friction,
    lossPer100: per(100),
    loss: per(d.length),
  };
}
