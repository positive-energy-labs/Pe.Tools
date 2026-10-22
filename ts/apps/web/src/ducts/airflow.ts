/**
 * The airflow read slot as a walk step (pressure-drop ledger, 2026-10-20): projects carry a
 * terminal's design airflow in whatever parameter the drafter used, so which one is read is a
 * person's choice in the walk, never a hidden setting. `ducts.snapshot` lists every air flow
 * parameter the terminals carry (`airflowCandidates`) with its coverage; the choice stages the
 * person-owned `parameters.terminalFlow` slot, the snapshot re-reads under it, and a write keeps
 * it in the model's store. A unit's design flow is the same step over equipment (2026-10-21):
 * `fanFlowCandidates`, the `parameters.fanFlow` slot, coverage counted over the system's units.
 */
import {
  transitionPatches,
  type DuctsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import type { SystemScope } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

/** A slot in a person's words. */
export const slotWord = (slot: string | null | undefined) => slot ?? "no parameter";

export interface AirflowOption {
  slot: string;
  /** The slot, where it sits and whether it is shared, in a person's words. */
  label: string;
  /** Terminals in scope with a nonzero value, of every terminal in scope. */
  have: number;
  of: number;
}

/** Which elements a slot reads: terminals (`terminalFlow`) or units (`fanFlow`). */
export type AirflowOf = "terminal" | "unit";

// firm-default: the snapshot reports the slots it read; these are only for a snapshot that predates them.
const DEFAULT_SLOT: Record<AirflowOf, string> = {
  terminal: "PE_M_Grd_AirFlow",
  unit: "PE_M_Fan_AirFlowDesign",
};
const NOUN: Record<AirflowOf, string> = { terminal: "terminal", unit: "unit" };

/**
 * The current slot and every candidate with its coverage over the chosen system (the document when
 * none): its terminals, or the units on its runs, across every group it is in (`system-scope.ts`).
 * The snapshot counts coverage per group; a group the system shares counts the other systems'
 * terminals too, so `have` is capped at the system's own count. The slot read now is counted
 * exactly: the members whose stated flow (`flow`, or a unit's `fanFlow`) it supplied.
 */
export function airflowOptions(
  snapshot: Pick<DuctSnapshot, "slots" | "airflowCandidates" | "fanFlowCandidates" | "nodes">,
  scope: Pick<SystemScope, "groups" | "terminals" | "units"> | null,
  of: AirflowOf = "terminal",
): { current: string; options: AirflowOption[] } {
  // A snapshot read before the slot was reported (or a test's partial one) reads the default.
  const current =
    (of === "unit" ? snapshot.slots?.fanFlow : snapshot.slots?.terminalFlow) ?? DEFAULT_SLOT[of];
  const kind = of === "unit" ? "equipment" : "terminal";
  const members =
    (scope ? (of === "unit" ? scope.units : scope.terminals) : null) ??
    new Set(snapshot.nodes.filter((n) => n.kind === kind).map((n) => n.id));
  const inScope = members.size;
  const groups = new Set(scope?.groups ?? []);
  const key = of === "unit" ? "fanFlow" : "flow";
  const read = snapshot.nodes.filter(
    (n) =>
      members.has(n.id) &&
      (n.flowParameter ?? current) === current &&
      (n.facts.find((f) => f.key === key)?.value ?? 0) > 0,
  ).length;
  const candidates =
    (of === "unit" ? snapshot.fanFlowCandidates : snapshot.airflowCandidates) ?? [];
  const options = candidates.map((c) => {
    const have = !scope
      ? c.have
      : c.slot === current
        ? read
        : Math.min(
            inScope,
            c.groups.filter((g) => groups.has(g.groupId)).reduce((a, g) => a + g.have, 0),
          );
    const where = ` · ${c.where}${c.shared ? ", shared" : ""}`;
    return { slot: c.slot, label: `${slotWord(c.slot)}${where}`, have, of: scope ? inScope : c.of };
  });
  // A slot can name a parameter no terminal carries (the firm default on a foreign model).
  if (!options.some((o) => o.slot === current))
    options.push({
      slot: current,
      label: `${slotWord(current)} · ${read ? "read now" : `on no ${NOUN[of]}`}`,
      have: read,
      of: inScope,
    });
  // The same parameter as instance and type reads as one slot; keep the better-covered entry.
  const best = new Map<string, AirflowOption>();
  for (const o of options) if ((best.get(o.slot)?.have ?? -1) < o.have) best.set(o.slot, o);
  return {
    current,
    options: [...best.values()].sort((a, b) => b.have - a.have || a.label.localeCompare(b.label)),
  };
}

/** The patches choosing a slot makes: stage it on the person-owned `parameters.terminalFlow` (or `fanFlow`) cell. */
export const airflowPatches = (
  doc: DuctsRouteDocument | null,
  slot: string,
  of: AirflowOf = "terminal",
): RouteStatePatch[] => {
  const key = of === "unit" ? "fanFlow" : "terminalFlow";
  return transitionPatches(["parameters"], key, doc?.parameters?.[key] ?? {}, {
    kind: "stage",
    rung: { value: slot },
  });
};
