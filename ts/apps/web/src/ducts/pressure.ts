/** Display projections of the solver receipt. No flow, coefficient or budget is solved here. */
import type { DuctSnapshot } from "./readiness";

export type Pressure = NonNullable<DuctSnapshot["pressure"]>;
export interface PressurePoint {
  drop: number | null;
  atPoint: number | null;
  complete: boolean;
  assumptionsUsed: string[];
  pointAssumptions: string[];
  segments: Pressure["segments"];
  fittings: Pressure["fittings"];
}

type Segment = DuctSnapshot["segments"][number];
/** Distance along the captured polyline, scaled to the captured developed length. */
function position(segment: Segment, point: number[]): number | null {
  let traveled = 0;
  let nearest = Infinity;
  let at = 0;
  for (let i = 1; i < segment.polyline.length; i++) {
    const a = segment.polyline[i - 1]!;
    const b = segment.polyline[i]!;
    const delta = b.map((v, j) => v - a[j]!);
    const squared = delta.reduce((sum, v) => sum + v * v, 0);
    if (!squared) continue;
    const t = Math.max(
      0,
      Math.min(1, delta.reduce((sum, v, j) => sum + (point[j]! - a[j]!) * v, 0) / squared),
    );
    const distance = delta.reduce((sum, v, j) => sum + (point[j]! - a[j]! - t * v) ** 2, 0);
    if (distance < nearest) {
      nearest = distance;
      at = traveled + t * Math.sqrt(squared);
    }
    traveled += Math.sqrt(squared);
  }
  return traveled > 0 ? (at / traveled) * segment.lengthFt : segment.lengthFt === 0 ? 0 : null;
}

export function pressurePoints(snapshot: DuctSnapshot, group: string): Map<number, PressurePoint> {
  const points = new Map<number, PressurePoint>();
  const pressure = snapshot.pressure;
  if (!pressure) return points;
  const point = (id: number) => {
    let value = points.get(id);
    if (!value) {
      value = {
        drop: null,
        atPoint: null,
        complete: true,
        assumptionsUsed: [],
        pointAssumptions: [],
        segments: [],
        fittings: [],
      };
      points.set(id, value);
    }
    return value;
  };
  for (const row of pressure.segments.filter((s) => s.groupId === group))
    point(row.segmentId).segments.push(row);
  for (const row of pressure.fittings.filter((s) => s.groupId === group))
    point(row.fittingId).fittings.push(row);
  for (const value of points.values()) {
    // A segment's intervals add; a fitting's alternative legs do not. Individual legs remain inspectable.
    value.drop = value.segments.length
      ? value.segments.reduce((sum, s) => sum + s.friction.pressureDropInWg, 0)
      : Math.max(...value.fittings.map((f) => f.pressureDropInWg));
    const rows = [...value.segments, ...value.fittings];
    value.complete = rows.every((r) => r.isComplete);
    value.assumptionsUsed = [...new Set(rows.flatMap((r) => r.assumptionsUsed))];
  }
  const parts = new Map([...snapshot.nodes, ...snapshot.segments].map((p) => [p.id, p]));
  const segments = new Map(snapshot.segments.map((s) => [s.id, s]));
  // Follow only solver-certified terminal paths. At a tap, integrate just the traversed intervals.
  for (const terminal of pressure.terminals.filter((t) => t.groupId === group)) {
    let cumulative: number | null = 0;
    let complete = true;
    const used = new Set<string>();
    for (let i = 0; i < terminal.path.length; i++) {
      const id = terminal.path[i]!;
      const next = terminal.path[i + 1];
      const previous = terminal.path[i - 1];
      const value = point(id);
      let rows: (Pressure["segments"][number] | Pressure["fittings"][number])[] = [];
      let loss: number | null = 0;
      const segment = segments.get(id);
      if (segment && next != null) {
        const entry = segment.connectors.find((c) => c.connectedTo?.elementId === previous);
        const exit = segment.connectors.find((c) => c.connectedTo?.elementId === next);
        const from = entry ? position(segment, entry.point) : null;
        const to = exit ? position(segment, exit.point) : null;
        if (from == null || to == null || !value.segments.length) loss = null;
        else {
          const lo = Math.min(from, to),
            hi = Math.max(from, to);
          rows = value.segments.filter((r) => r.endFt > lo + 1e-8 && r.startFt < hi - 1e-8);
          loss = rows.reduce((sum, r) => {
            const s = r as Pressure["segments"][number];
            return (
              sum +
              (s.friction.pressureDropInWg *
                Math.max(0, Math.min(hi, s.endFt) - Math.max(lo, s.startFt))) /
                (s.endFt - s.startFt)
            );
          }, 0);
          if (hi > lo + 1e-8 && !rows.length) loss = null;
        }
      } else if (parts.get(id)?.kind === "fitting" && next != null) {
        const outlet = parts.get(id)?.connectors.find((c) => c.connectedTo?.elementId === next);
        const leg = value.fittings.find((f) => f.outletConnector === outlet?.index);
        rows = leg ? [leg] : [];
        loss = leg?.pressureDropInWg ?? null;
      }
      for (const row of rows) for (const dependency of row.assumptionsUsed) used.add(dependency);
      complete &&= rows.every((r) => r.isComplete);
      cumulative = cumulative == null || loss == null ? null : cumulative + loss;
      if (cumulative != null && (value.atPoint == null || cumulative >= value.atPoint)) {
        value.atPoint = cumulative;
        value.pointAssumptions = [...used];
      }
      value.complete &&= complete;
    }
  }
  return points;
}

export const groupPressure = (snapshot: DuctSnapshot, group: string) =>
  snapshot.pressure?.groups.find((g) => g.groupId === group);
