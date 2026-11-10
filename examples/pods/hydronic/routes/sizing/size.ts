/** Pure sizing: everything the product decides, with no Revit and no kernel. */
export type Pipe = {
  uniqueId: string;
  label: string;
  /** Design flow, L/s; null when the model carries none. */
  flow: number | null;
  /** Current nominal diameter, mm. */
  diameter: number;
  length: number;
  /** Upstream pipe, or null at the pump; the head walk assumes a tree. */
  upstream: string | null;
};
export type Size = { nominal: number; inner: number };
export type Limits = { maxVelocity: number; maxFriction: number };
export type Status = "ok" | "undersized" | "oversized" | "no-flow";
export type Closer = { uniqueId: string; kind: "no-flow" | "exceeds-limit" | "no-catalog-size" };

// ponytail: water at 60 C in commercial steel; add a fluid input when a glycol job needs one.
const RHO = 983, NU = 4.75e-7, ROUGHNESS = 4.5e-5;

/** Velocity (m/s) and Darcy friction (Pa/m) of `flow` L/s through `inner` mm. */
export function hydraulics(flow: number, inner: number) {
  const d = inner / 1000, v = flow / 1000 / ((Math.PI * d * d) / 4), re = (v * d) / NU;
  const f = re < 2300 ? 64 / re : 0.25 / Math.log10(ROUGHNESS / (3.7 * d) + 5.74 / re ** 0.9) ** 2;
  return { velocity: v, friction: (f * RHO * v * v) / (2 * d) };
}

const fits = (flow: number, size: Size, limits: Limits) => {
  const h = hydraulics(flow, size.inner);
  return h.velocity <= limits.maxVelocity && h.friction <= limits.maxFriction;
};

/** One row per pipe and the unresolved list; the pump head stays greyed until that list is empty. */
export function size(pipes: readonly Pipe[], catalog: readonly Size[], limits: Limits, chosen: Readonly<Record<string, number>>) {
  const sizes = [...catalog].sort((a, b) => a.nominal - b.nominal);
  const rows = pipes.map((pipe) => {
    const current = sizes.find((s) => s.nominal === pipe.diameter);
    const flow = pipe.flow;
    const candidate = flow ? (sizes.find((s) => fits(flow, s, limits))?.nominal ?? null) : null;
    const status: Status = !flow ? "no-flow"
      : !current || !fits(flow, current, limits) ? "undersized"
      : candidate !== null && pipe.diameter > candidate ? "oversized" : "ok";
    return { ...pipe, candidate, chosen: chosen[pipe.uniqueId] ?? null, status };
  });
  const unresolved = rows.flatMap((row): Closer[] =>
    row.status === "no-flow" ? [{ uniqueId: row.uniqueId, kind: "no-flow" }]
    : row.status === "undersized" ? [{ uniqueId: row.uniqueId, kind: "exceeds-limit" }]
    : row.candidate === null ? [{ uniqueId: row.uniqueId, kind: "no-catalog-size" }] : []);
  return { rows, unresolved, pumpHead: { pa: unresolved.length ? null : head(rows, sizes), greyed: unresolved.length > 0 } };
}

/** Longest pump-to-leaf friction path, Pa, on the chosen size (else the current one); null when
 * a chosen size is not in the catalog. */
function head(rows: readonly (Pipe & { chosen: number | null })[], sizes: readonly Size[]) {
  const loss = new Map<string, number>();
  for (const row of rows) {
    const inner = sizes.find((s) => s.nominal === (row.chosen ?? row.diameter))?.inner;
    if (inner === undefined || !row.flow) return null;
    loss.set(row.uniqueId, hydraulics(row.flow, inner).friction * row.length);
  }
  const walk = (upstream: string | null): number =>
    Math.max(0, ...rows.filter((r) => r.upstream === upstream).map((r) => (loss.get(r.uniqueId) ?? 0) + walk(r.uniqueId)));
  return walk(null);
}
