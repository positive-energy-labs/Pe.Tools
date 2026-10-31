/**
 * ASHRAE fitting-coefficient grids and their interpolation. Pure.
 * A table is one grid per result (`Co`, or `Cb` / `Cs` for a tee). 1-D grids vary with x only;
 * 2-D grids have one row per y and one column per x; 3-D grids (ER5-1, ED5-3: As/Ac by Ab/Ac by
 * Qb/Qc) have one slice per z, each a 2-D grid whose rows may be null where the table states no
 * row. Interpolation is linear in 1-D, bilinear in 2-D (interpolate each row along x, then the
 * column along y), trilinear in 3-D (bilinear in each bracketing slice over the rows that slice
 * states, then along z), clamped to the grid edge with a note (as `ctable.py` `i1` / `lookup`).
 * Axes must ascend.
 */

/** The shape `ducts.tables` returns for one result of one table. */
export interface Grid {
  title: string;
  xLabel: string;
  x: number[];
  yLabel?: string;
  y?: number[];
  /** The outer axis of a three-axis table (its first printed column); `grid` is then [z][y][x]. */
  zLabel?: string;
  z?: number[];
  grid: number[][] | number[] | (number[] | null)[][];
}

/** TABLE (upper case, e.g. "CD3-2") -> result ("Co", "Cb", "Cs") -> grid. */
export type Grids = Record<string, Record<string, Grid>>;

/** The point a lookup read, each axis clamped to what the table states there. */
export interface LookupPoint {
  x: number;
  y?: number;
  z?: number;
}

export interface Lookup {
  value: number;
  /** One note per clamped axis. */
  notes: string[];
  inputs: string;
  /** Where the value was read: the inputs, clamped (a y clamped per slice is weighted along z). */
  at: LookupPoint;
}

export class GridError extends Error {}

const clampTo = (v: number, xs: number[]) => Math.min(Math.max(v, xs[0]!), xs.at(-1)!);

function interp1(x: number, xs: number[], ys: number[], label: string): [number, string?] {
  const last = xs.length - 1;
  if (x <= xs[0]!) return [ys[0]!, x < xs[0]! ? `${label} clamped at ${xs[0]}` : undefined];
  if (x >= xs[last]!)
    return [ys[last]!, x > xs[last]! ? `${label} clamped at ${xs[last]}` : undefined];
  for (let k = 0; k < last; k++)
    if (xs[k]! <= x && x <= xs[k + 1]!) {
      const t = (x - xs[k]!) / (xs[k + 1]! - xs[k]!);
      return [ys[k]! + t * (ys[k + 1]! - ys[k]!)];
    }
  throw new GridError(`${label} ${x} is not on an ascending axis`);
}

/** The bracketing indices along an ascending axis and the weight of the upper one; clamped at the ends. */
function bracket(v: number, vs: number[]): { lo: number; hi: number; t: number } {
  const last = vs.length - 1;
  // On a node, read that slice alone (a neighbour weighted 0 would still add its clamp notes).
  const node = vs.indexOf(v);
  if (node >= 0) return { lo: node, hi: node, t: 0 };
  if (v <= vs[0]!) return { lo: 0, hi: 0, t: 0 };
  if (v >= vs[last]!) return { lo: last, hi: last, t: 0 };
  const k = vs.findIndex((_, i) => i < last && vs[i]! <= v && v <= vs[i + 1]!);
  if (k < 0) throw new GridError(`${v} is not on an ascending axis`);
  return { lo: k, hi: k + 1, t: (v - vs[k]!) / (vs[k + 1]! - vs[k]!) };
}

const isNumbers = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((n) => typeof n === "number");

function toGrid(raw: unknown, where: string): Grid {
  const g = raw as Partial<Grid> | null;
  if (!g || typeof g !== "object" || typeof g.title !== "string" || !isNumbers(g.x))
    throw new GridError(`${where}: not a grid`);
  const y = g.y ?? undefined;
  const z = g.z ?? undefined;
  const row = (r: unknown) => isNumbers(r) && r.length === g.x!.length;
  const ok =
    z != null
      ? isNumbers(z) &&
        isNumbers(y) &&
        Array.isArray(g.grid) &&
        g.grid.length === z.length &&
        g.grid.every(
          (slice) =>
            Array.isArray(slice) &&
            slice.length === y.length &&
            slice.every((r) => r === null || row(r)) &&
            slice.some((r) => r !== null),
        )
      : y == null
        ? isNumbers(g.grid)
        : isNumbers(y) && Array.isArray(g.grid) && g.grid.length === y.length && g.grid.every(row);
  if (!ok) throw new GridError(`${where}: grid does not match its axes`);
  return {
    title: g.title,
    xLabel: g.xLabel ?? "x",
    x: g.x,
    ...(y == null ? {} : { y, yLabel: g.yLabel ?? "y" }),
    ...(z == null ? {} : { z, zLabel: g.zLabel ?? "z" }),
    grid: g.grid as Grid["grid"],
  };
}

/** Narrow a `ducts.tables` response (typed `unknown` on the wire) to `Grids`; throws on a malformed grid. */
export function toGrids(response: unknown): Grids {
  const tables = (response as { tables?: Record<string, Record<string, unknown>> } | null)?.tables;
  if (!tables || typeof tables !== "object")
    throw new GridError("ducts.tables response has no tables");
  const out: Grids = {};
  for (const [id, results] of Object.entries(tables)) {
    out[id.toUpperCase()] = {};
    for (const [res, raw] of Object.entries(results))
      out[id.toUpperCase()]![res] = toGrid(raw, `${id} ${res}`);
  }
  return out;
}

const round = (v: number) => +v.toPrecision(4);

/**
 * Look `x` (and `y` for a 2-D grid, `y` and `z` for a 3-D one) up; throws `GridError` when the
 * inputs do not fit the grid.
 */
export function lookupGrid(grid: Grid, x: number, y?: number | null, z?: number | null): Lookup {
  if (grid.x.length > 0 && !Number.isFinite(x))
    throw new GridError(`${grid.xLabel} is not a number`);
  if (grid.x.length === 0) {
    // A constant table ("Co = 0.12"): one value, no axes.
    const v = (grid.grid as number[])[0];
    if (v == null) throw new GridError(`${grid.title} has no value`);
    return { value: v, notes: [], inputs: "constant", at: { x } };
  }
  const notes: string[] = [];
  const note = (n?: string) => n && !notes.includes(n) && notes.push(n);
  const xLabel = grid.xLabel;
  const yLabel = grid.yLabel ?? "y";
  if (!grid.y) {
    if (y != null || z != null) throw new GridError(`${grid.title} takes ${xLabel} only`);
    const [value, n] = interp1(x, grid.x, grid.grid as number[], xLabel);
    note(n);
    return { value, notes, inputs: `${xLabel}=${round(x)}`, at: { x: clampTo(x, grid.x) } };
  }
  if (y == null || !Number.isFinite(y)) throw new GridError(`${grid.title} needs ${yLabel}`);
  /** Bilinear over the rows a slice states; `where` qualifies a y clamp with the slice's z. */
  const plane = (rows: (number[] | null)[], where = "") => {
    const ys: number[] = [];
    const column: number[] = [];
    rows.forEach((row, k) => {
      if (!row) return;
      const [v, n] = interp1(x, grid.x, row, xLabel);
      note(n);
      ys.push(grid.y![k]!);
      column.push(v);
    });
    const [v, n] = interp1(y, ys, column, yLabel);
    note(n && `${n}${where}`);
    return { value: v, y: clampTo(y, ys) };
  };
  if (!grid.z) {
    if (z != null) throw new GridError(`${grid.title} takes ${xLabel} and ${yLabel} only`);
    const { value, y: atY } = plane(grid.grid as number[][]);
    return {
      value,
      notes,
      inputs: `${xLabel}=${round(x)}, ${yLabel}=${round(y)}`,
      at: { x: clampTo(x, grid.x), y: atY },
    };
  }
  const zLabel = grid.zLabel ?? "z";
  if (z == null || !Number.isFinite(z)) throw new GridError(`${grid.title} needs ${zLabel}`);
  const slices = grid.grid as (number[] | null)[][];
  const { lo, hi, t } = bracket(z, grid.z);
  if (z < grid.z[0]! || z > grid.z.at(-1)!) note(`${zLabel} clamped at ${grid.z[lo]}`);
  const a = plane(slices[lo]!, ` (${zLabel} ${grid.z[lo]})`);
  const b = hi === lo ? a : plane(slices[hi]!, ` (${zLabel} ${grid.z[hi]})`);
  return {
    value: a.value + t * (b.value - a.value),
    notes,
    inputs: `${xLabel}=${round(x)}, ${yLabel}=${round(y)}, ${zLabel}=${round(z)}`,
    at: { x: clampTo(x, grid.x), y: a.y + t * (b.y - a.y), z: clampTo(z, grid.z) },
  };
}
