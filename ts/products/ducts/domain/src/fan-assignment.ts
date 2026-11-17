/**
 * Where "make FC-17 the fan of SA 19" is offered (pressure-drop ledger, 2026-10-21): Revit's Duct
 * Systems > Select Equipment as a Pe verb, `ducts.assign-fan`. Base equipment is the first rung of
 * the fan suggestion (`unit-roles.ts`), so naming it makes the suggestion Revit's own state. Offered for
 * a system the unit's own groups carry, of a classification one of its ports has, that has no base
 * equipment yet (the op refuses a swap: it drops the old base from the members). The op re-checks
 * all of it against the model (the port must be in that system or on its ducts); this only decides
 * where the verb is drawn.
 */
import type { DuctSnapshot } from "./types.ts";

export interface FanAssignment {
  unitId: number;
  systemId: number;
  system: string;
}

type Shape = Pick<DuctSnapshot, "groups" | "nodes"> & Partial<Pick<DuctSnapshot, "systems">>;

// Derived lookup only, not a second source of model truth: snapshots are immutable and a new read
// gets a new identity. Eligibility is still checked per call; native mutation revalidates in Revit.
const indexes = new WeakMap<Shape, ReturnType<typeof buildIndex>>();
function buildIndex(snapshot: Shape) {
  const nodes = new Map<number, Shape["nodes"][number]>();
  const groups = new Map<number, Shape["groups"]>();
  const systems = new Map<string, NonNullable<Shape["systems"]>>();
  for (const node of snapshot.nodes) if (!nodes.has(node.id)) nodes.set(node.id, node);
  for (const group of snapshot.groups)
    for (const id of new Set(group.rootIds)) {
      const list = groups.get(id) ?? [];
      list.push(group);
      groups.set(id, list);
    }
  for (const system of snapshot.systems ?? []) {
    const list = systems.get(system.name) ?? [];
    list.push(system);
    systems.set(system.name, list);
  }
  return { nodes, groups, systems };
}
function indexOf(snapshot: Shape) {
  let index = indexes.get(snapshot);
  if (!index) indexes.set(snapshot, (index = buildIndex(snapshot)));
  return index;
}

/** The systems a unit could be made the fan of; `group` narrows to that group's systems. */
export function fanCandidates(snapshot: Shape, unitId: number, group?: string): FanAssignment[] {
  const index = indexOf(snapshot);
  const unit = index.nodes.get(unitId);
  if (unit?.kind !== "equipment") return [];
  const classes = new Set(unit.connectors.map((c) => c.classification).filter(Boolean));
  const names = new Set(
    (index.groups.get(unitId) ?? [])
      .filter((g) => !group || g.id === group)
      .flatMap((g) => g.systemNames),
  );
  return [...names]
    .flatMap((name) => index.systems.get(name) ?? [])
    .filter((s) => s.baseEquipmentId == null && classes.has(s.classification))
    .map((s) => ({ unitId, systemId: s.id, system: s.name }))
    .sort((a, b) => a.system.localeCompare(b.system));
}
