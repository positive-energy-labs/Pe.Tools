/**
 * The design flow at every air terminal (pressure-drop ledger, 2026-10-16 "terminal design flow"):
 * a staged override first; else the Load Preview system whose tag is the equipment's Mark, split
 * across the terminals of each tree rooted at that equipment by neck area (even when an area is
 * missing); else Revit's own terminal flow when positive; else nothing, and a finding says so.
 * Pure on the snapshot, the staged cells and the group trees; nothing here is stored or written.
 */
import type { DuctFlow, DuctLoadPreview } from "@pe/agent-contracts";

import { terminalCfm, type GroupTree } from "./topology.ts";
import type { DuctSnapshot } from "./types.ts";

type Node = DuctSnapshot["nodes"][number];

export type FlowSource = "override" | `load-preview:${string}` | "revit";
export interface TerminalFlow {
  cfm: number | null;
  source: FlowSource | null;
  finding?: "no-flow";
}
export type FlowFinding =
  | { kind: "tag-without-mark"; tag: string; system: string }
  | { kind: "mark-without-system"; mark: string; equipment: number }
  | { kind: "no-terminals"; mark: string; equipment: number }
  | { kind: "no-mark"; equipment: number; label: string }
  | { kind: "no-flow"; terminal: number };

export const markOf = (node: Node | null | undefined) =>
  node?.facts.find((f) => f.key === "mark")?.text ?? null;

/** The terminals the tree's root reaches, in walk order. */
const downstream = (tree: GroupTree) => {
  if (!tree.root) return [];
  const reached: number[] = [];
  const stack = [tree.root.element];
  while (stack.length) {
    const id = stack.pop()!;
    if (tree.parts.get(id)?.node?.kind === "terminal") reached.push(id);
    stack.push(...(tree.children.get(id) ?? []));
  }
  return reached.sort((a, b) => a - b);
};

const neckArea = (node: Node) => node.connectors.find((c) => c.areaFt2 != null)?.areaFt2 ?? null;

export function terminalFlows(
  snapshot: DuctSnapshot,
  loads: DuctLoadPreview | null | undefined,
  flowsStaged: Record<string, DuctFlow>,
  trees: GroupTree[],
): { flows: Map<number, TerminalFlow>; findings: FlowFinding[] } {
  const findings: FlowFinding[] = [];
  const nodeById = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const equipment = snapshot.nodes.filter((n) => n.kind === "equipment");
  const byMark = new Map(equipment.flatMap((n) => (markOf(n) ? [[markOf(n)!, n]] : [])));
  const tagged = new Map(
    (loads?.systems ?? []).flatMap((s) => (s.tag ? [[s.tag, s] as const] : [])),
  );

  const preview = new Map<number, TerminalFlow>();
  for (const [tag, system] of tagged) {
    const eq = byMark.get(tag);
    if (!eq) {
      findings.push({ kind: "tag-without-mark", tag, system: system.name });
      continue;
    }
    const fed = trees.filter((t) => t.root?.equipment === eq.id).map(downstream);
    if (!fed.some((ids) => ids.length)) {
      findings.push({ kind: "no-terminals", mark: tag, equipment: eq.id });
      continue;
    }
    if (system.cfm == null) continue;
    for (const ids of fed) {
      const areas = ids.map((id) => neckArea(nodeById.get(id)!));
      const even = areas.some((a) => a == null || a <= 0);
      const total = even ? ids.length : areas.reduce((sum, a) => sum! + a!, 0)!;
      ids.forEach((id, i) =>
        preview.set(id, {
          cfm: (system.cfm! * (even ? 1 : areas[i]!)) / total,
          source: `load-preview:${tag}`,
        }),
      );
    }
  }
  for (const eq of equipment) {
    const mark = markOf(eq);
    if (mark && !tagged.has(mark))
      findings.push({ kind: "mark-without-system", mark, equipment: eq.id });
    // Only once loads exist: without a Mark no preview system can ever reach this unit's terminals.
    if (!mark && loads && trees.some((t) => t.root?.equipment === eq.id && downstream(t).length))
      findings.push({
        kind: "no-mark",
        equipment: eq.id,
        label: [eq.family, eq.type].filter(Boolean).join(" / ") || String(eq.id),
      });
  }

  const flows = new Map<number, TerminalFlow>();
  for (const node of snapshot.nodes.filter((n) => n.kind === "terminal")) {
    const override = flowsStaged[String(node.id)];
    const revit = terminalCfm(node);
    const flow: TerminalFlow = override
      ? { cfm: override.cfm, source: "override" }
      : (preview.get(node.id) ??
        (revit != null && revit > 0
          ? { cfm: revit, source: "revit" }
          : { cfm: null, source: null, finding: "no-flow" }));
    if (flow.finding) findings.push({ kind: "no-flow", terminal: node.id });
    flows.set(node.id, flow);
  }
  return { flows, findings };
}
