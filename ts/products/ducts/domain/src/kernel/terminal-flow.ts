/** Lifted from `terminal-flows.ts` (the per-terminal precedence); network-free: one terminal, one confirmed slot, no trees, no load preview, no per-terminal fallback to Revit's flow. */
import type { DuctSnapshot } from "../types.ts";

type Node = DuctSnapshot["nodes"][number];

/** The confirmable slot that reads Revit's connector flow (the terminal's Flow parameter). */
export const REVIT_FLOW_SLOT = "revit:Flow";

/**
 * The confirmed slot's value on a terminal: the snapshot's `flow` fact when `flowParameter` names
 * that slot (or states none, on snapshots taken before it was read); null otherwise.
 */
export function slotFlowOf(node: Node, slot: string): { slot: string; cfm: number | null } {
  // Revit's own terminal flow is a slot a project may confirm, never a silent per-terminal fallback (history 6).
  if (slot === REVIT_FLOW_SLOT) {
    const stated = node.connectors.flatMap((c) => (c.flowCfm == null ? [] : [c.flowCfm])); // none stated is absent, not zero
    return { slot, cfm: stated.length ? stated.reduce((sum, cfm) => sum + cfm, 0) : null };
  }
  const named = node.flowParameter ?? null;
  const candidate = node.facts.find(f => f.key === `slot:${slot}`);
  if (candidate) return { slot, cfm: candidate.value ?? null };
  if (named != null && named !== slot) return { slot, cfm: null };
  return { slot, cfm: node.facts.find((f) => f.key === "flow")?.value ?? null };
}

/** Terminals covered by each candidate airflow slot, so a person confirms the project's one slot by coverage. */
export function slotCoverage(
  nodes: readonly Node[],
  named: readonly (string | null | undefined)[],
): { slot: string; covered: number; total: number }[] {
  const terminals = nodes.filter((n) => n.kind === "terminal");
  // One row per slot: the active slot may itself be the built-in Flow slot.
  const slots = [
    ...new Set(
      [...named, ...terminals.map((t) => t.flowParameter), REVIT_FLOW_SLOT].filter(
        (s): s is string => !!s,
      ),
    ),
  ];
  return slots
    .map((slot) => ({
      slot,
      covered: terminals.filter((t) => (slotFlowOf(t, slot).cfm ?? 0) > 0).length,
      total: terminals.length,
    }))
    .sort((a, b) => b.covered - a.covered);
}
