/**
 * Every unit's role, `fan` or `passive`, with why (pressure-drop ledger, 2026-10-21, multi-fan
 * spike). A ruling wins: a role the model's store holds (`ruled`) or one Work stages (`edit`).
 * Without one the role is proposed, automatically and never edit, from Revit's own state first
 * (Pe manages Revit state):
 * 1. a unit that is the base equipment of a Revit system its own groups carry is a `fan`
 *    ("base equipment of SA 19");
 * 2. else a unit that states a design flow (`equipmentFlows`: edit, else the FanFlow slot) is a
 *    `fan` ("airflow in <slot>");
 * 3. else `passive` when PASSIVE_MIN_PORTS or more duct ports all carry one classification: a
 *    through-flow device (filter chassis, silencer; "air passes straight through (all ports Return
 *    Air)"), which then passes air through (`pass-through.ts`);
 * 4. else a `fan` ("mixed port classes: moves air"): air handlers, dehumidifiers, ERVs, and a
 *    one-port unit. Passive needs a positive signal, so a model with no airflow data still prices.
 */
import type { DuctUnitRole } from "@pe/agent-contracts";

import type { EquipmentFlow } from "./terminal-flows.ts";
import type { DuctSnapshot } from "./types.ts";

type Role = DuctUnitRole["role"];
export type UnitRoleWhy = "ruled" | "edit" | "proposed";

export interface UnitRole {
  role: Role;
  why: UnitRoleWhy;
  /** The suggestion's ground in a person's words; a ruling names who ruled. */
  reason: string;
}

/** A through-flow device has an inlet and an outlet at least. */
export const PASSIVE_MIN_PORTS = 2;

/** "ReturnAir" as a person says it: "Return Air". */
const classWord = (c: string) => c.replace(/([a-z])([A-Z])/g, "$1 $2");

/** A design flow at or below this is no flow, cfm. */
export const NO_FLOW_CFM = 0;

/**
 * The role of every unit that roots a group. `edit` is Work's roles as every reader sees them
 * (`withStoredRulings`: the store's rulings under Work's own), `store` tells a ruling from a pending one.
 */
export function unitRoles(
  snapshot: Pick<DuctSnapshot, "groups" | "nodes" | "store" | "slots"> &
    Partial<Pick<DuctSnapshot, "systems">>,
  flows: ReadonlyMap<number, EquipmentFlow>,
  edit: Readonly<Record<string, { role: Role }>>,
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
    const ruling = edit[String(id)]?.role;
    if (ruling) {
      const stored = snapshot.store?.roles?.[String(id)]?.role;
      out.set(
        id,
        stored === ruling
          ? { role: ruling, why: "ruled", reason: "ruled in the model" }
          : { role: ruling, why: "edit", reason: "edit, not yet written" },
      );
      continue;
    }
    const base = baseOf.get(id);
    if (base?.length) {
      out.set(id, {
        role: "fan",
        why: "proposed",
        reason: `base equipment of ${base.sort().join(", ")}`,
      });
      continue;
    }
    const flow = flows.get(id);
    if (flow?.cfm != null && flow.cfm > NO_FLOW_CFM) {
      const slot =
        flow.source === "override"
          ? "a edit unit flow"
          : (nodes.get(id)?.flowParameter ?? snapshot.slots?.fanFlow ?? "the FanFlow slot");
      out.set(id, { role: "fan", why: "proposed", reason: `airflow in ${slot} (${flow.cfm} cfm)` });
      continue;
    }
    const classes = [
      ...new Set((nodes.get(id)?.connectors ?? []).map((c) => c.classification ?? "unclassified")),
    ];
    const ports = nodes.get(id)?.connectors.length ?? 0;
    out.set(
      id,
      ports >= PASSIVE_MIN_PORTS && classes.length === 1
        ? {
            role: "passive",
            why: "proposed",
            reason: `air passes straight through (all ports ${classWord(classes[0]!)})`,
          }
        : {
            role: "fan",
            why: "proposed",
            reason:
              ports < PASSIVE_MIN_PORTS ? "one port: moves air" : "mixed port classes: moves air",
          },
    );
  }
  keepTheOnlyMover(snapshot.groups, out);
  return out;
}

/**
 * A through-flow unit proposed passive stays a fan when nothing else moves air in the network its
 * ports join (an inline fan has one class on both ports, like a filter): proposing it passive would
 * leave that network with no fan, and a suggestion never makes the route price less than before.
 */
function keepTheOnlyMover(groups: DuctSnapshot["groups"], out: Map<number, UnitRole>) {
  const proposedPassive = (id: number) =>
    out.get(id)?.role === "passive" && out.get(id)?.why === "proposed";
  const up = new Map<string, string>();
  const find = (g: string): string => {
    const p = up.get(g) ?? g;
    if (p === g) return g;
    const r = find(p);
    up.set(g, r);
    return r;
  };
  const groupsOf = new Map<number, string[]>();
  for (const g of groups)
    for (const id of g.rootIds) groupsOf.set(id, [...(groupsOf.get(id) ?? []), g.id]);
  for (const [id, gs] of groupsOf)
    if (proposedPassive(id)) for (const g of gs.slice(1)) up.set(find(g), find(gs[0]!));
  const moves = new Set<string>();
  for (const g of groups)
    if (g.rootIds.some((id) => out.get(id)?.role === "fan")) moves.add(find(g.id));
  for (const [id, gs] of groupsOf)
    if (proposedPassive(id) && !moves.has(find(gs[0]!)))
      out.set(id, {
        role: "fan",
        why: "proposed",
        reason: `${out.get(id)!.reason.replace("air passes straight through", "one class on every port")}, but nothing else moves air in its network`,
      });
}

/** The units whose role is `passive`. */
export const passiveOf = (roles: ReadonlyMap<number, UnitRole>) =>
  new Set([...roles].flatMap(([id, r]) => (r.role === "passive" ? [id] : [])));
