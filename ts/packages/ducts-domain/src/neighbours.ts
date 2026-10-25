/**
 * One hop: the duct networks a unit joins to the open ones. A unit is never in a group; it roots
 * every group it has a port into (`rootIds`), so the groups an open group's units also root, and
 * that are not open, are its neighbours, joined through that unit. Each shows as a stub: the
 * elements near the unit, not the whole network.
 *
 * A heat-recovery unit roots both airstreams (an ERV's fresh-air and exhaust sides sit on one
 * box; neighbour census 2026-10-24, RV-26), so by default a hop keeps to the airstream: the unit's
 * port into the neighbour must carry the classification of a port into an open group. That drops
 * a dehumidifier's or air handler's return-to-supply hop too; `hop: "all"` takes every port.
 *
 * Shared groups already show whole (ledger 2026-10-21), so nothing here partitions inside one.
 */
import { groupTree } from "./topology.ts";
import type { DuctSnapshot } from "./types.ts";

/** Which of a unit's ports a hop may leave by: any, or only those of an open port's classification. */
export type Hop = "same-classification" | "all";

export interface NeighbourOptions {
  /** A stub keeps the elements whose far end is this close to the unit, developed ft. */
  stubFt: number;
  hop: Hop;
  /** Maximum neighbouring networks from one unit, in snapshot order; omitted means no cap. */
  neighbourCap?: number;
}

export interface Neighbour {
  /** The neighbour group: rooted by `unit` too, and not open. */
  group: string;
  /** The unit that joins it to an open group. */
  unit: number;
  /** The stub's own Revit system names, in stub order. */
  systems: string[];
  /** The element on the unit's port, then every element whose far end is within `stubFt` of it. */
  stub: number[];
}

type Element = { id: number; groupId?: string | null; systemName?: string | null };

const elementIndexes = new WeakMap<DuctSnapshot, Map<number, Element>>();
const elementsOf = (snapshot: DuctSnapshot) => {
  let index = elementIndexes.get(snapshot);
  if (!index) {
    index = new Map<number, Element>();
    for (const e of [...snapshot.nodes, ...snapshot.segments]) index.set(e.id, e);
    elementIndexes.set(snapshot, index);
  }
  return index;
};

/** The neighbours of the open groups, one per (group, unit), in open-group then root order. */
export function neighboursOf(
  snapshot: DuctSnapshot,
  open: readonly string[],
  options: NeighbourOptions,
): Neighbour[] {
  const opened = new Set(open);
  const elements = elementsOf(snapshot);
  const groups = new Map(snapshot.groups.map((g) => [g.id, g]));
  const rooting = new Map<number, string[]>();
  for (const g of snapshot.groups)
    for (const u of g.rootIds) (rooting.get(u) ?? rooting.set(u, []).get(u)!).push(g.id);
  // The classifications of a unit's ports into one group.
  const portsInto = (unit: number, group: string) =>
    new Set(
      (elements.get(unit) as DuctSnapshot["nodes"][number] | undefined)?.connectors
        .filter((c) => c.connectedTo && elements.get(c.connectedTo.elementId)?.groupId === group)
        .flatMap((c) =>
          c.classification && ["SupplyAir", "ReturnAir", "ExhaustAir"].includes(c.classification)
            ? [c.classification]
            : [],
        ) ?? [],
    );

  const found: Neighbour[] = [];
  const units = [...new Set(open.flatMap((g) => groups.get(g)?.rootIds ?? []))];
  for (const unit of units) {
    let count = 0;
    const sides = new Set(
      open
        .filter((g) => groups.get(g)?.rootIds.includes(unit))
        .flatMap((g) => [...portsInto(unit, g)]),
    );
    for (const group of rooting.get(unit) ?? []) {
      if (count >= (options.neighbourCap ?? Infinity)) break;
      if (opened.has(group)) continue;
      if (
        options.hop === "same-classification" &&
        ![...portsInto(unit, group)].some((c) => sides.has(c))
      )
        continue;
      const tree = groupTree(snapshot, group, unit);
      if (tree.root?.equipment !== unit) continue;
      // ponytail: whole elements, not clipped geometry: a stub ends at the last element whose far
      // end is inside stubFt, plus the one on the port however long it is.
      const stub = [tree.root.element];
      for (let i = 0; i < stub.length; i++)
        for (const child of tree.children.get(stub[i]!) ?? [])
          if ((tree.dist.get(child) ?? Infinity) <= options.stubFt) stub.push(child);
      const systems = [...new Set(stub.flatMap((id) => elements.get(id)?.systemName || []))];
      found.push({ group, unit, systems, stub });
      count++;
    }
  }
  return found;
}
