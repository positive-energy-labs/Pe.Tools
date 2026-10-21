/**
 * Every unit's role, `fan` or `passive`, with why (pressure-drop ledger, 2026-10-21, multi-fan
 * spike). A ruling wins: a role the model's store holds (`ruled`) or one Work stages (`staged`).
 * Without one the role is proposed, automatically and never staged, from Revit's own state first
 * (Pe manages Revit state):
 * 1. a unit that is the base equipment of a Revit system its own groups carry is a `fan`
 *    ("base equipment of SA 19");
 * 2. else a unit that states a design flow (`equipmentFlows`: staged, else the FanFlow slot) is a
 *    `fan` ("airflow in <slot>");
 * 3. else it is `passive` ("no airflow, not base equipment"): inline gear such as a filter chassis
 *    or a silencer, which then passes air through (`pass-through.ts`).
 * A multi-root finding stands only while more than one root of the group is a fan after this.
 */
import type { DuctUnitRole } from "@pe/agent-contracts";

import type { EquipmentFlow } from "./terminal-flows.ts";
import type { DuctSnapshot } from "./types.ts";

type Role = DuctUnitRole["role"];
export type UnitRoleWhy = "ruled" | "staged" | "proposed";

export interface UnitRole {
  role: Role;
  why: UnitRoleWhy;
  /** The proposal's ground in a person's words; a ruling names who ruled. */
  reason: string;
}

/** A design flow at or below this is no flow, cfm. */
export const NO_FLOW_CFM = 0;

/**
 * The role of every unit that roots a group. `staged` is Work's roles as every reader sees them
 * (`withStoredRulings`: the store's rulings under Work's own), `store` tells a ruling from a pending one.
 */
export function unitRoles(
  snapshot: Pick<DuctSnapshot, "groups" | "nodes" | "store" | "slots"> &
    Partial<Pick<DuctSnapshot, "systems">>,
  flows: ReadonlyMap<number, EquipmentFlow>,
  staged: Readonly<Record<string, { role: Role }>>,
): Map<number, UnitRole> {
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  // The system names each unit's own groups carry: a base-equipment claim counts only there.
  const served = new Map<number, Set<string>>();
  for (const g of snapshot.groups)
    for (const id of g.rootIds) {
      const set = served.get(id) ?? served.set(id, new Set()).get(id)!;
      for (const name of g.systemNames) set.add(name);
    }
  const baseOf = new Map<number, string[]>();
  for (const sys of snapshot.systems ?? [])
    if (sys.baseEquipmentId != null && served.get(sys.baseEquipmentId)?.has(sys.name))
      baseOf.set(sys.baseEquipmentId, [...(baseOf.get(sys.baseEquipmentId) ?? []), sys.name]);
  const out = new Map<number, UnitRole>();
  for (const id of [...served.keys()].sort((a, b) => a - b)) {
    const ruling = staged[String(id)]?.role;
    if (ruling) {
      const stored = snapshot.store?.roles?.[String(id)]?.role;
      out.set(
        id,
        stored === ruling
          ? { role: ruling, why: "ruled", reason: "ruled in the model" }
          : { role: ruling, why: "staged", reason: "staged, not yet written" },
      );
      continue;
    }
    const base = baseOf.get(id);
    if (base?.length) {
      out.set(id, { role: "fan", why: "proposed", reason: `base equipment of ${base.sort().join(", ")}` });
      continue;
    }
    const flow = flows.get(id);
    if (flow?.cfm != null && flow.cfm > NO_FLOW_CFM) {
      const slot =
        flow.source === "override"
          ? "a staged unit flow"
          : (nodes.get(id)?.flowParameter ?? snapshot.slots?.fanFlow ?? "the FanFlow slot");
      out.set(id, { role: "fan", why: "proposed", reason: `airflow in ${slot} (${flow.cfm} cfm)` });
      continue;
    }
    out.set(id, { role: "passive", why: "proposed", reason: "no airflow, not base equipment" });
  }
  return out;
}

/** The units whose role is `passive`. */
export const passiveOf = (roles: ReadonlyMap<number, UnitRole>) =>
  new Set([...roles].flatMap(([id, r]) => (r.role === "passive" ? [id] : [])));
