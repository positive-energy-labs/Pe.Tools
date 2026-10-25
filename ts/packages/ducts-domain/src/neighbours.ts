import type { DuctSnapshot } from "./types.ts";

export type Hop = "same-classification" | "all";
export interface NeighbourOptions {
  stubFt: number;
  hop: Hop;
}

/** A cut perpendicular to a duct's centreline. Keep the side toward `from`. */
export interface StubCut {
  id: number;
  from: number[];
  at: number[];
}
export interface Neighbour {
  group: string;
  /** The connecting subject element: equipment, plenum, fitting or shared duct. */
  unit: number;
  systems: string[];
  stub: number[];
  cuts: StubCut[];
}

type Element = DuctSnapshot["nodes"][number] | DuctSnapshot["segments"][number];
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));

/** The duct centreline from its entering connector, independent of Revit's curve orientation. */
export function enteredLine(element: Element, point: number[]): number[][] {
  if (!("polyline" in element) || element.polyline.length < 2) return [];
  const line = element.polyline;
  return distance(point, line[0]!) <= distance(point, line.at(-1)!) ? line : [...line].reverse();
}

/** A prefix measured along the actual polyline, including the interpolated crossing point. */
export function cutLine(line: readonly number[][], ft: number): number[][] {
  if (!line.length) return [];
  const out = [line[0]!];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!,
      b = line[i]!;
    const length = distance(a, b);
    if (length > ft) {
      out.push(a.map((v, k) => v + ((b[k]! - v) * ft) / length));
      break;
    }
    out.push(b);
    ft -= length;
  }
  return out;
}

/**
 * Walk connector edges out of the subject, including boundaries inside shared groups. Never use
 * mesh bounds to infer connectivity. Stop at the next equipment and at the developed-length cut.
 */
export function neighboursOf(
  snapshot: DuctSnapshot,
  open: ReadonlySet<number>,
  options: NeighbourOptions,
): Neighbour[] {
  if (!open.size || options.stubFt <= 0) return [];
  const elements = new Map([...snapshot.nodes, ...snapshot.segments].map((e) => [e.id, e]));
  const found: Neighbour[] = [];
  for (const id of open) {
    const boundary = elements.get(id);
    if (!boundary) continue;
    const sides = new Set(
      boundary.connectors
        .filter((c) => c.connectedTo && open.has(c.connectedTo.elementId))
        .map((c) => c.classification),
    );
    for (const port of boundary.connectors) {
      const peer = port.connectedTo;
      if (!peer || open.has(peer.elementId)) continue;
      if (
        boundary.kind === "equipment" &&
        options.hop === "same-classification" &&
        (!port.classification || !sides.has(port.classification))
      )
        continue;
      const first = elements.get(peer.elementId);
      if (!first?.groupId) continue;
      const stub = new Set<number>();
      const cuts = new Map<number, StubCut>();
      const reached = new Map<string, number>();
      const queue = [{ id: peer.elementId, port: peer.connector, ft: 0 }];
      while (queue.length) {
        queue.sort((a, b) => b.ft - a.ft);
        const step = queue.pop()!;
        const key = `${step.id}:${step.port}`;
        if (
          open.has(step.id) ||
          step.ft >= options.stubFt ||
          (reached.get(key) ?? Infinity) <= step.ft
        )
          continue;
        reached.set(key, step.ft);
        const element = elements.get(step.id);
        const entry = element?.connectors.find((c) => c.index === step.port);
        if (!element || !entry) continue;
        stub.add(element.id);
        if (element.kind === "equipment") continue;
        const remaining = options.stubFt - step.ft;
        const line = enteredLine(element, entry.point);
        const length = "lengthFt" in element ? element.lengthFt : 0;
        if (length > remaining && line.length > 1) {
          const prefix = cutLine(line, remaining);
          cuts.set(element.id, { id: element.id, from: prefix.at(-2)!, at: prefix.at(-1)! });
          continue;
        }
        for (const exit of element.connectors) {
          if (exit === entry || !exit.connectedTo) continue;
          const ft = step.ft + (length || distance(entry.point, exit.point));
          queue.push({ id: exit.connectedTo.elementId, port: exit.connectedTo.connector, ft });
        }
      }
      if (!stub.size) continue;
      found.push({
        group: first.groupId,
        unit: id,
        systems: [...new Set([...stub].flatMap((s) => elements.get(s)?.systemName || []))],
        stub: [...stub],
        cuts: [...cuts.values()],
      });
    }
  }
  return found;
}
