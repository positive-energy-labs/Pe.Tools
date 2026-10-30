/**
 * Stubs past a unit this fan's walk stops at (kaitpw 2026-10-30, "yes show", then "the stubs that
 * fade out in color"): MUAS-1's supply stops at the outdoor-air inlets of RV-15 and RV-7 and at
 * FC-23's return trunk, because each of those carries its own fan. Every other port of each such
 * unit (an ERV's supply, stale-air and exhaust) runs out as a short stub, the network stage's
 * one-hop mark, so a person sees where that air goes next. Context only: never priced, credited or
 * added to any total.
 */
import { cutLine, enteredLine, type StubCut } from "../neighbours.ts";
import type { DuctSnapshot } from "../types.ts";
import type { Sheet } from "./types.ts";

/** How far a stub runs from its unit's port, along the duct (kaitpw: "the first 10-15 ft"). */
export const BEYOND_STUB_FT = 15;

export interface BeyondUnit {
  /** The unit this fan's walk stopped at; its own fan moves the air past it. */
  unitId: number;
  mark: string;
  /** Elements within the stub reach of the unit's ports; none of them in this fan's walk. */
  elementIds: number[];
  /** The duct a stub ends in is cut at the reach, keeping the side toward the unit. */
  cuts: StubCut[];
}

const STOPS = new Set(["roster-fan-port", "joins-other-fan", "sibling-fan"]);

/** Each other unit a path of either pass ends at, with the elements those paths stopped on. */
export function stoppingUnits(sheet: Pick<Sheet, "fan" | "paths" | "assumed">) {
  const units = new Map<number, Set<number>>();
  for (const path of [...sheet.paths, ...sheet.assumed.paths]) {
    const fan = path.end.fan;
    if (!STOPS.has(path.end.kind) || !fan || fan.unitId === sheet.fan.unitId) continue;
    const at = units.get(fan.unitId) ?? new Set<number>();
    at.add(path.end.elementId);
    units.set(fan.unitId, at);
  }
  return [...units]
    .sort(([a], [b]) => a - b)
    .map(([unitId, ends]) => ({ unitId, ends: [...ends].sort((a, b) => a - b) }));
}

type Element = DuctSnapshot["nodes"][number] | DuctSnapshot["segments"][number];
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(...a.map((v, i) => v - b[i]!));
const lengthOf = (line: readonly number[][]) =>
  line.slice(1).reduce((sum, p, i) => sum + distance(line[i]!, p), 0);

/**
 * Shortest-first over the snapshot's connectors from every port of each stopping unit (and of the
 * element its paths ended on), out to `stubFt` along the duct. Never enters this fan's walk or its
 * fan; a terminal or another equipment node is reached and not expanded; the duct that crosses the
 * reach is kept with a cut. An element past two stopping units is listed under the first (by id).
 */
export function beyondOf(
  snapshot: Pick<DuctSnapshot, "nodes" | "segments">,
  sheet: Pick<Sheet, "fan" | "paths" | "assumed" | "walkedElementIds">,
  markOf: (unitId: number) => string,
  stubFt = BEYOND_STUB_FT,
): BeyondUnit[] {
  const elements = new Map<number, Element>(
    [...snapshot.nodes, ...snapshot.segments].map((e) => [e.id, e]),
  );
  const kindOf = new Map(snapshot.nodes.map((n) => [n.id, n.kind as string]));
  // Either side's `connectedTo` names a joint; the point is where the joint sits.
  const joints = new Map<number, Map<number, number[]>>();
  const join = (a: number, b: number, at: number[]) => {
    if (a === b) return;
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      const of = joints.get(x) ?? joints.set(x, new Map()).get(x)!;
      if (!of.has(y)) of.set(y, at);
    }
  };
  for (const element of elements.values())
    for (const c of element.connectors)
      if (c.connectedTo) join(element.id, c.connectedTo.elementId, c.point as number[]);
  const walked = new Set([...sheet.walkedElementIds, sheet.fan.unitId]);
  const claimed = new Set<number>();
  return stoppingUnits(sheet).flatMap(({ unitId, ends }) => {
    const found = new Map<number, number>();
    const cuts: StubCut[] = [];
    if (!walked.has(unitId) && !claimed.has(unitId)) found.set(unitId, 0);
    // [element, joint point it is entered at, run so far]; seeds expand from each of their ports.
    const queue: [number, number[], number][] = [];
    const expand = (id: number, from: number[] | null, run: number) => {
      for (const [next, at] of joints.get(id) ?? []) {
        if (found.has(next) || walked.has(next) || claimed.has(next) || next === unitId) continue;
        queue.push([next, at, run + (from ? distance(from, at) : 0)]);
      }
    };
    for (const seed of [unitId, ...ends]) expand(seed, null, 0);
    while (queue.length) {
      queue.sort((a, b) => a[2] - b[2]);
      const [id, at, run] = queue.shift()!;
      if (found.has(id) || run >= stubFt) continue;
      const element = elements.get(id);
      found.set(id, run);
      if (!element) continue;
      if ("polyline" in element && element.polyline.length >= 2) {
        const line = enteredLine(element, at);
        const length = lengthOf(line);
        if (run + length > stubFt) {
          const kept = cutLine(line, stubFt - run);
          cuts.push({ id, from: kept[0]!, at: kept.at(-1)! });
          continue;
        }
        expand(id, line.at(-1)!, run + length);
        continue;
      }
      const kind = kindOf.get(id);
      if (kind === "terminal" || kind === "equipment") continue;
      expand(id, at, run);
    }
    const ids = [...found.keys()].sort((a, b) => a - b);
    for (const id of ids) claimed.add(id);
    return ids.length
      ? [{ unitId, mark: markOf(unitId), elementIds: ids, cuts: cuts.sort((a, b) => a.id - b.id) }]
      : [];
  });
}
