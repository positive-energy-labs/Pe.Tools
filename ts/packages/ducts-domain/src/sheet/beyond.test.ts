/**
 * Beyond a stopping unit (kaitpw 2026-10-30, "yes show"): one hop past each unit this fan's walk
 * stops at, never back into the walk, never through the next unit, and never a priced leg.
 */
import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";

import { suggestRoster } from "../roster.ts";
import type { DuctSnapshot } from "../types.ts";
import { beyondOf, stoppingUnits } from "./beyond.ts";
import { buildSheet } from "./build.ts";
import { inputsFor } from "./test-inputs.ts";
import type { Sheet } from "./types.ts";

type Kind = "equipment" | "terminal" | "fitting";
type P = [number, number, number];
const port = (index: number, point: P, elementId: number) => ({
  index,
  point,
  connectedTo: { elementId, connector: 0 },
});
const node = (id: number, kind: Kind, ports: [P, number][]) => ({
  id,
  kind,
  point: ports[0]?.[0] ?? [0, 0, 0],
  connectors: ports.map(([at, to], i) => port(i, at, to)),
});
const seg = (id: number, a: [P, number], b: [P, number] | P) => ({
  id,
  polyline: [a[0], Array.isArray(b[0]) ? b[0] : b],
  connectors: [port(0, a[0], a[1]), ...(Array.isArray(b[0]) ? [port(1, b[0] as P, b[1] as number)] : [])],
});
/**
 * fan 1 -2- ERV 3 (the stop). ERV 3's other ports: duct 4 (5 ft) to grille 5; duct 6 (30 ft) to
 * fitting 7; duct 10 (2 ft) to unit 9, then duct 11 past it. Duct 11 names its joint to 9 on one
 * side only.
 */
const snapshot = {
  nodes: [
    node(1, "equipment", [[[-10, 0, 0], 2]]),
    node(3, "equipment", [
      [[0, 0, 0], 2],
      [[0, 1, 0], 4],
      [[0, -1, 0], 6],
      [[1, 0, 0], 10],
    ]),
    node(5, "terminal", [[[0, 6, 0], 4]]),
    node(7, "fitting", [[[0, -31, 0], 6]]),
    node(9, "equipment", [[[3, 0, 0], 10]]),
  ],
  segments: [
    seg(2, [[-10, 0, 0], 1], [[0, 0, 0], 3]),
    seg(4, [[0, 1, 0], 3], [[0, 6, 0], 5]),
    seg(6, [[0, -1, 0], 3], [[0, -31, 0], 7]),
    seg(10, [[1, 0, 0], 3], [[3, 0, 0], 9]),
    seg(11, [[3, 0, 0], 9], [5, 0, 0]),
  ],
} as unknown as DuctSnapshot;
const end = (kind: string, elementId: number, unitId: number) => ({
  side: "supply",
  legIds: [],
  knownInWg: 0,
  complete: true,
  blockerIds: [],
  end: { kind, elementId, fan: { unitId, portIndex: 0 } },
});
const sheet = {
  fan: { unitId: 1, portIndex: 0 },
  walkedElementIds: [1, 2, 3],
  paths: [end("roster-fan-port", 3, 3), end("terminal", 99, 99)],
  assumed: { paths: [], legs: {}, blockers: [] },
} as unknown as Sheet;

it("every other port of a stopping unit runs out as a stub, cut at the reach, never into the walk", () => {
  expect(stoppingUnits(sheet)).toEqual([{ unitId: 3, ends: [3] }]);
  const beyond = beyondOf(snapshot, sheet, (id) => `U-${id}`);
  // 2 is this fan's walk; 7 lies past the 15 ft reach; 11 lies past unit 9 (the next unit).
  expect(beyond).toEqual([
    {
      unitId: 3,
      mark: "U-3",
      elementIds: [4, 5, 6, 9, 10],
      cuts: [{ id: 6, from: [0, -1, 0], at: [0, -16, 0] }],
    },
  ]);
  expect(beyondOf(snapshot, sheet, String, 3).flatMap((b) => b.elementIds)).toEqual([4, 6, 9, 10]);
});

it("a terminal end is not a stop, and an element past two stops is listed once", () => {
  const two = {
    ...sheet,
    paths: [...sheet.paths, end("joins-other-fan", 10, 9)],
  } as unknown as Sheet;
  const beyond = beyondOf(snapshot, two, String);
  expect(beyond.map((b) => [b.unitId, b.elementIds])).toEqual([
    [3, [4, 5, 6, 9, 10]],
    [9, [11]],
  ]);
  expect(stoppingUnits({ ...sheet, paths: [end("terminal", 5, 3)] } as unknown as Sheet)).toEqual([]);
});

const CHADDS =
  "C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/tmp/ducts-sheet/chadds-snapshot-health.json";
const MUAS1 = 14577391;
const RV15 = 6105264;
const RV7 = 6953852;
it.skipIf(!existsSync(CHADDS))(
  "MUAS-1 on Chadds: RV-15's and RV-7's other ports run out as stubs, none of it priced",
  () => {
    const snap = (
      JSON.parse(readFileSync(CHADDS, "utf8").replace(/^\uFEFF/, "")) as { result: DuctSnapshot }
    ).result;
    const r = suggestRoster(snap);
    const roster = [...r.fans, ...r.suggestions];
    const port = roster.find((p) => p.unitId === MUAS1)!;
    const built = buildSheet({
      snapshot: snap,
      inputs: inputsFor(snap),
      fan: { unitId: MUAS1, portIndex: port.portIndex },
      roster,
      grids: {},
    });
    const tag = (id: number) => roster.find((p) => p.unitId === id)?.tag ?? `unit ${id}`;
    const beyond = beyondOf(snap, built, tag);
    const units = beyond.map((b) => b.unitId);
    expect(units).toEqual(expect.arrayContaining([RV15, RV7]));
    const kinds = new Map(snap.nodes.map((n) => [n.id, n.kind]));
    for (const unit of [RV15, RV7]) {
      const ids = beyond.find((b) => b.unitId === unit)!.elementIds;
      // Each ERV's other ports run out as stubs: bounded, and ending in a cut or a grille.
      expect(ids.length).toBeGreaterThan(1);
      expect(ids.length).toBeLessThan(60);
    }
    // Context only: nothing beyond is walked, and no leg of either pass stands on it.
    const walked = new Set(built.walkedElementIds);
    const priced = new Set(
      [...Object.values(built.legs), ...Object.values(built.assumed.legs)].map((l) => l.elementId),
    );
    for (const id of beyond.flatMap((b) => b.elementIds)) {
      expect(walked.has(id)).toBe(false);
      expect(priced.has(id)).toBe(false);
    }
    console.log(
      JSON.stringify(beyond.map((b) => ({ unit: b.unitId, mark: b.mark, n: b.elementIds.length, cuts: b.cuts.length, terminals: b.elementIds.filter((id) => kinds.get(id) === "terminal").length }))),
    );
  },
  120_000,
);
