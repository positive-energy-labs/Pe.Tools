/**
 * The airflow read slot as a walk step (pressure-drop ledger, 2026-10-20): projects carry a
 * terminal's design airflow in whatever parameter the drafter used, so which one is read is a
 * person's choice in the walk, never a hidden setting. `ducts.snapshot` lists every air flow
 * parameter the terminals carry (`airflowCandidates`) with its coverage; the choice stages the
 * person-owned `parameters.terminalFlow` slot, the snapshot re-reads under it, and a write keeps
 * it in the model's store.
 */
import {
  transitionPatches,
  type DuctsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";
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

/** The current slot and every candidate with its coverage in the group (the document when none). */
export function airflowOptions(
  snapshot: Pick<DuctSnapshot, "slots" | "airflowCandidates" | "nodes">,
  group: string,
): { current: string; options: AirflowOption[] } {
  // A snapshot read before the slot was reported (or a test's partial one) reads the default.
  const current = snapshot.slots?.terminalFlow ?? "PE_M_Grd_AirFlow";
  const inGroup = snapshot.nodes.filter(
    (n) => n.kind === "terminal" && (!group || n.groupId === group),
  ).length;
  const options = (snapshot.airflowCandidates ?? []).map((c) => {
    const have = group ? (c.groups.find((g) => g.groupId === group)?.have ?? 0) : c.have;
    const where = ` · ${c.where}${c.shared ? ", shared" : ""}`;
    return { slot: c.slot, label: `${slotWord(c.slot)}${where}`, have, of: group ? inGroup : c.of };
  });
  // A slot can name a parameter no terminal carries (the firm default on a foreign model).
  if (!options.some((o) => o.slot === current))
    options.push({
      slot: current,
      label: `${slotWord(current)} · on no terminal`,
      have: 0,
      of: inGroup,
    });
  // The same parameter as instance and type reads as one slot; keep the better-covered entry.
  const best = new Map<string, AirflowOption>();
  for (const o of options) if ((best.get(o.slot)?.have ?? -1) < o.have) best.set(o.slot, o);
  return {
    current,
    options: [...best.values()].sort((a, b) => b.have - a.have || a.label.localeCompare(b.label)),
  };
}

/** The patches choosing a slot makes: stage it on the person-owned `parameters.terminalFlow` cell. */
export const airflowPatches = (doc: DuctsRouteDocument | null, slot: string): RouteStatePatch[] =>
  transitionPatches(["parameters"], "terminalFlow", doc?.parameters?.terminalFlow ?? {}, {
    kind: "stage",
    rung: { value: slot },
  });
