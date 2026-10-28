/**
 * The path engine, deterministic. Synthetic: the kernel's independently computed network
 * (price-leg.test.ts, handcalc.py totals T6/T8) hung off a roster fan with a return run; a
 * side-stream into another fan's return (shared-leg, joins-other-fan); open and inferred ends.
 * Retained: MUAS-1 on the raw Chadds snapshot, skipped when the file is absent.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";

import type { Grid, Grids } from "../loss-grid.ts";
import { friction, roundSection } from "../loss-physics.ts";
import { suggestRoster, type FanPort } from "../roster.ts";
import type { DuctSnapshot } from "../types.ts";
import { buildChain, buildSheet, type SheetSnapshot } from "./index.ts";

// ---- test-only .tbl reader (ctable.py parse), as in kernel/price-leg.test.ts ------------------
function parseTbl(file: string): Record<string, Grid> {
  const text = readFileSync(file, "latin1");
  const out: Record<string, Grid> = {};
  for (const block of text.split(/\r?\n=+\r?\n/)) {
    if (!block.trim() || block.trim().startsWith("'")) continue;
    const lines = block.split(/\r?\n/).filter((l) => l.trim() && !/^[#\s]+$/.test(l));
    const title = lines[0]!.trim();
    const rest = lines.slice(1);
    const head = rest.findIndex((l) => l.includes("->"));
    if (head >= 0) {
      const res = rest.find((l) => /^\s*C\w*\s*$/.test(l))?.trim() ?? "Co";
      const [xLabel, xs] = rest[head]!.split("->");
      const y: number[] = [];
      const grid: number[][] = [];
      for (const l of rest.slice(head + 1).filter((l) => /^\s*[-\d.]/.test(l))) {
        const v = l.trim().split(/\s+/).map(Number);
        y.push(v[0]!);
        grid.push(v.slice(1));
      }
      out[res] = { title, xLabel: xLabel!.trim(), x: xs!.trim().split(/\s+/).map(Number), yLabel: rest[head + 1]!.trim(), y, grid };
    } else {
      const header = rest.find((l) => /\d+\(\d+\)/.test(l))!;
      const x = [...header.matchAll(/(\d+(?:\.\d+)?)\(\d+\)/g)].map((m) => Number(m[1]));
      const co = rest.find((l) => l.trim().startsWith("Co"))!;
      out.Co = { title, xLabel: "D", x, grid: co.trim().split(/\s+/).slice(1).map(Number) };
    }
  }
  return out;
}
const GRID_DIRS = [join(__dirname, "../../../../apps/web/src/ducts/fixtures/ashrae"), join(__dirname, "../../../../../dotnet/Pe.Shared.Tests/RevitData/Fixtures/Ashrae")];
const grids: Grids = Object.fromEntries(GRID_DIRS.filter(existsSync).flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".tbl")).flatMap((f) => {
  try { return [[f.replace(".tbl", "").toUpperCase(), parseTbl(join(d, f))]]; } catch { return []; } // Cr3-10 is another layout
})));

type Node = DuctSnapshot["nodes"][number];
type Segment = DuctSnapshot["segments"][number];
type Conn = Node["connectors"][number];
const round = (d: number) => ({ shape: "round" as const, size: `${d}`, diameterIn: d });
const rect = (w: number, h: number) => ({ shape: "rectangular" as const, size: `${w}x${h}`, widthIn: w, heightIn: h });
const conn = (index: number, to: [number, number] | null, size: object, kind = "end", point = [0, 0, 0], classification?: string): Conn =>
  ({ index, kind, point, direction: "out", connectedTo: to ? { elementId: to[0], connector: to[1] } : null, ...(classification ? { classification } : {}), ...size }) as Conn;
const node = (id: number, kind: string, extra: object): Node =>
  ({ id, kind, category: "", point: [0, 0, 0], groupId: "g1", facts: [], ...extra }) as unknown as Node;
const duct = (id: number, lengthFt: number, size: object, polyline: number[][], connectors: Conn[]): Segment =>
  ({ id, kind: "duct", curveKind: "line", ...size, lengthFt, polyline, groupId: "g1", roughness: { valueFt: 0.0003, provenance: "revit-default" }, revit: {}, connectors }) as unknown as Segment;
const snapshot = (nodes: Node[], segments: Segment[]): SheetSnapshot =>
  ({ nodes, segments, document: { title: "synthetic", readAt: "2026-10-27", elapsedMs: 0, networkBasedCalculations: false } });
const fanPort = (unitId: number, portIndex: number, inletPortIndex?: number): FanPort =>
  ({ unitId, portIndex, tag: `F-${unitId}`, side: "supply", kind: "air-handler", source: "ruling", ...(inletPortIndex == null ? {} : { inletPortIndex }) });

// Supply: unit 100:0 -> duct 1 -> elbow 2 -> duct 3 (tap 4 at 5 ft) -> transition 5 -> grille 6; tap 4 -> duct 7 -> terminal 8.
// Return: unit 100:1 -> duct 9 (20 ft) -> grille 10.
const unit = node(100, "equipment", { connectors: [conn(0, [1, 0], round(8)), conn(1, [9, 0], round(8))] });
const elbow = node(2, "fitting", { partType: "Elbow", connectors: [conn(0, [1, 1], round(8)), conn(1, [3, 0], round(8))], facts: [{ key: "rOverD", value: 1, unit: "", provenance: "geometry" }] });
const tap = node(4, "fitting", { partType: "TapAdjustable", connectors: [conn(0, [3, 2], round(6), "curve"), conn(1, [7, 0], round(6))], facts: [{ key: "mainSegment", value: 3, unit: "", provenance: "geometry" }] });
const transition = node(5, "fitting", { partType: "Transition", connectors: [{ ...conn(0, [3, 1], round(8)), direction: "in" }, conn(1, [6, 0], rect(12, 4))], facts: [{ key: "angle", value: 45, unit: "deg", provenance: "designer-stated" }] });
const grille6 = node(6, "terminal", { connectors: [conn(0, [5, 1], rect(12, 4))] });
const terminal8 = node(8, "terminal", { connectors: [conn(0, [7, 1], round(6))] });
const grille10 = node(10, "terminal", { connectors: [conn(0, [9, 1], round(8))] });
const duct1 = duct(1, 10, round(8), [[0, 0, 0], [10, 0, 0]], [conn(0, [100, 0], round(8), "end", [0, 0, 0]), conn(1, [2, 0], round(8), "end", [10, 0, 0])]);
const duct3 = duct(3, 12, round(8), [[10, 0, 0], [10, 12, 0]], [conn(0, [2, 1], round(8), "end", [10, 0, 0]), conn(1, [5, 0], round(8), "end", [10, 12, 0]), conn(2, [4, 0], round(6), "curve", [10, 5, 0])]);
const duct7 = duct(7, 3, round(6), [[10, 5, 0], [10, 5, 3]], [conn(0, [4, 1], round(6)), conn(1, [8, 0], round(6))]);
const duct9 = duct(9, 20, round(8), [[0, 0, 0], [-20, 0, 0]], [conn(0, [100, 1], round(8), "end", [0, 0, 0]), conn(1, [10, 0], round(8), "end", [-20, 0, 0])]);
const network = snapshot([unit, elbow, tap, transition, grille6, terminal8, grille10], [duct1, duct3, duct7, duct9]);
const T6 = 0.09187933;
const T8 = 0.16736657;

it("a complete sheet: required ESP = worst supply + worst return + allowances", () => {
  const sheet = buildSheet({
    snapshot: network, fan: { unitId: 100, portIndex: 0 }, roster: [fanPort(100, 0, 1)], grids,
    endCfm: { 6: 200, 8: 100, 10: 300 }, drops: { 6: 0.05, 8: 0.08, 10: 0.03 }, allowanceInWg: { supply: 0.1, return: 0.05 },
  });
  const R = friction(roundSection(8), 300, 20, 0.0003).dp + 0.03;
  const supply = sheet.paths.filter((p) => p.side === "supply");
  expect(supply.map((p) => p.end.elementId)).toEqual([8, 6]); // ranked worst first
  expect(supply[0]!.knownInWg).toBeCloseTo(T8, 6);
  expect(supply[1]!.knownInWg).toBeCloseTo(T6, 6);
  expect(sheet.paths.find((p) => p.side === "return")!.knownInWg).toBeCloseTo(R, 6);
  expect(sheet.paths.every((p) => p.complete)).toBe(true);
  expect(sheet.blockers).toEqual([]);
  expect(sheet.totals.supply).toMatchObject({ complete: true, worstPath: expect.closeTo(T8, 6), allowanceInWg: 0.1 });
  expect(sheet.totals.requiredEspInWg).toBeCloseTo(T8 + R + 0.15, 5);
  expect(sheet.fan).toMatchObject({ flowCfm: 300, inletPortIndex: 1, mark: "F-100" });
  // Legs are keyed once; flow is the sum of the ends reached through each leg.
  expect(supply[0]!.legIds.filter((id) => supply[1]!.legIds.includes(id))).toEqual(["1:0>1", "2:0>1"]);
  expect(sheet.legs["3:0>1"]).toMatchObject({ flowCfm: 200, kind: "duct" });
  expect(sheet.legs["3:0>2"]).toMatchObject({ flowCfm: 100 });
  expect(sheet.legs["1:0>1"]).toMatchObject({ flowCfm: 300, equivalentFt: 10 });
  expect(sheet.legs["4:0>1"]!.lossSource).toMatchObject({ kind: "rule", ref: expect.stringContaining("SD5-9 Cb") });
  expect(sheet.totals.supply.telFt).toBeGreaterThan(10 + 5 + 3);
  // The same inputs give the same basis; a changed input changes it.
  const again = buildSheet({ snapshot: network, fan: { unitId: 100, portIndex: 0 }, roster: [fanPort(100, 0, 1)], grids, endCfm: { 6: 200, 8: 100, 10: 300 }, drops: { 6: 0.05, 8: 0.08, 10: 0.03 }, allowanceInWg: { supply: 0.1, return: 0.05 } });
  expect(again.basis).toBe(sheet.basis);
  const missing = buildSheet({ snapshot: network, fan: { unitId: 100, portIndex: 0 }, roster: [fanPort(100, 0, 1)], grids, endCfm: { 6: 200, 10: 300 }, drops: { 6: 0.05, 8: 0.08, 10: 0.03 } });
  expect(missing.basis).not.toBe(sheet.basis);
  // A terminal with no flow withholds every leg it shares, and the total.
  expect(missing.blockers.map((b) => b.id)).toContain("no-flow:8:0");
  expect(missing.paths.find((p) => p.end.elementId === 6)!.complete).toBe(false);
  expect(missing.totals.requiredEspInWg).toBeNull();
});

it("chain mode prices one asserted chain at a typed flow, with no ESP claim", () => {
  const chain = buildChain({ snapshot: network, start: { elementId: 100, connector: 0 }, end: { elementId: 8 }, direction: "supply", grids, flowCfm: 100, drops: { 8: 0.08 } });
  expect(chain.path!.legIds).toEqual(["1:0>1", "2:0>1", "3:0>2", "4:0>1", "7:0>1", "8:0>"]);
  expect(Object.values(chain.legs).every((l) => l.flowCfm === 100)).toBe(true);
  expect(chain.path!.end.kind).toBe("terminal");
  expect(chain).not.toHaveProperty("totals");
});

it("a side-stream into another fan's return: cut at the class change, shared leg named", () => {
  // F 300:0 (supply air) -> duct 31 (return air main) -> G 400:1; duct 31 tap 32 -> duct 33 -> return grille 34 (500 cfm, G's).
  const SA = "SupplyAir", RA = "ReturnAir";
  const f = node(300, "equipment", { connectors: [conn(0, [31, 0], round(8), "end", [0, 0, 0], SA), conn(1, null, round(8), "end", [0, 0, 0], RA)] });
  const g = node(400, "equipment", { connectors: [conn(1, [31, 1], round(8), "end", [20, 0, 0], RA), conn(2, null, round(8), "end", [20, 0, 0], SA)] });
  const tap32 = node(32, "fitting", { partType: "TapAdjustable", connectors: [conn(0, [31, 2], round(6), "curve", [10, 0, 0], RA), conn(1, [33, 0], round(6), "end", [10, 0, 0], RA)] });
  const grille34 = node(34, "terminal", { flowParameter: "PE_M_Grd_AirFlow", facts: [{ key: "flow", value: 500, unit: "cfm", provenance: "designer-stated" }], connectors: [conn(0, [33, 1], round(6), "end", [10, 3, 0], RA)] });
  const d31 = duct(31, 20, round(8), [[0, 0, 0], [20, 0, 0]], [conn(0, [300, 0], round(8), "end", [0, 0, 0], RA), conn(1, [400, 1], round(8), "end", [20, 0, 0], RA), conn(2, [32, 0], round(6), "curve", [10, 0, 0], RA)]);
  const d33 = duct(33, 3, round(6), [[10, 0, 0], [10, 3, 0]], [conn(0, [32, 1], round(6), "end", [10, 0, 0], RA), conn(1, [34, 0], round(6), "end", [10, 3, 0], RA)]);
  const sheet = buildSheet({
    snapshot: snapshot([f, g, tap32, grille34], [d31, d33]), fan: { unitId: 300, portIndex: 0 },
    roster: [fanPort(300, 0), fanPort(400, 2, 1)], grids, slot: "PE_M_Grd_AirFlow", sideStreamCfm: 100,
  });
  expect(sheet.paths.map((p) => [p.end.kind, p.end.elementId])).toEqual(expect.arrayContaining([["roster-fan-port", 400], ["joins-other-fan", 31]]));
  expect(sheet.paths.some((p) => p.end.elementId === 34)).toBe(false); // G's grille is not F's terminal
  expect(sheet.legs["31:0>1"]).toMatchObject({ flowCfm: 100, flowSource: "side-stream:1" });
  const shared = sheet.blockers.find((b) => b.kind === "shared-leg")!;
  expect(shared).toMatchObject({ elementId: 31, owner: { unitId: 400, portIndex: 2 } });
  expect(sheet.blockers.map((b) => b.id)).toEqual(expect.arrayContaining(["class-change:31:0", "open-end:300"]));
  expect(sheet.totals.requiredEspInWg).toBeNull();
});

it("an open end blocks its side; an inferred join to a vacant opposed port is followed and named", () => {
  const IN = 1 / 12;
  const fan = node(500, "equipment", { connectors: [conn(0, [51, 0], round(6)), conn(1, [52, 0], round(6))] });
  const open = duct(51, 5, round(6), [[0, 0, 0], [0, -5, 0]], [conn(0, [500, 0], round(6), "end", [0, 0, 0]), conn(1, null, round(6), "end", [0, -5, 0])]);
  const d52 = duct(52, 10, round(6), [[0, 0, 0], [10, 0, 0]], [conn(0, [500, 1], round(6), "end", [0, 0, 0]), conn(1, null, round(6), "end", [10, 0, 0])]);
  const d53 = duct(53, 10, round(6), [[10 + 0.4 * IN, 0, 0], [20, 0, 0]], [conn(0, null, round(6), "end", [10 + 0.4 * IN, 0, 0]), conn(1, [54, 0], round(6), "end", [20, 0, 0])]);
  const grille = node(54, "terminal", { connectors: [conn(0, [53, 1], round(6), "end", [20, 0, 0])] });
  const input = { snapshot: snapshot([fan, grille], [open, d52, d53]), fan: { unitId: 500, portIndex: 0 }, roster: [fanPort(500, 0, 1)], grids, endCfm: { 54: 100 }, drops: { 54: 0.02 } };
  const sheet = buildSheet(input);
  const supply = sheet.paths.find((p) => p.side === "supply")!;
  expect(supply.end).toEqual({ kind: "open-end", elementId: 51, connector: 1 });
  expect(sheet.blockers.find((b) => b.id === "open-end:51:1")).toMatchObject({ closer: { kind: "ruling" } });
  expect(sheet.totals.supply).toMatchObject({ complete: false, worstPath: null });
  // The supply's one end carries nothing, so it carries what the return delivers.
  expect(sheet.legs["51:0>1"]).toMatchObject({ flowCfm: 100, flowSource: "balance:1" });
  const ret = sheet.paths.find((p) => p.side === "return")!;
  expect(ret.end).toMatchObject({ kind: "terminal", elementId: 54 });
  const join = sheet.blockers.find((b) => b.id === "inferred-join:52:1")!;
  expect(join.closer.candidate).toMatchObject({ toElementId: 53, toConnector: 0, gapIn: expect.closeTo(0.4, 6), pair: ["52:1", "53:0"] });
  expect(ret.complete).toBe(false);
  expect(sheet.totals.requiredEspInWg).toBeNull();
  // A person's accept closes the join; the open supply end still withholds ESP.
  const ruled = buildSheet({ ...input, rulings: [{ pair: ["52:1", "53:0"], verdict: "accept" }] });
  expect(ruled.paths.find((p) => p.side === "return")!.complete).toBe(true);
  expect(ruled.totals.return.worstPath).toBeCloseTo(friction(roundSection(6), 100, 10 + 10, 0.0003).dp + 0.02, 5);
  expect(ruled.totals.requiredEspInWg).toBeNull();
});

const CHADDS = "C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/tmp/ducts-sheet/chadds-snapshot-raw.json";
it.skipIf(!existsSync(CHADDS))("MUAS-1 on Chadds: bounded walk, the capped plenum named, FC-23 a stop, no ESP", () => {
  const snap = (JSON.parse(readFileSync(CHADDS, "utf8")) as { result: DuctSnapshot }).result;
  const r = suggestRoster(snap);
  const roster = [...r.fans, ...r.suggestions];
  const port = roster.find((p) => p.unitId === 14577391)!;
  const sheet = buildSheet({ snapshot: snap, fan: { unitId: 14577391, portIndex: port.portIndex }, roster, grids });
  expect(sheet.walkedElementIds.length).toBeLessThan(500); // W0-A's all-to-all walk leaked to 1470
  const plenum = sheet.blockers.find((b) => b.id === "inferred-join:14122436:1")!;
  expect(plenum.detail).toMatch(/14106988:1, already capped by 14107111/);
  expect(plenum.closer.candidate).toMatchObject({ toElementId: 14106988, toConnector: 1 });
  expect(sheet.paths.find((p) => p.end.elementId === 13760867)!.end).toMatchObject({ kind: "roster-fan-port", connector: 3, fan: { unitId: 13760867 } });
  expect(sheet.totals.requiredEspInWg).toBeNull();

  // Asserted the other way (port 1 discharges toward FC-23, as the .r10 reads it), at the .r10's runout flows.
  const asserted = buildSheet({
    snapshot: snap, fan: { unitId: 14577391, portIndex: 1, inletPortIndex: 2 }, roster, grids,
    endCfm: { 6105264: 35, 6953852: 50, 13760867: 65 },
  });
  expect(asserted.fan.flowCfm).toBe(150);
  // The intake (damper to the capped plenum) at 150 cfm: W0-A's independent sum was 0.006478.
  expect(asserted.totals.return.knownInWg).toBeCloseTo(0.006478, 6);
  expect(asserted.totals.requiredEspInWg).toBeNull();
});
