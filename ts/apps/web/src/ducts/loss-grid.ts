/**
 * ASHRAE fitting-coefficient grids and their interpolation. Pure.
 * A table is one grid per result (`Co`, or `Cb` / `Cs` for a tee). 1-D grids vary with x only;
 * 2-D grids have one row per y and one column per x. Interpolation is linear in 1-D, bilinear in
 * 2-D (interpolate each row along x, then the column along y), clamped to the grid edge with a note
 * (as `ctable.py` `i1` / `lookup`). Axes must ascend.
 */

/** The shape `ducts.tables` returns for one result of one table. */
export interface Grid {
  title: string;
  xLabel: string;
  x: number[];
  yLabel?: string;
  y?: number[];
  grid: number[][] | number[];
}

/** TABLE (upper case, e.g. "CD3-2") -> result ("Co", "Cb", "Cs") -> grid. */
export type Grids = Record<string, Record<string, Grid>>;

export interface Lookup {
  value: number;
  /** One note per clamped axis. */
  notes: string[];
  inputs: string;
}

export class GridError extends Error {}

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

const flat = (grid: Grid): grid is Grid & { grid: number[] } => !grid.y;

/** Look `x` (and `y` for a 2-D grid) up; throws `GridError` when the inputs do not fit the grid. */
export function lookupGrid(grid: Grid, x: number, y?: number | null): Lookup {
  if (!Number.isFinite(x)) throw new GridError(`${grid.xLabel} is not a number`);
  const notes: string[] = [];
  const note = (n?: string) => n && notes.push(n);
  if (flat(grid)) {
    if (y != null) throw new GridError(`${grid.title} takes ${grid.xLabel} only`);
    const [value, n] = interp1(x, grid.x, grid.grid, grid.xLabel);
    note(n);
    return { value, notes, inputs: `${grid.xLabel}=${+x.toPrecision(4)}` };
  }
  if (y == null || !Number.isFinite(y))
    throw new GridError(`${grid.title} needs ${grid.yLabel ?? "y"}`);
  const rows = grid.grid as number[][];
  const column = rows.map((row) => {
    const [v, n] = interp1(x, grid.x, row, grid.xLabel);
    if (n && !notes.includes(n)) notes.push(n);
    return v;
  });
  const [value, n] = interp1(y, grid.y!, column, grid.yLabel ?? "y");
  note(n);
  return {
    value,
    notes,
    inputs: `${grid.xLabel}=${+x.toPrecision(4)}, ${grid.yLabel ?? "y"}=${+y.toPrecision(4)}`,
  };
}
