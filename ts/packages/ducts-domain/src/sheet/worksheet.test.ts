import { expect, it } from "vite-plus/test";
import type { Leg, Sheet, SheetPath } from "./types.ts";
import { worksheet } from "./worksheet.ts";

const leg = (id: string, flowCfm: number, lossInWg: number | null, velocityFpm: number): Leg => ({
  id,
  elementId: Number(id.replace(/\D/g, "")) || 1,
  kind: "duct",
  flowCfm,
  flowSource: "terminals",
  velocityFpm,
  lossInWg,
  lossSource: { kind: "friction", ref: "test" },
  equivalentFt: 10,
});
const path = (legIds: string[], elementId: number, knownInWg: number, kind: SheetPath["end"]["kind"] = "terminal"): SheetPath => ({
  side: "supply",
  legIds,
  end: { kind, elementId },
  knownInWg,
  complete: true,
  blockerIds: [],
});

// Trunk a feeds three runs; b feeds two of them; c, d and e are the branches.
const sheet = {
  legs: Object.fromEntries(
    [leg("a1", 300, 0.05, 950), leg("a2", 300, 0.02, 950), leg("b3", 200, 0.04, 800), leg("c4", 100, 0.03, 600), leg("d5", 100, null, 600), leg("e6", 100, 0.01, 500)].map((l) => [l.id, l]),
  ),
  paths: [path(["a1", "a2", "b3", "c4"], 40, 0.14), path(["a1", "a2", "b3", "d5"], 50, 0.11), path(["a1", "a2", "e6"], 60, 0.08), path(["a1", "x7"], 70, 0.05, "sibling-fan")],
} as unknown as Sheet;
(sheet.legs as Record<string, Leg>).x7 = leg("x7", 0, 0, 0);

it("sections are where the run bundle keeps its count; residual and velocity-over per run", () => {
  const w = worksheet(sheet, { maxFpm: { supply: 900, return: 700 } }).supply;
  const sec = (id: string) => w.sections.find((s) => s.id === `supply:${id}`)!;
  // a1 carries all four ends, a2 only the three terminal runs: the sibling peels off between them.
  expect(w.sections.map((s) => [s.legIds.join("+"), s.runIds.length])).toEqual([
    ["a1", 4],
    ["a2", 3],
    ["b3", 2],
    ["c4", 1],
    ["d5", 1],
    ["e6", 1],
    ["x7", 1],
  ]);
  expect(sec("d5")).toMatchObject({ unpricedLegs: 1, knownInWg: 0 });
  expect(sec("a2")).toMatchObject({ cfm: 300, overLegIds: ["a2"] });

  const run = (end: number) => w.runs.find((r) => r.end.elementId === end)!;
  expect(run(40)).toMatchObject({ critical: true, residualInWg: 0, sectionIds: ["supply:a1", "supply:a2", "supply:b3", "supply:c4"] });
  expect(run(60).residualInWg).toBeCloseTo(0.06);
  expect(run(60).overLegIds).toEqual(["a1", "a2"]);
  expect(run(70)).toMatchObject({ critical: false, residualInWg: null });
  expect(w.worstKnownInWg).toBe(0.14);
  // A trunk element sits in one section; the picture's pick selects it and opens the critical run.
  expect(w.elementSections["2"]).toEqual(["supply:a2"]);
});

it("a leg merging back into a run starts a new section", () => {
  // Two runs share x, part at y/z, and the second leg of each is its own: no section spans a junction.
  const s = {
    legs: Object.fromEntries([leg("x1", 2, 0, 0), leg("y2", 1, 0, 0), leg("z3", 1, 0, 0)].map((l) => [l.id, l])),
    paths: [path(["x1", "y2"], 1, 0.1), path(["x1", "z3"], 2, 0.1)],
  } as unknown as Sheet;
  expect(worksheet(s, { maxFpm: { supply: 900, return: 700 } }).supply.sections.map((x) => x.legIds)).toEqual([["x1"], ["y2"], ["z3"]]);
});
