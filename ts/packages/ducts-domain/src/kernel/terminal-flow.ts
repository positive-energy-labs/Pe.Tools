/** Lifted from `terminal-flows.ts` (the per-terminal precedence); network-free: one terminal, one confirmed slot, no trees, no load preview, no per-terminal fallback to Revit's flow. */
import type { DuctSnapshot } from "../types.ts";

type Node = DuctSnapshot["nodes"][number];

/** The confirmable slot that reads Revit's connector flow (the terminal's Flow parameter). */
export const REVIT_FLOW_SLOT = "revit:Flow";

export type TerminalFlowSource = "override" | `slot:${string}` | `rooms:${string}`;

export interface TerminalFlowInput {
  /** A typed override, cfm. */
  override?: number | null;
  /** The project's one confirmed airflow slot and the value it holds on this terminal. */
  confirmed: { slot: string; cfm: number | null };
  /** The rooms seam: the terminal's share of its served rooms' cfm, with where it came from. */
  room?: { cfm: number; source: string } | null;
}

export type TerminalFlow =
  | { flow: number; source: TerminalFlowSource; blocker: null }
  | { flow: null; source: null; blocker: "no-flow" };

/**
 * A terminal's design flow (map: typed override, then the confirmed slot, then room). A missing
 * value is a `no-flow` blocker; Revit's own flow is never a per-terminal fallback (history 6).
 */
export function terminalFlow({ override, confirmed, room }: TerminalFlowInput): TerminalFlow {
  if (override != null) return { flow: override, source: "override", blocker: null };
  if (confirmed.cfm != null && confirmed.cfm > 0)
    return { flow: confirmed.cfm, source: `slot:${confirmed.slot}`, blocker: null };
  if (room) return { flow: room.cfm, source: `rooms:${room.source}`, blocker: null };
  return { flow: null, source: null, blocker: "no-flow" };
}

/**
 * The confirmed slot's value on a terminal: the snapshot's `flow` fact when `flowParameter` names
 * that slot (or states none, on snapshots taken before it was read); null otherwise.
 */
export function slotFlowOf(node: Node, slot: string): { slot: string; cfm: number | null } {
  // Revit's own terminal flow is a slot a project may confirm, never a silent per-terminal fallback (history 6).
  if (slot === REVIT_FLOW_SLOT) {
    const cfm = node.connectors.reduce((sum, c) => sum + (c.flowCfm ?? 0), 0);
    return { slot, cfm: cfm > 0 ? cfm : null };
  }
  const named = node.flowParameter ?? null;
  if (named != null && named !== slot) return { slot, cfm: null };
  return { slot, cfm: node.facts.find((f) => f.key === "flow")?.value ?? null };
}

/** Terminals covered by each candidate airflow slot, so a person confirms the project's one slot by coverage. */
export function slotCoverage(nodes: readonly Node[], named: readonly (string | null | undefined)[]): { slot: string; covered: number; total: number }[] {
  const terminals = nodes.filter((n) => n.kind === "terminal");
  const slots = [...new Set([...named, ...terminals.map((t) => t.flowParameter)].filter((s): s is string => !!s)), REVIT_FLOW_SLOT];
  return slots
    .map((slot) => ({ slot, covered: terminals.filter((t) => slotFlowOf(t, slot).cfm != null).length, total: terminals.length }))
    .sort((a, b) => b.covered - a.covered);
}
