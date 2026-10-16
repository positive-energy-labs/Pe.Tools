/** Sparse named ASHRAE coordinates. The generated C# DTO is the only wire authority. */
import type { DuctsTables } from "@pe/host-contracts/generated";
export type Grid = DuctsTables.Res.AshraeGrid;
export type Grids = Record<string, Record<string, Grid>>;
export interface Lookup { value: number; notes: string[]; inputs: string; }
export class GridError extends Error {}

const numbers = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === "number" && Number.isFinite(n));
export function validateGrid(raw: unknown, where: string): asserts raw is Grid {
  if (!raw || typeof raw !== "object") throw new GridError(`${where}: not a grid`);
  const g = raw as Partial<Grid>;
  if (Object.keys(g).some((k) => !["title", "axis", "rowAxes", "rows"].includes(k)) ||
      typeof g.title !== "string" || !Array.isArray(g.rowAxes) || g.rowAxes.length > 2 ||
      !g.rowAxes.every((n) => typeof n === "string" && n.trim().length > 0) || !Array.isArray(g.rows) || !g.rows.length)
    throw new GridError(`${where}: invalid named dimensions`);
  const names = [...g.rowAxes];
  let width = 1;
  if (g.axis !== null) {
    const a = g.axis;
    if (!a || Object.keys(a).some((k) => !["name", "values"].includes(k)) || typeof a.name !== "string" || !a.name.trim() || !numbers(a.values) || !a.values.length || a.values.some((n, i) => i > 0 && a.values[i - 1]! >= n))
      throw new GridError(`${where}: primary axis must be finite and strictly ascending`);
    names.unshift(a.name); width = a.values.length;
  } else if (g.rowAxes.length || g.rows.length !== 1) throw new GridError(`${where}: invalid constant`);
  if (new Set(names).size !== names.length) throw new GridError(`${where}: duplicate axis names`);
  const keys = new Set<string>();
  for (const r of g.rows) {
    if (!r || Object.keys(r).some((k) => !["coordinates", "values"].includes(k)) || !numbers(r.coordinates) || r.coordinates.length !== g.rowAxes.length || !numbers(r.values) || r.values.length !== width)
      throw new GridError(`${where}: row does not match named axes`);
    const key = JSON.stringify(r.coordinates);
    if (keys.has(key)) throw new GridError(`${where}: duplicate sparse row`);
    keys.add(key);
  }
}
export function toGrids(response: unknown): Grids {
  const tables = (response as { tables?: Record<string, Record<string, unknown>> } | null)?.tables;
  if (!tables || typeof tables !== "object" || Array.isArray(tables)) throw new GridError("ducts.tables response has no tables");
  const out: Grids = {};
  for (const [id, results] of Object.entries(tables)) {
    if (!results || typeof results !== "object" || Array.isArray(results)) throw new GridError(`${id}: not result grids`);
    const key = id.toUpperCase();
    if (Object.hasOwn(out, key)) throw new GridError(`${id}: duplicate table identity`);
    out[key] = {};
    for (const [res, raw] of Object.entries(results)) { validateGrid(raw, `${id} ${res}`); out[key]![res] = raw; }
  }
  return out;
}
/** Exact coordinates shrink the corner set. Every remaining positive-weight corner must exist. */
export function lookupGrid(grid: Grid, coordinates: Readonly<Record<string, number>>): Lookup {
  validateGrid(grid, grid.title);
  const names = grid.axis ? [grid.axis.name, ...grid.rowAxes] : [];
  if (Object.keys(coordinates).length !== names.length || names.some((n) => !Object.hasOwn(coordinates, n)) || Object.values(coordinates).some((v) => !Number.isFinite(v)))
    throw new GridError(`${grid.title}: exact finite named coordinates required: ${names.join(", ")}`);
  if (!grid.axis) return {value: grid.rows[0]!.values[0]!, notes: [], inputs: "constant"};
  const axes = [grid.axis.values, ...grid.rowAxes.map((_, i) => [...new Set(grid.rows.map((r) => r.coordinates[i]!))].sort((a,b) => a-b))];
  let corners: {at: number[]; weight: number}[] = [{at: [], weight: 1}];
  for (const [i, name] of names.entries()) {
    const xs = axes[i]!; const q = coordinates[name]!;
    if (q < xs[0]! || q > xs[xs.length-1]!) throw new GridError(`${name} outside published domain`);
    let bracket: {at: number; weight: number}[];
    if (xs.includes(q)) bracket = [{at:q, weight:1}];
    else {
      const k = xs.findIndex((a,k) => a < q && q < xs[k+1]!);
      const t = (q-xs[k]!)/(xs[k+1]!-xs[k]!);
      bracket = [{at:xs[k]!,weight:1-t},{at:xs[k+1]!,weight:t}];
    }
    corners = corners.flatMap((c) => bracket.filter((p) => p.weight > 0).map((p) => ({at:[...c.at,p.at],weight:c.weight*p.weight})));
  }
  let value = 0;
  for (const c of corners) {
    const rows = grid.rows.filter((r) => r.coordinates.every((v,i) => v === c.at[i+1]));
    if (rows.length !== 1) throw new GridError(`${grid.title}: missing published bracketing corner`);
    value += rows[0]!.values[grid.axis.values.indexOf(c.at[0]!)]! * c.weight;
  }
  if (!Number.isFinite(value)) throw new GridError(`${grid.title}: interpolation is not finite`);
  return {value, notes: [], inputs:names.map((n) => `${n}=${+coordinates[n]!.toPrecision(4)}`).join(", ")};
}
