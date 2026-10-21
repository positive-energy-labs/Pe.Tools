/**
 * Where "make FC-17 the fan of SA 19" is offered (pressure-drop ledger, 2026-10-21): Revit's Duct
 * Systems > Select Equipment as a Pe verb, `ducts.assign-fan`. Base equipment is the first rung of
 * the fan proposal (`unit-roles.ts`), so naming it makes the proposal Revit's own state. Offered for
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

/** The systems a unit could be made the fan of; `group` narrows to that group's systems. */
export function fanCandidates(snapshot: Shape, unitId: number, group?: string): FanAssignment[] {
  const unit = snapshot.nodes.find((n) => n.id === unitId);
  if (unit?.kind !== "equipment") return [];
  const classes = new Set(unit.connectors.map((c) => c.classification).filter(Boolean));
  const names = new Set(
    snapshot.groups
      .filter((g) => g.rootIds.includes(unitId) && (!group || g.id === group))
      .flatMap((g) => g.systemNames),
  );
  return (snapshot.systems ?? [])
    .filter((s) => s.baseEquipmentId == null && names.has(s.name) && classes.has(s.classification))
    .map((s) => ({ unitId, systemId: s.id, system: s.name }))
    .sort((a, b) => a.system.localeCompare(b.system));
}

/**
 * Every unit whose role is fan while no system names it base equipment, with the systems it could be
 * made the fan of. A unit already some system's base is answered; one with no candidate is left out.
 */
export function fansOwedBase(
  snapshot: Shape,
  roles: ReadonlyMap<number, { role: "fan" | "passive" }>,
): Map<number, FanAssignment[]> {
  const based = new Set(
    (snapshot.systems ?? []).map((s) => s.baseEquipmentId).filter((id) => id != null),
  );
  const out = new Map<number, FanAssignment[]>();
  for (const [id, r] of roles) {
    if (r.role !== "fan" || based.has(id)) continue;
    const found = fanCandidates(snapshot, id);
    if (found.length) out.set(id, found);
  }
  return out;
}
