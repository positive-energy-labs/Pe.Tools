/**
 * Every unit's role, `fan` or `passive`, with why (pressure-drop ledger, 2026-10-21, multi-fan
 * spike). A ruling wins: a role the model's store holds (`ruled`) or one Work stages (`staged`).
 * Without one the role is proposed from the unit's design flow (`equipmentFlows`: staged, else the
 * FanFlow slot), automatically and never staged:
 * - a unit that states a design flow is proposed `fan`;
 * - a unit that states none is proposed `passive` when a unit it shares a group with states one
 *   (Chadds RA 8: the filter chassis FR-1 beside air handler FC-33);
 * - a unit that states none beside units that state none is left a `fan` (`default`): with no
 *   flow anywhere in its groups there is nothing to tell a fan from inline gear, and calling every
 *   unit passive would leave each such group with no air mover.
 * A multi-root finding stands only while more than one root of the group is a fan after this.
 */
import type { DuctUnitRole } from "@pe/agent-contracts";

import { markOf, type EquipmentFlow } from "./terminal-flows.ts";
import type { DuctSnapshot } from "./types.ts";

type Role = DuctUnitRole["role"];
export type UnitRoleWhy = "ruled" | "staged" | "proposed" | "default";

export interface UnitRole {
  role: Role;
  why: UnitRoleWhy;
  /** The proposal or the default in a person's words; a ruling names who ruled. */
  reason: string;
}

/** A design flow at or below this is no flow, cfm. */
export const NO_FLOW_CFM = 0;

const flowOf = (flows: ReadonlyMap<number, EquipmentFlow>, id: number) => {
  const cfm = flows.get(id)?.cfm ?? null;
  return cfm != null && cfm > NO_FLOW_CFM ? cfm : null;
};

/**
 * The role of every unit that roots a group. `staged` is Work's roles as every reader sees them
 * (`withStoredRulings`: the store's rulings under Work's own), `store` tells a ruling from a pending one.
 */
export function unitRoles(
  snapshot: Pick<DuctSnapshot, "groups" | "nodes" | "store">,
  flows: ReadonlyMap<number, EquipmentFlow>,
  staged: Readonly<Record<string, { role: Role }>>,
): Map<number, UnitRole> {
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const name = (id: number) => markOf(nodes.get(id)) ?? nodes.get(id)?.family ?? String(id);
  const beside = new Map<number, Set<number>>();
  for (const g of snapshot.groups)
    for (const id of g.rootIds) {
      const set = beside.get(id) ?? beside.set(id, new Set()).get(id)!;
      for (const other of g.rootIds) if (other !== id) set.add(other);
    }
  const out = new Map<number, UnitRole>();
  for (const [id, others] of [...beside].sort(([a], [b]) => a - b)) {
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
    const own = flowOf(flows, id);
    if (own != null) {
      out.set(id, { role: "fan", why: "proposed", reason: `states a design flow of ${own} cfm` });
      continue;
    }
    const fan = [...others]
      .map((other) => ({ other, cfm: flowOf(flows, other) }))
      .filter((x) => x.cfm != null)
      .sort((a, b) => b.cfm! - a.cfm! || a.other - b.other)[0];
    out.set(
      id,
      fan
        ? {
            role: "passive",
            why: "proposed",
            reason: `states no design flow; ${name(fan.other)} beside it states ${fan.cfm} cfm`,
          }
        : {
            role: "fan",
            why: "default",
            reason: "no unit in its groups states a design flow",
          },
    );
  }
  return out;
}

/** The units whose role is `passive`. */
export const passiveOf = (roles: ReadonlyMap<number, UnitRole>) =>
  new Set([...roles].flatMap(([id, r]) => (r.role === "passive" ? [id] : [])));
