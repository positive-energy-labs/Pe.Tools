/**
 * The grid in `inferJoints` (`cells`, geometry.ts) changes cost, never results. The oracle is the
 * all-pairs scan it replaced: the same module loaded with a `cells` that lists every index for
 * every point. Every saved ducts snapshot fixture (as captured, and with every connector opened)
 * and a dense seeded random network infer identical joints, taps, inline parts and findings,
 * in order, at two tolerances.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vite-plus/test";

import { SCENE_FIXTURE } from "../../../apps/web/src/ducts/scene.fixture.ts";
import { inferJoints } from "./proximity.ts";
import type { DuctSnapshot } from "./types.ts";

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Connector = Segment["connectors"][number];

vi.doMock("./geometry.ts", async (actual) => ({
  ...(await actual<typeof import("./geometry.ts")>()),
  cells: (boxes: readonly unknown[]) => () => boxes.map((_, i) => i),
}));
vi.resetModules();
const oracle = (await import("./proximity.ts")).inferJoints;
vi.doUnmock("./geometry.ts");

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(join(__dirname, "../../../apps/web/src/ducts/fixtures", name), "utf8"),
  ) as Record<string, unknown>;
const synthetic = fixture("synthetic-snapshot.json") as unknown as DuctSnapshot;
const excerpt = (nodes: Node[]): DuctSnapshot => ({ ...synthetic, nodes, segments: [] });
const opened = (s: DuctSnapshot): DuctSnapshot => {
  const open = <T extends { connectors: Connector[] }>(e: T) => ({
    ...e,
    connectors: e.connectors.map((c) => ({ ...c, connectedTo: null })),
  });
  return { ...s, nodes: s.nodes.map(open), segments: s.segments.map(open) };
};

/** A dense random network: ends clustered on a few hubs within ±1.5 in, sizes and air mixed. */
function random(seed: number): DuctSnapshot {
  let state = seed;
  const rnd = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const hubs = Array.from({ length: 24 }, () => [0, 0, 0].map(() => (rnd() - 0.5) * 12));
  const near = () => pick(hubs).map((v) => v + (rnd() - 0.5) * (3 / 12));
  const facing = () => {
    const v = [0, 0, 0].map(() => rnd() - 0.5);
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  };
  const conn = (index: number, point: number[], round: boolean, cls: string): Connector => ({
    index,
    kind: "end",
    point,
    shape: round ? "round" : "rectangular",
    size: round ? '8"ø' : "12x6",
    diameterIn: round ? pick([4, 8, 14]) : null,
    widthIn: round ? null : pick([8, 12, 24]),
    heightIn: round ? null : pick([4, 6, 12]),
    direction: "bidirectional",
    classification: cls,
    connectedTo: null,
    facing: rnd() < 0.5 ? facing() : null,
  });
  const segments: Segment[] = [];
  const nodes: Node[] = [];
  for (let id = 1; id <= 160; id++) {
    const [a, b] = [near(), near()];
    const round = rnd() < 0.5;
    const cls = pick(["SupplyAir", "ReturnAir"]);
    const ends = [conn(1, a, round, cls), conn(2, b, round, cls)];
    segments.push({
      id,
      kind: "duct",
      curveKind: "line",
      type: "Duct",
      shape: ends[0]!.shape,
      size: ends[0]!.size,
      diameterIn: ends[0]!.diameterIn,
      widthIn: ends[0]!.widthIn,
      heightIn: ends[0]!.heightIn,
      lengthFt: Math.hypot(...a.map((v, k) => v - b[k]!)),
      polyline: [a, b],
      groupId: `g${id}`,
      systemName: cls,
      classification: cls,
      roughness: { valueFt: 0.0003, provenance: "revit-default" },
      revit: {},
      connectors: ends,
    });
  }
  for (let id = 1001; id <= 1120; id++) {
    const kind = pick(["terminal", "fitting", "accessory", "cap"] as const);
    const cls = pick(["SupplyAir", "ReturnAir"]);
    const round = rnd() < 0.5;
    const capped = kind === "cap" ? pick(segments) : null;
    const ports =
      kind === "terminal"
        ? [conn(1, near(), round, cls)]
        : capped
          ? [
              {
                ...capped.connectors[1]!,
                index: 1,
                connectedTo: { elementId: capped.id, connector: 2 },
              },
            ]
          : [conn(1, near(), round, cls), conn(2, near(), round, cls)];
    nodes.push({
      id,
      kind,
      category: kind,
      family: kind,
      point: near(),
      groupId: `n${id}`,
      classification: cls,
      connectors: ports,
      facts: [],
    });
  }
  return { ...synthetic, nodes, segments, issues: [] };
}

const cases: [string, DuctSnapshot][] = [
  ["synthetic-snapshot.json", synthetic],
  ["physical-transitions.json", excerpt(fixture("physical-transitions.json").nodes as Node[])],
  [
    "root-attached-fittings.json",
    excerpt(
      (
        fixture("root-attached-fittings.json").cases as { fitting: Node; equipment: Node }[]
      ).flatMap((c) => [c.fitting, c.equipment]),
    ),
  ],
  ["scene.fixture.ts", SCENE_FIXTURE.snapshot],
  ["random 1", random(1)],
  ["random 2", random(20261022)],
];

it.each(cases.flatMap(([name, s]) => [[name, s] as const, [`${name} opened`, opened(s)] as const]))(
  "%s infers what the all-pairs scan infers",
  (_, snapshot) => {
    for (const tolIn of [1, 3])
      expect(inferJoints(snapshot, tolIn)).toEqual(oracle(snapshot, tolIn));
  },
);

it("the random network exercises every inference kind", () => {
  const { joints, taps, inline, findings } = inferJoints(random(1));
  expect(joints.length).toBeGreaterThan(10);
  expect(taps.length).toBeGreaterThan(10);
  expect(new Set(findings.map((f) => f.kind)).size).toBeGreaterThan(3);
  expect(inline.length + findings.length).toBeGreaterThan(0);
});
