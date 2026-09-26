// @vitest-environment jsdom
/**
 * /ducts topology, deterministic: the tree builder on a hand-built network (root, leaves,
 * collapse, longest run), staging an open-end answer lifts readiness, and both topology views
 * render over the same small slice.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vite-plus/test";
import { applyPatches, ductsRouteState, type DuctsRouteDocument } from "@pe/agent-contracts";

import { DuctsLedger, verdictPatches } from "./ledger";
import type { DuctsPage } from "./manifest";
import { readiness, type DuctSnapshot } from "./readiness";
import { chainsOf, groupTree, runsOf } from "./topology";
import { DuctsTree, layoutTree } from "./tree";

afterEach(cleanup);
// jsdom lays nothing out; the table scrolls its active row into view on mount.
if (!("scrollIntoView" in Element.prototype))
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => {} });

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
  document: { title: "t", readAt: "2026-09-26T00:00:00Z", elapsedMs: 1 },
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
} as DuctSnapshot;

const page = (patch: Partial<DuctsPage> = {}): DuctsPage => ({
  stage: "survey",
  view: "",
  group: "g1",
  level: "",
  layers: [],
  selected: "",
  issue: "",
  encoding: "health",
  epoch: 0,
  ...patch,
});

it("roots the tree at the one port, folds straight runs, and finds the longest developed run", () => {
  const tree = groupTree(snapshot, "g1");
  expect(tree.root).toEqual({ equipment: 100, port: 0, element: 1 });
  expect(tree.rooted).toBe("port");
  expect([...tree.terminals].sort((a, b) => a - b)).toEqual([4, 8]);
  // Duct 3 (20 ft) beats duct 5 + duct 7 (13 ft) from the tee: 30 ft against 23 ft.
  expect(tree.longest).toEqual([1, 2, 3, 4]);
  expect(tree.dist.get(4)).toBe(30);

  const chains = chainsOf(tree);
  expect(chains.map((c) => [c.from, c.members])).toEqual([
    [null, [1, 2]],
    [2, [3, 4]],
    [2, [5, 6, 7, 8]],
    [2, [9]],
  ]);
  expect(chains[2]).toMatchObject({ lengthFt: 13, cfm: 100, sizes: ["8x6"], fittings: 1 });
  // Unfolding a chain makes its members vertices; the layout stays deterministic.
  expect(chainsOf(tree, new Set([5, 6, 7, 8])).map((c) => c.members)).toContainEqual([6]);
  const layout = layoutTree(tree, chains);
  expect(layout.at.get(4)![1]).toBe(layout.at.get(2)![1]); // the longest run continues the row
  expect(layout.at.get(8)![1]).toBeGreaterThan(layout.at.get(4)![1]);

  const runs = runsOf(tree);
  expect(runs.map((r) => [r.terminal, r.developedFt, r.longest, r.fittings])).toEqual([
    [4, 30, true, { Tee: 1 }],
    [8, 23, false, { Tee: 1, Elbow: 1 }],
  ]);
});

it("a group with many ports names its stand-in root and marks the others", () => {
  const twin = {
    ...snapshot,
    groups: [{ ...snapshot.groups[0]!, rootIds: [100, 200] }],
    nodes: [
      ...snapshot.nodes,
      {
        ...node(200, "equipment"),
        connectors: [{ ...connectors(8)[0]!, connectedTo: { elementId: 8, connector: 0 } }],
      },
    ],
  } as DuctSnapshot;
  const tree = groupTree(twin, "g1");
  expect(tree.rooted).toBe("stand-in");
  expect(tree.rootWord).toContain("2 equipment ports");
  expect(tree.extraRoots.map((r) => r.equipment)).toEqual([200]);
});

it("staging an open-end answer lifts the group from blocked to walkable, and unset drops it back", () => {
  const land = (doc: DuctsRouteDocument, choice: Parameters<typeof verdictPatches>[2]) => {
    const landed = applyPatches(
      ductsRouteState,
      { version: 1, revision: 0, doc },
      "human",
      verdictPatches(doc, OPEN, choice),
      0,
    );
    if (!landed.ok) throw Error(JSON.stringify(landed));
    return landed.envelope.doc;
  };
  const empty = ductsRouteState.schema.parse({});
  expect(readiness(snapshot, empty).g1?.level).toBe("blocked");
  expect(readiness(snapshot, land(empty, "connect")).g1?.level).toBe("blocked");
  const capped = land(empty, "capped");
  expect(readiness(snapshot, capped).g1?.level).toBe("budgetable");
  expect(readiness(snapshot, land(capped, "unset")).g1?.level).toBe("blocked");
});

it("the tree view draws the root, both terminals with design cfm, the open end and the longest run", () => {
  const view = render(
    <DuctsTree snapshot={snapshot} page={page()} setPage={() => {}} empty={null} />,
  );
  const text = view.container.textContent ?? "";
  expect(text).toContain("AHU-1");
  expect(text).toContain("150 cfm design");
  expect(text).toContain("100 cfm design");
  expect(text).toContain("250 cfm");
  expect(text).toContain("open end");
  expect(text).toContain("longest developed length, 30.0 ft");
  expect(view.container.querySelectorAll("[data-vertex]").length).toBe(4);
});

it("the ledger lists the runs longest first, and its issue row offers the open-end answers", () => {
  const doc = ductsRouteState.schema.parse({});
  const view = render(
    <DuctsLedger
      snapshot={snapshot}
      ready={readiness(snapshot, doc)}
      page={page({ view: "ledger" })}
      setPage={() => {}}
      empty={null}
      work={{ doc, write: async () => null }}
    />,
  );
  const text = view.container.textContent ?? "";
  expect(text).toContain("4 · longest");
  expect(text).toContain("1 Elbow · 1 Tee");
  expect(text).toContain("30.0 ft straight");
  expect(text).not.toContain("failed to load");
  for (const word of ["capped", "connect", "ignore", "unset"])
    expect(view.getByRole("group", { name: `assumption for ${OPEN}` }).textContent).toContain(word);
});
