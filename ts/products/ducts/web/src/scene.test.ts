import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { syntheticSnapshot } from "@pe/ducts-domain/test-fixture";
import { indexOf, sceneOf, subjectScene } from "./scene.ts";
import { legsOf } from "./legs.ts";
import { calcOf, calcsOf, legOf, withFan } from "./calcs.test-support.ts";

test("both Scene builders retain stub connector facts without admitting stubs to subject annotations", () => {
  const raw = syntheticSnapshot();
  const index = indexOf(raw);
  const subject = raw.segments[0]!;
  const adjacent = raw.nodes.find((n) => n.kind === "equipment")!;
  const ids = [subject.id, adjacent.id, adjacent.id, -1];
  const scenes = [
    sceneOf(index, [subject.groupId!], () => true, new Set([subject.id])),
    subjectScene(
      index,
      [subject.id],
      legsOf(raw, [subject.id], () => null),
    ),
  ];
  for (const scene of scenes) {
    expect(scene.nodes).toEqual([]);
    const graph = scene.graphOf(ids);
    expect(graph.nodes).toEqual([adjacent]);
    expect(graph.nodes[0]!.connectors).toBe(adjacent.connectors);
    expect(graph.segments).toEqual([subject]);
    expect(scene.graphOf([])).toEqual({ nodes: [], segments: [] });
  }
});

test("scopes share immutable loss projections, preserving interval sums and alternative legs", () => {
  const raw = syntheticSnapshot();
  const legs = [
    legOf("10:1>2", 10, "duct", 2),
    legOf("10:2>3", 10, "duct", 3),
    legOf("21:1>2", 21, "fitting", 0.7),
    legOf("21:1>3", 21, "fitting", 0.2),
    legOf("30:1>", 30, "terminal", null),
    legOf("31:1>", 31, "terminal", 0),
  ];
  const calcs = [
    calcOf(1, legs, [
      { terminal: 30, legIds: ["10:1>2", "10:2>3", "21:1>2", "30:1>"] },
      { terminal: 31, legIds: ["10:1>2", "10:2>3", "21:1>3", "31:1>"] },
    ]),
  ];
  const current = { calcs };
  const index = indexOf(raw, current);
  expect([...index.loss]).toEqual([
    [10, 5],
    [21, 0.7],
    [31, 0],
  ]);
  const again = indexOf(raw, { ...current });
  expect(again.loss).toBe(index.loss);
  const scene = sceneOf(again, ["g10"], () => true);
  expect(scene.segments.find((f) => f.segment.id === 10)?.pressure).toEqual({ drop: 5 });
  expect(scene.nodes.find((f) => f.node.id === 21)?.pressure).toEqual({ drop: 0.7 });
  expect(scene.nodes.find((f) => f.node.id === 30)?.pressure).toBeUndefined();
  const refreshed = indexOf(raw, { calcs: structuredClone(calcs) });
  expect(refreshed.loss).toEqual(index.loss);
  expect(refreshed.loss).not.toBe(index.loss);
  const changed = [
    calcOf(1, [legOf("10:1>2", 10, "duct", 9)], [{ terminal: 30, legIds: ["10:1>2"] }]),
  ];
  expect([...indexOf(raw, { calcs: changed }).loss]).toEqual([[10, 9]]);
  expect(indexOf(raw, current).loss).toBe(index.loss);
  expect(indexOf(raw).loss.size).toBe(0);
});

test("a shared duct draws one loss, the same on each fan's calc, never their sum (Q7)", () => {
  const shared = () => legOf("10:1>2", 10, "duct", 2);
  const calcs = [
    calcOf(
      1,
      [shared(), legOf("30:1>", 30, "terminal", 0.1)],
      [{ terminal: 30, legIds: ["10:1>2", "30:1>"] }],
    ),
    calcOf(
      2,
      [shared(), legOf("31:1>", 31, "terminal", 0.2)],
      [{ terminal: 31, legIds: ["10:1>2", "31:1>"] }],
    ),
  ];
  expect(indexOf(syntheticSnapshot(), { calcs }).loss.get(10)).toBe(2);
});

test("saved calcs reuse losses across scopes and replace them when the result changes", () => {
  const raw: DuctSnapshot = withFan(
    process.env.PE_DUCTS_CACHE_FIXTURE
      ? JSON.parse(readFileSync(process.env.PE_DUCTS_CACHE_FIXTURE, "utf8"))
      : syntheticSnapshot(),
  );
  const priced = { calcs: calcsOf(raw) };
  const original = indexOf(raw, priced);
  expect(original.loss.size).toBeGreaterThan(0);
  expect(indexOf(raw, priced).loss).toBe(original.loss);
  expect(indexOf({ ...raw }, { ...priced }).loss).toBe(original.loss);
  expect(indexOf(raw, { calcs: [] }).loss.size).toBe(0);
  expect(indexOf(raw, priced).loss).toBe(original.loss);
});
