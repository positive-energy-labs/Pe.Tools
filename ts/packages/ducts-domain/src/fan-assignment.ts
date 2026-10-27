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

/** Units owed a base, with the systems that must be split in Revit before one can be named. */
export type OwedBase = Map<number, FanAssignment[]> & { split?: Map<string, number[]> };

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

/**
 * Every unit whose role is fan while no system names it base equipment, with the systems it could be
 * made the fan of. A unit already some system's base is answered; one with no candidate is left out.
 * A system takes one base equipment, so it is offered once: to its network's lead fan (`lead`, the
 * fan that owns the trunk) when one is known. A system whose candidate fans sit in separate networks
 * (SA 19 on Project A: FC-17's and FC-35's) is offered to none; it is returned in `split` to be split in
 * Revit first.
 */
export function fansOwedBase(
  snapshot: Shape,
  roles: ReadonlyMap<number, { role: "fan" | "passive" }>,
  lead: (group: string) => number | null = () => null,
): OwedBase {
  const based = new Set(
    (snapshot.systems ?? []).map((s) => s.baseEquipmentId).filter((id) => id != null),
  );
  const offers: FanAssignment[] = [];
  for (const [id, r] of roles) {
    if (r.role !== "fan" || based.has(id)) continue;
    offers.push(...fanCandidates(snapshot, id));
  }
  // The networks a unit offers a system from: the groups it roots that carry that system.
  const networks = (a: FanAssignment) =>
    (indexOf(snapshot).groups.get(a.unitId) ?? [])
      .filter((g) => g.systemNames.includes(a.system))
      .map((g) => g.id);
  const split = new Map<string, number[]>();
  const bySystem = new Map<string, FanAssignment[]>();
  for (const a of offers) bySystem.set(a.system, [...(bySystem.get(a.system) ?? []), a]);
  const kept = [...bySystem.values()].flatMap((list) => {
    const groups = new Set(list.flatMap(networks));
    if (groups.size > 1 && new Set(list.map((a) => a.unitId)).size > 1) {
      split.set(
        list[0]!.system,
        [...new Set(list.map((a) => a.unitId))].sort((a, b) => a - b),
      );
      return [];
    }
    const head = groups.size === 1 ? lead([...groups][0]!) : null;
    return head != null && list.some((a) => a.unitId === head)
      ? list.filter((a) => a.unitId === head)
      : list;
  });
  const out: OwedBase = new Map();
  for (const a of kept) out.set(a.unitId, [...(out.get(a.unitId) ?? []), a]);
  for (const list of out.values()) list.sort((a, b) => a.system.localeCompare(b.system));
  if (split.size) out.split = split;
  return out;
}
