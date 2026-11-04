/**
 * The fan sheet's own snapshot: an `ids` read of what the open fan touches (its walk, the unit,
 * blocker and candidate elements), never the shell's whole-document read, which outgrew the
 * bridge's 16 MiB frame on cloud Chadds (2026-10-29). An `ids` read is raw (no groups, flows or
 * issues), so every element joins one `sheet` group: the picture and namer draw by group.
 */
import type { DuctSnapshot } from "@pe/ducts-domain/types";

export const SHEET_GROUP = "sheet";

/** Empty geometry for legacy unbound network views, never a native sheet reading. */
export const EMPTY_SNAPSHOT: DuctSnapshot = {
  document: { title: "", readAt: "", elapsedMs: 0, networkBasedCalculations: false },
  coordinateEncoding: "native-double",
  levels: [],
  groups: [],
  nodes: [],
  segments: [],
  flows: [],
  issues: [],
  layers: [],
  systems: [],
  slots: {
    fanStatic: "",
    fanFlow: "",
    componentDrop: "",
    terminalDrop: "",
    fittingCoefficient: "",
    terminalFlow: "",
  },
};

export function sheetSnapshot(raw: DuctSnapshot): DuctSnapshot {
  return {
    ...raw,
    groups: [
      {
        id: SHEET_GROUP,
        rootIds: [],
        classifications: [],
        systemNames: [],
        terminalCount: raw.nodes.filter((n) => n.kind === "terminal").length,
        elementCount: raw.nodes.length + raw.segments.length,
        loops: 0,
        issueIds: [],
      },
    ],
    nodes: raw.nodes.map((node) => ({ ...node, groupId: SHEET_GROUP })),
    segments: raw.segments.map((segment) => ({ ...segment, groupId: SHEET_GROUP })),
  };
}
