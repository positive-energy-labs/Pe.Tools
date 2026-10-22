/**
 * The design flow at every air terminal (pressure-drop ledger, 2026-10-16 "terminal design flow",
 * ruling 5 of 2026-10-20): a staged override first; else the rooms seam (`roomFlows`); else the Load
 * Preview system whose tag is the equipment's Mark, split across the terminals of each tree rooted
 * at that equipment by neck area (even when an area is missing); else Revit's own terminal flow when
 * positive; else nothing, and a finding says so. A unit's flow: a staged `equipmentFlows` cell, else
 * Revit's `fanFlow` slot fact (`equipmentFlows`).
 * Pure on the snapshot, the staged cells and the group trees; nothing here is stored or written.
 */
import type { DuctFlow, DuctLoadPreview } from "@pe/agent-contracts";

import { terminalCfm, type GroupTree } from "./topology.ts";
import type { DuctSnapshot } from "./types.ts";

type Node = DuctSnapshot["nodes"][number];

export type FlowSource = "override" | `rooms:${string}` | `load-preview:${string}` | "revit";
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

/** A terminal's flow from the rooms route: its share of the served rooms' CFM, with where it came from. */
export type RoomFlows = ReadonlyMap<number, { cfm: number; source: string }>;

export function terminalFlows(
  snapshot: DuctSnapshot,
  loads: DuctLoadPreview | null | undefined,
  flowsStaged: Record<string, DuctFlow>,
  trees: GroupTree[],
  // rooms seam: rooms route supplies served-room CFM split (PE_M___ServesRoom), not built
  roomFlows?: RoomFlows,
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
    const room = roomFlows?.get(node.id);
    const flow: TerminalFlow = override
      ? { cfm: override.cfm, source: "override" }
      : room
        ? { cfm: room.cfm, source: `rooms:${room.source}` }
        : (preview.get(node.id) ??
          (revit != null && revit > 0
            ? { cfm: revit, source: "revit" }
            : { cfm: null, source: null, finding: "no-flow" }));
    if (flow.finding) findings.push({ kind: "no-flow", terminal: node.id });
    flows.set(node.id, flow);
  }
  return { flows, findings };
}

/** `derived`: no stated flow, so the sum of the terminal flows its section serves (`derivedUnitFlows`); never written. */
export type EquipmentFlowSource = "override" | "revit" | "derived";
export interface EquipmentFlow {
  cfm: number | null;
  source: EquipmentFlowSource | null;
  /** A derived flow's terminal count. */
  grilles?: number;
}

/** A unit's design flow: a staged `equipmentFlows` cell, else Revit's `fanFlow` slot fact when positive. */
export function equipmentFlows(
  snapshot: DuctSnapshot,
  staged: Record<string, DuctFlow>,
): Map<number, EquipmentFlow> {
  return new Map(
    snapshot.nodes
      .filter((n) => n.kind === "equipment")
      .map((node) => {
        const override = staged[String(node.id)];
        const revit = node.facts.find((f) => f.key === "fanFlow")?.value ?? null;
        const flow: EquipmentFlow = override
          ? { cfm: override.cfm, source: "override" }
          : revit != null && revit > 0
            ? { cfm: revit, source: "revit" }
            : { cfm: null, source: null };
        return [node.id, flow];
      }),
  );
}
