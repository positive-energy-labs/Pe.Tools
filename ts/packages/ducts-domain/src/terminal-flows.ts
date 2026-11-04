/**
 * The design flow at every air terminal (pressure-drop ledger, 2026-10-16 "terminal design flow",
 * ruling 5 of 2026-10-20; Load Preview deleted at FANSPLIT, kaitpw 2026-11-03): an edit override
 * first; else the rooms seam (`roomFlows`); else Revit's own terminal flow when positive; else
 * nothing, and a finding says so. A unit's flow: an edit `equipmentFlows` cell, else Revit's
 * `fanFlow` slot fact (`equipmentFlows`).
 * Pure on the snapshot, the edit cells and the rooms split; nothing here is stored or written.
 */
import type { DuctFlow } from "@pe/agent-contracts";

import { terminalCfm } from "./topology.ts";
import type { DuctSnapshot } from "./types.ts";

type Node = DuctSnapshot["nodes"][number];

export type FlowSource = "override" | `rooms:${string}` | "revit";
export interface TerminalFlow {
  cfm: number | null;
  source: FlowSource | null;
  finding?: "no-flow";
}
export interface FlowFinding {
  kind: "no-flow";
  terminal: number;
}

export const markOf = (node: Node | null | undefined) =>
  node?.facts.find((f) => f.key === "mark")?.text ?? null;

/** A terminal's flow from the rooms route: its share of the served rooms' CFM, with where it came from. */
export type RoomFlows = ReadonlyMap<number, { cfm: number; source: string }>;

export function terminalFlows(
  snapshot: DuctSnapshot,
  flowsStaged: Record<string, DuctFlow>,
  // rooms seam: rooms route supplies served-room CFM split (PE_M___ServesRoom), not built
  roomFlows?: RoomFlows,
): { flows: Map<number, TerminalFlow>; findings: FlowFinding[] } {
  const findings: FlowFinding[] = [];
  const flows = new Map<number, TerminalFlow>();
  for (const node of snapshot.nodes.filter((n) => n.kind === "terminal")) {
    const override = flowsStaged[String(node.id)];
    const revit = terminalCfm(node);
    const room = roomFlows?.get(node.id);
    const flow: TerminalFlow = override
      ? { cfm: override.cfm, source: "override" }
      : room
        ? { cfm: room.cfm, source: `rooms:${room.source}` }
        : revit != null && revit > 0
          ? { cfm: revit, source: "revit" }
          : { cfm: null, source: null, finding: "no-flow" };
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

/** A unit's design flow: a edit `equipmentFlows` cell, else Revit's `fanFlow` slot fact when positive. */
export function equipmentFlows(
  snapshot: DuctSnapshot,
  edit: Record<string, DuctFlow>,
): Map<number, EquipmentFlow> {
  return new Map(
    snapshot.nodes
      .filter((n) => n.kind === "equipment")
      .map((node) => {
        const override = edit[String(node.id)];
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
