import type { MepSegmentSizes, MepSystemMembers } from "@pe/host-contracts/generated";
import { pipeKey } from "./schema.ts";

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
  /** Pipe segment UniqueId; its sizes are this pipe's catalog. */
  segment: string | null;
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
export function size(pipes: readonly Pipe[], catalogs: Readonly<Record<string, readonly Size[]>>, limits: Limits,
  chosen: Readonly<Record<string, number>>, rooted = true) {
  const rows = pipes.map((pipe) => {
    const sizes = [...(catalogs[pipe.segment ?? ""] ?? [])].sort((a, b) => a.nominal - b.nominal);
    const current = sizes.find((s) => s.nominal === pipe.diameter);
    const flow = pipe.flow;
    const candidate = flow ? (sizes.find((s) => fits(flow, s, limits))?.nominal ?? null) : null;
    const status: Status = !flow ? "no-flow"
      : !current || !fits(flow, current, limits) ? "undersized"
      : candidate !== null && pipe.diameter > candidate ? "oversized" : "ok";
    return { ...pipe, candidate, chosen: chosen[pipeKey(pipe.uniqueId)] ?? null, status };
  });
  const unresolved = rows.flatMap((row): Closer[] =>
    row.status === "no-flow" ? [{ uniqueId: row.uniqueId, kind: "no-flow" }]
    : row.status === "undersized" ? [{ uniqueId: row.uniqueId, kind: "exceeds-limit" }]
    : row.candidate === null ? [{ uniqueId: row.uniqueId, kind: "no-catalog-size" }] : []);
  const greyed = unresolved.length > 0 || !rooted;
  return { rows, unresolved, pumpHead: { pa: greyed ? null : head(rows, catalogs), greyed } };
}

/** Longest pump-to-leaf friction path, Pa, on the chosen size (else the current one); null when
 * a chosen size is not in the catalog. */
function head(rows: readonly (Pipe & { chosen: number | null })[], catalogs: Readonly<Record<string, readonly Size[]>>) {
  const loss = new Map<string, number>();
  for (const row of rows) {
    const inner = catalogs[row.segment ?? ""]?.find((s) => s.nominal === (row.chosen ?? row.diameter))?.inner;
    if (inner === undefined || !row.flow) return null;
    loss.set(row.uniqueId, hydraulics(row.flow, inner).friction * row.length);
  }
  const walk = (upstream: string | null): number =>
    Math.max(0, ...rows.filter((r) => r.upstream === upstream).map((r) => (loss.get(r.uniqueId) ?? 0) + walk(r.uniqueId)));
  return walk(null);
}

const mm = (ft: number) => Math.round(ft * 3048) / 10;
const fact = (f: MepSystemMembers.Res.MepFactOfNullableDouble) => (f.state === "Value" ? f.value : null);

/** Revit's read (internal feet and cfs) into pipes in mm, L/s and m, rooted by a walk across connector
 * peers from the source's base connector: Revit reports Bidirectional there, so direction cannot root it.
 * `rooted` is false when a pipe is not reached from the source; the pump head then stays greyed. */
export function fromRevit(read: MepSystemMembers.Res.Response, segments: MepSegmentSizes.Res.Response) {
  const byId = new Map(read.elements.map((m) => [m.uniqueId, m]));
  const system = read.systems.find((s) => s.uniqueId === read.systemUniqueId);
  const source = system?.source.state === "Value" ? system.source.value : null;
  const start = source?.connectors.find((c) => c.connectorId === source.baseConnectorId)?.peers ?? [];
  const upstream = new Map<string, string | null>();
  // ponytail: breadth-first spanning tree; a looped network gets one tree, not every path.
  const queue: [string, string | null][] = start.map((peer) => [peer.uniqueId, null]);
  for (let item = queue.shift(); item; item = queue.shift()) {
    const [id, up] = item, member = byId.get(id);
    if (!member || upstream.has(id)) continue;
    upstream.set(id, up);
    const next = member.kind === "curve" ? id : up;
    for (const c of member.connectors) for (const peer of c.peers) queue.push([peer.uniqueId, next]);
  }
  const curves = read.elements.filter((m) => m.kind === "curve");
  const pipes = curves.map((m): Pipe => {
    const flow = fact(m.flowCubicFeetPerSecond), nominal = fact(m.nominalDiameterFt);
    return {
      uniqueId: m.uniqueId, label: `${m.name} ${m.elementId}`,
      // A missing nominal reads 0: no catalog size matches it, so the pipe lands in the unresolved list.
      flow: flow === null ? null : flow * 28.316846592, diameter: nominal === null ? 0 : mm(nominal),
      length: (fact(m.lengthFt) ?? 0) * 0.3048, upstream: upstream.get(m.uniqueId) ?? null,
      segment: m.segment.state === "Value" ? m.segment.value.uniqueId : null,
    };
  });
  const catalogs = Object.fromEntries(segments.segments.map((s) =>
    [s.uniqueId, s.sizes.map((z) => ({ nominal: mm(z.nominalDiameterFt), inner: mm(z.innerDiameterFt) }))]));
  return { pipes, catalogs, rooted: curves.every((m) => upstream.has(m.uniqueId)) };
}
