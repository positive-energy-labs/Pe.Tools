// @vitest-environment jsdom
/**
 * The schematic in both slots, deterministic: one component, the same encoding, selection and
 * hover-lit set whether it is the main picture or the corner. The network is the topology test's
 * hand-built slice (root, a tee, two registers, an open end).
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";

import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { encodingOf } from "./encoding";
import { indexOf } from "./scene";
import { Schematic } from "./schematic";

afterEach(cleanup);

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];

/** Each link joins `[a, connector]` to `[b, connector]`; a connector with no link is open. */
const LINKS: [number, number, number, number][] = [
  [100, 0, 1, 0], // AHU port 0 -> duct 1
  [1, 1, 2, 0], // duct 1 -> tee 2
  [2, 1, 3, 0], // tee -> duct 3 (the long branch)
  [3, 1, 4, 0], // duct 3 -> register 4
  [2, 2, 5, 0], // tee -> duct 5
  [5, 1, 6, 0], // duct 5 -> elbow 6
  [6, 1, 7, 0], // elbow -> duct 7
  [7, 1, 8, 0], // duct 7 -> register 8
];
const PORTS: Record<number, number> = {
  100: 1,
  1: 2,
  2: 3,
  3: 2,
  4: 1,
  5: 2,
  6: 2,
  7: 2,
  8: 1,
  9: 2,
};
// Duct 9 hangs off the tee's fourth port with its far end open.
LINKS.push([2, 3, 9, 0]);
PORTS[2] = 4;

const connectors = (id: number) =>
  Array.from({ length: PORTS[id]! }, (_, index) => {
    const link = LINKS.find(
      ([a, ca, b, cb]) => (a === id && ca === index) || (b === id && cb === index),
    );
    const to = !link
      ? null
      : link[0] === id
        ? { elementId: link[2], connector: link[3] }
        : { elementId: link[0], connector: link[1] };
    return {
      index,
      kind: "end" as const,
      point: [id, 0, 0],
      direction: "out" as const,
      connectedTo: to,
    };
  });
const node = (id: number, kind: Node["kind"], extra: Partial<Node> = {}): Node =>
  ({
    id,
    kind,
    category: "",
    family: kind === "equipment" ? "AHU-1" : kind,
    point: [id, id % 3, 0],
    groupId: kind === "equipment" ? null : "g1",
    connectors: connectors(id),
    facts: [],
    ...extra,
  }) as Node;
const duct = (id: number, lengthFt: number, size: string): Segment =>
  ({
    id,
    kind: "duct",
    curveKind: "line",
    type: "Rect",
    shape: "rectangular",
    size,
    lengthFt,
    polyline: [
      [id, 0, 0],
      [id + 1, 0, 0],
    ],
    groupId: "g1",
    roughness: { valueFt: 0.0003, provenance: "revit-reported" },
    revit: {},
    connectors: connectors(id),
  }) as Segment;
const flow = (cfm: number) =>
  [{ key: "flow", value: cfm, unit: "cfm", provenance: "designer-stated" }] as Node["facts"];

const OPEN = "open-end:g1:9:1";
const snapshot = {
  coordinateEncoding: "native-double",
  document: {
    title: "t",
    readAt: "2026-09-26T00:00:00Z",
    elapsedMs: 1,
    networkBasedCalculations: false,
  },
  levels: [],
  groups: [
    {
      id: "g1",
      rootIds: [100],
      classifications: ["Supply Air"],
      systemNames: ["SA 1"],
      terminalCount: 2,
      elementCount: 9,
      loops: 0,
      issueIds: [OPEN],
    },
  ],
  nodes: [
    node(100, "equipment"),
    node(2, "fitting", { partType: "Tee" }),
    node(4, "terminal", { facts: flow(150) }),
    node(6, "fitting", { partType: "Elbow" }),
    node(8, "terminal", { facts: flow(100) }),
  ],
  segments: [
    duct(1, 10, "14x10"),
    duct(3, 20, "10x8"),
    duct(5, 5, "8x6"),
    duct(7, 8, "8x6"),
    duct(9, 2, "6x6"),
  ],
  flows: [
    { segmentId: 1, cfm: 250, provenance: "derived" },
    { segmentId: 3, cfm: 150, provenance: "derived" },
    { segmentId: 5, cfm: 100, provenance: "derived" },
    { segmentId: 7, cfm: 100, provenance: "derived" },
    { segmentId: 9, cfm: 0, provenance: "derived" },
  ],
  issues: [
    {
      id: OPEN,
      kind: "open-end",
      elementId: 9,
      point: [9, 0, 0],
      groupId: "g1",
      note: "nothing attached",
    },
  ],
  layers: [],
  systems: [],
  slots: {
    fanStatic: "PE_M_Fan_ExternalStaticPressure",
    fanFlow: "PE_M_Fan_AirFlow",
    componentDrop: "Pressure Drop",
    fittingCoefficient: "Pe_C",
    terminalFlow: "PE_M_Grd_AirFlow",
  },
} as DuctSnapshot;

const props = (patch: Partial<Parameters<typeof Schematic>[0]> = {}) => ({
  index: indexOf(snapshot),
  group: "g1",
  encoding: encodingOf("health"),
  selected: new Set<number>(),
  lit: new Set<number>(),
  onSelect: () => undefined,
  onHover: () => undefined,
  ...patch,
});

it("draws the same tree in the main slot and the corner, labelled only in the main", () => {
  const main = render(<Schematic {...props()} size="main" />);
  expect(main.container.querySelectorAll("[data-vertex]").length).toBe(4);
  expect(main.container.textContent).toContain("150 cfm design");
  cleanup();
  const corner = render(<Schematic {...props()} size="inset" />);
  expect(corner.container.querySelectorAll("[data-vertex]").length).toBe(4);
  expect(corner.container.textContent).not.toContain("cfm design");
  expect(corner.container.querySelector("[data-schematic-slot=inset]")).not.toBeNull();
});

it("selection, hover and hover-lighting read the same in either slot", () => {
  for (const size of ["main", "inset"] as const) {
    const onSelect = vi.fn();
    const onHover = vi.fn();
    const view = render(
      <Schematic
        {...props({ onSelect, onHover, selected: new Set([3]), lit: new Set([8]) })}
        size={size}
      />,
    );
    const edge = (id: number) => view.container.querySelector(`[data-element="${id}"]`)!;
    // The edge holding a selected element is marked; the one holding a lit element is flagged.
    expect(edge(3).hasAttribute("data-selected")).toBe(true);
    expect(edge(5).hasAttribute("data-selected")).toBe(false);
    expect(edge(5).hasAttribute("data-lit")).toBe(true); // the chain 5..8 holds lit 8
    expect(edge(3).hasAttribute("data-lit")).toBe(false);
    fireEvent.click(edge(5));
    expect(onSelect).toHaveBeenCalledWith(5);
    fireEvent.pointerEnter(edge(5));
    expect(onHover).toHaveBeenCalledWith(5);
    cleanup();
  }
});

it("asks for a group when none is chosen", () => {
  const view = render(<Schematic {...props({ group: "" })} />);
  expect(view.container.textContent).toContain("choose a system");
});
