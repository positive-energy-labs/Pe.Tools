import { expect, test, vi } from "vite-plus/test";
import { readFileSync } from "node:fs";
import type { Row } from "@pe/ducts-domain/losses";
import { price } from "@pe/ducts-domain/pricing";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import saved from "./fixtures/synthetic-snapshot.json";
import { indexOf, sceneOf, subjectScene } from "./scene";
import { legsOf } from "./legs";

test("both Scene builders retain stub connector facts without admitting stubs to subject annotations", () => {
  const raw = structuredClone(saved) as DuctSnapshot;
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
  const raw = structuredClone(saved) as DuctSnapshot;
  const priced = price(raw, {}, null);
  const path = Object.values(priced.next.paths)[0]!;
  const rows: Row[] = [
    { id: 10, kind: "friction", dp: 2, desc: "first interval" },
    { id: 10, kind: "friction", dp: 3, desc: "second interval" },
    { id: 21, kind: "fitting", dp: 0.2, leg: "Cs", desc: "straight" },
    { id: 21, kind: "fitting", dp: 0.7, leg: "Cb", desc: "branch" },
    { id: 30, kind: "terminal", dp: null, desc: "unpriced" },
    { id: 31, kind: "terminal", dp: 0, desc: "zero" },
  ];
  const next = {
    ...priced.next,
    paths: { 30: { ...path, rows }, 31: { ...path, rows: [...rows] } },
  };
  const current = { ...priced, next };
  const index = indexOf(raw, current);
  expect([...index.loss]).toEqual([
    [10, 5],
    [21, 0.7],
    [31, 0],
  ]);
  const visit = vi.spyOn(rows, Symbol.iterator);
  try {
    const again = indexOf(raw, { ...current });
    expect(again.loss).toBe(index.loss);
    expect(visit).not.toHaveBeenCalled();
    const scene = sceneOf(again, ["g10"], () => true);
    expect(scene.segments.find((f) => f.segment.id === 10)?.pressure).toEqual({ drop: 5 });
    expect(scene.nodes.find((f) => f.node.id === 21)?.pressure).toEqual({ drop: 0.7 });
    expect(scene.nodes.find((f) => f.node.id === 30)?.pressure).toBeUndefined();
    const replacement = structuredClone(next);
    const refreshed = indexOf(raw, { ...current, next: replacement });
    expect(refreshed.loss).toEqual(index.loss);
    expect(refreshed.loss).not.toBe(index.loss);
    const changed = {
      ...next,
      paths: { 30: { ...path, rows: [{ ...rows[0]!, dp: 9 }] } },
    };
    expect([...indexOf(raw, { ...current, next: changed }).loss]).toEqual([[10, 9]]);
    expect(indexOf(raw, current).loss).toBe(index.loss);
    expect(indexOf(raw).loss.size).toBe(0);
  } finally {
    visit.mockRestore();
  }
});

test("saved pricing reuses losses across scopes and replaces them when the result changes", () => {
  const raw: DuctSnapshot = process.env.PE_DUCTS_CACHE_FIXTURE
    ? JSON.parse(readFileSync(process.env.PE_DUCTS_CACHE_FIXTURE, "utf8"))
    : (structuredClone(saved) as DuctSnapshot);
  const priced = price(raw, {}, null);
  const original = indexOf(priced.snapshot, priced);
  expect(original.loss.size).toBeGreaterThan(0);
  expect(indexOf(priced.snapshot, priced).loss).toBe(original.loss);
  expect(indexOf({ ...priced.snapshot }, { ...priced }).loss).toBe(original.loss);
  expect(
    indexOf(priced.snapshot, { ...priced, next: { ...priced.next, paths: {} } }).loss.size,
  ).toBe(0);
  expect(indexOf(priced.snapshot, priced).loss).toBe(original.loss);
});
