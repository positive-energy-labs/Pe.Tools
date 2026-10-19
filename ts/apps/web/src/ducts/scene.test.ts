/**
 * The subject scene, deterministic: `subjectScene` draws the ordered ids' elements, no group, and
 * bounds the faint context to the subject's levels and its padded box.
 */
import { expect, it } from "vite-plus/test";

import { legsOf, type SubjectCut } from "./legs";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { CONTEXT_PAD_FT, indexOf, subjectScene } from "./scene";

type Segment = DuctSnapshot["segments"][number];
type Node = DuctSnapshot["nodes"][number];

const segment = (id: number, from: number[], to: number[], levelId: number): Segment => ({
  id,
  kind: "duct",
  curveKind: "line",
  shape: "round",
  size: '10"ø',
  lengthFt: Math.hypot(to[0]! - from[0]!, to[1]! - from[1]!, to[2]! - from[2]!),
  polyline: [from, to],
  levelId,
  roughness: { valueFt: 0.0003, provenance: "revit-default" },
  revit: {},
  connectors: [],
});
const node = (id: number, kind: Node["kind"], point: number[], levelId: number): Node => ({
  id,
  kind,
  category: kind,
  point,
  levelId,
  connectors: [],
  facts:
    kind === "equipment"
      ? [{ key: "Mark", text: `AHU-${id}`, unit: "", provenance: "revit-reported" }]
      : [],
});

const L1 = 1;
const L2 = 2;
const L3 = 3;
const snapshot = {
  coordinateEncoding: "native-double",
  document: {
    title: "t",
    readAt: "2026-10-19T00:00:00Z",
    elapsedMs: 0,
    networkBasedCalculations: false,
  },
  levels: [
    { id: L1, name: "Main", elevationFt: 0 },
    { id: L2, name: "Upper", elevationFt: 12.5 },
    { id: L3, name: "Attic", elevationFt: 24 },
  ],
  groups: [],
  nodes: [
    node(1, "equipment", [0, 0, 1], L1),
    node(2, "fitting", [10, 0, 1], L1),
    node(3, "accessory", [10, 20, 1], L1),
    // Off the subject, inside its box: no group, never drawn as context (context is segments).
    node(4, "cap", [5, 5, 1], L1),
  ],
  segments: [
    segment(11, [0, 0, 1], [10, 0, 1], L1),
    segment(12, [10, 0, 1], [10, 20, 1], L1),
    // Context within the pad on a touched level: kept.
    segment(21, [15, 25, 1], [15, 35, 1], L1),
    // Context beyond the pad on a touched level: dropped.
    segment(22, [10 + CONTEXT_PAD_FT + 5, 0, 1], [10 + CONTEXT_PAD_FT + 15, 0, 1], L1),
    // Context within the box on an untouched level: dropped.
    segment(23, [5, 5, 25], [5, 15, 25], L3),
  ],
  flows: [],
  issues: [],
  layers: [],
  systems: [],
  slots: { fanStatic: "a", fanFlow: "b", componentDrop: "c", fittingCoefficient: "d" },
} as DuctSnapshot;

const SUBJECT = [1, 11, 2, 12, 3];
const markOf = (id: number) =>
  snapshot.nodes.find((n) => n.id === id)?.facts.find((f) => f.key === "Mark")?.text ?? null;

it("subjectScene draws the ids' elements in order and bounds the context to touched levels and the padded box", () => {
  const index = indexOf(snapshot);
  const cut = legsOf(snapshot, SUBJECT, markOf);
  const scene = subjectScene(index, SUBJECT, cut, []);
  expect(scene.segments.map((f) => f.segment.id)).toEqual([11, 12]);
  expect(scene.nodes.map((f) => f.node.id)).toEqual([1, 2, 3]);
  expect(scene.issues).toEqual([]);
  const contextIds = scene.context.flat().map((s) => s.polyline[0]![0]);
  expect(contextIds).toEqual([15]);
  expect(scene.subject?.levels.map((l) => l.id)).toEqual([L1]);
  // The cut: AHU-1 → accessory, one leg of 30 ft with one fitting; the places carry names.
  expect(cut.legs.map((leg) => [leg.from.name, leg.to.name, leg.lengthFt, leg.fittings])).toEqual([
    ["AHU-1", "accessory 3", 30, 1],
  ]);
  expect(scene.subject?.legOf.get(11)?.name).toBe("AHU-1 → accessory 3");
  expect(scene.subject?.placeOf.get(1)?.kind).toBe("equipment");
});

it("subjectScene resolves a gap to the model points it spans", () => {
  const index = indexOf(snapshot);
  const cut: SubjectCut = { legs: [], nodes: [], gaps: [{ after: 11, before: 3 }] };
  const scene = subjectScene(index, SUBJECT, cut, []);
  expect(scene.subject?.gaps).toEqual([
    { after: 11, before: 3, from: [10, 0, 1], to: [10, 20, 1] },
  ]);
});
