/**
 * Test support: the one constructor family for the duct wire types. Each builder fills only the
 * fields the generated type requires, so a test states what its case is about and the compiler
 * catches a snapshot the host could never send. No cast lives here; the cast ratchet
 * (`tests/repo-guards/src/test-casts.guard.test.ts`) keeps new ones out of the tests.
 */
import type { DuctSnapshot } from "./types.ts";

export type Node = DuctSnapshot["nodes"][number];
export type Segment = DuctSnapshot["segments"][number];
export type Connector = Node["connectors"][number];
export type Fact = Node["facts"][number];
export type Group = DuctSnapshot["groups"][number];
export type System = DuctSnapshot["systems"][number];
export type Issue = DuctSnapshot["issues"][number];
type Size = Pick<Connector, "shape" | "size" | "diameterIn" | "widthIn" | "heightIn">;

/** A Revit-shaped UniqueId whose last block is the element id in hex, as the host mints them. */
export const uniqueIdOf = (id: number) =>
  `6d52156a-3876-4d76-b641-341454252f26-${id.toString(16).padStart(8, "0")}`;

export const round = (diameterIn: number): Size => ({
  shape: "round",
  size: `${diameterIn}"ø`,
  diameterIn,
});
export const rect = (widthIn: number, heightIn: number): Size => ({
  shape: "rectangular",
  size: `${widthIn}x${heightIn}`,
  widthIn,
  heightIn,
});

/** `to` is the far element id, or `[elementId, connector]`; a bare id joins that element's connector 1. */
export const connOf = (
  index: number,
  to: number | readonly [number, number] | null = null,
  over: Partial<Connector> = {},
): Connector => ({
  index,
  kind: "end",
  point: [0, 0, 0],
  shape: "round",
  size: "",
  direction: "bidirectional",
  connectedTo:
    to == null
      ? null
      : typeof to === "number"
        ? { elementId: to, connector: 1 }
        : { elementId: to[0], connector: to[1] },
  ...over,
});

export const factOf = (
  key: string,
  value: number | string | null,
  over: Partial<Fact> = {},
): Fact => ({
  key,
  ...(typeof value === "string" ? { text: value } : { value }),
  unit: "",
  provenance: "revit-reported",
  ...over,
});

export const nodeOf = (id: number, kind: Node["kind"], over: Partial<Node> = {}): Node => ({
  id,
  uniqueId: uniqueIdOf(id),
  kind,
  category: kind,
  connectors: [],
  facts: [],
  ...over,
});

export const ductOf = (id: number, over: Partial<Segment> = {}): Segment => ({
  id,
  uniqueId: uniqueIdOf(id),
  kind: "duct",
  curveKind: "line",
  shape: "round",
  size: "",
  lengthFt: 0,
  polyline: [],
  roughness: { valueFt: 0.0003, provenance: "revit-default" },
  revit: {},
  connectors: [],
  ...over,
});

export const groupOf = (id: string, over: Partial<Group> = {}): Group => ({
  id,
  rootIds: [],
  classifications: [],
  systemNames: [],
  terminalCount: 0,
  elementCount: 0,
  loops: 0,
  issueIds: [],
  ...over,
});

export const systemOf = (id: number, over: Partial<System> = {}): System => ({
  id,
  name: "",
  classification: "",
  criticalPath: [],
  sections: [],
  ...over,
});

export const issueOf = (
  id: string,
  kind: Issue["kind"],
  elementId: number,
  over: Partial<Issue> = {},
): Issue => ({ id, kind, elementId, note: "", ...over });

export const slots: DuctSnapshot["slots"] = {
  fanStatic: "PE_M_Fan_ExternalStaticPressure",
  fanFlow: "PE_M_Fan_AirFlow",
  componentDrop: "Pressure Drop",
  terminalDrop: "PE_M_Grd_ExternalStaticPressure",
  fittingCoefficient: "Pe_C",
  terminalFlow: "PE_M_Grd_AirFlow",
};

export const snapshotOf = (over: Partial<DuctSnapshot> = {}): DuctSnapshot => ({
  document: { title: "t", readAt: "", elapsedMs: 0, networkBasedCalculations: true },
  coordinateEncoding: "native-double",
  levels: [],
  groups: [],
  nodes: [],
  segments: [],
  flows: [],
  issues: [],
  layers: [],
  systems: [],
  slots,
  ...over,
});
