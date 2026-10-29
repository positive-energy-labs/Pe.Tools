import { expect, it } from "vite-plus/test";
import type { DuctSnapshot } from "../types.ts";
import { buildChain } from "./build.ts";
import { withHealth } from "./health.fixture.ts";
import { graphOf, walkFrom } from "./walk.ts";

type Connector = DuctSnapshot["nodes"][number]["connectors"][number];
const port = (index: number, x: number, facing: number[], to: [number, number] | null): Connector =>
  ({
    index,
    point: [x, 0, 0],
    facing,
    kind: "end",
    direction: "bidirectional",
    shape: "round",
    diameterIn: 8,
    connectedTo: to ? { elementId: to[0], connector: to[1] } : null,
  }) as Connector;

function fixture(gapIn: number) {
  const root = {
    id: 100,
    kind: "equipment",
    facts: [],
    connectors: [port(0, 0, [1, 0, 0], [1, 0])],
  };
  const terminal = {
    id: 200,
    kind: "terminal",
    facts: [],
    connectors: [port(0, 8, [-1, 0, 0], [2, 1])],
  };
  const duct = (id: number, a: number, b: number, connectors: Connector[]) => ({
    id,
    shape: "round",
    diameterIn: 8,
    polyline: [
      [a, 0, 0],
      [b, 0, 0],
    ],
    lengthFt: b - a,
    roughness: { valueFt: 0.0003 },
    connectors,
  });
  return {
    document: { title: "joins", readAt: "fixed" },
    nodes: [root, terminal],
    segments: [
      duct(1, 0, 4, [port(0, 0, [-1, 0, 0], [100, 0]), port(1, 4, [1, 0, 0], null)]),
      duct(2, 4 + gapIn / 12, 8, [
        port(0, 4 + gapIn / 12, [-1, 0, 0], null),
        port(1, 8, [1, 0, 0], [200, 0]),
      ]),
    ],
  } as unknown as DuctSnapshot;
}

it("auto-joins exactly 3 inches, records sheet input and leg provenance, and obeys the settings threshold and rejection", () => {
  const snapshot = fixture(3);
  const input = {
    snapshot: withHealth(snapshot),
    start: { elementId: 100, connector: 0 },
    end: { elementId: 200 },
    direction: "supply" as const,
    flowCfm: 100,
    grids: {},
  };
  const chain = buildChain(input);
  expect(chain.path!.complete).toBe(true);
  expect(
    chain.inputs.some((i) => i.name === "auto-joined 1:1 to 2:0 across 3.000 in, default ≤3 in"),
  ).toBe(true);
  expect(chain.legs["2:0>1"]!.lossSource.ref).toContain("auto-joined 1:1 to 2:0");
  // The auto-join gap is a read tolerance (C#): the graph is measured under 2 in.
  const smaller = walkFrom(
    graphOf(withHealth(snapshot, { autoJoinGapIn: 2 })),
    snapshot.nodes[0]!,
    0,
    {
      roster: [],
    },
  );
  expect([...smaller.blockers.values()].some((b) => b.kind === "inferred-join")).toBe(true);
  expect(smaller.autoJoins).toEqual([]);
  const rejected = walkFrom(graphOf(withHealth(snapshot)), snapshot.nodes[0]!, 0, {
    roster: [],
    rulings: [{ pair: ["1:1", "2:0"], verdict: "reject" }],
  });
  expect(rejected.autoJoins).toEqual([]);
  expect(rejected.ends[0]!.end.kind).toBe("open-end");
});

it("beyond 3 inches and sideways ports remain inferred-join blockers; occupied targets never auto-join", () => {
  for (const scenario of ["far", "sideways", "occupied"] as const) {
    const snapshot = fixture(scenario === "far" ? 3.01 : 2);
    const target = snapshot.segments[1]!.connectors[0]!;
    if (scenario === "sideways") target.facing = [0, 1, 0];
    if (scenario === "occupied") target.connectedTo = { elementId: 999, connector: 0 };
    const walk = walkFrom(graphOf(withHealth(snapshot)), snapshot.nodes[0]!, 0, { roster: [] });
    expect(walk.autoJoins).toEqual([]);
    expect(walk.ends[0]!.end.kind).toBe("open-end");
    if (scenario !== "occupied")
      expect([...walk.blockers.values()].some((b) => b.kind === "inferred-join")).toBe(true);
    else
      expect(
        [...walk.blockers.values()].some((b) => /nearest candidate 2:0.*occupied/.test(b.detail)),
      ).toBe(true);
  }
});

it("an open end names the nearest occupied connector or duct body, and says nothing nearby only when true", () => {
  const snapshot = fixture(12);
  snapshot.segments[1]!.connectors[0]!.connectedTo = { elementId: 999, connector: 0 };
  const near = walkFrom(graphOf(withHealth(snapshot)), snapshot.nodes[0]!, 0, { roster: [] });
  expect([...near.blockers.values()][0]!.detail).toMatch(
    /nearest candidate 2:0 at 12\.000 in, occupied/,
  );
  const far = fixture(60);
  far.segments = [far.segments[0]!];
  far.nodes = [far.nodes[0]!];
  expect(
    [...walkFrom(graphOf(withHealth(far)), far.nodes[0]!, 0, { roster: [] }).blockers.values()][0]!
      .detail,
  ).toContain("nothing within 36 in");
});
