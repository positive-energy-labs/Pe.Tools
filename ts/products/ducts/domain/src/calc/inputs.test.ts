import { expect, it } from "vite-plus/test";
import * as inputs from "./inputs.ts";
import { catalogLoss, type Catalogs } from "../catalog.ts";
import { TEST_FIRM } from "../test-inputs.ts";

const { resolveInputs } = inputs;
const uid = "6d52156a-3876-4d76-b641-341454252f26-00000001";
const terminal = (drop: object = { catalogDropInWg: 0.5 }, facts: object[] = [{ key: "flow", value: 200 }]) => ({
  uniqueId: uid, id: 1, kind: "terminal", flowParameter: "PE_M_Grd_AirFlow", facts, connectors: [], terminalDrop: drop,
});
const unit = { uniqueId: uid.replace(/1$/, "2"), id: 2, kind: "equipment", family: "F", type: "T", name: "RTU", facts: [{ key: "fanFlow", value: 900 }], connectors: [{}, {}, {}] };
const snapshotOf = (node: object, slots: object = { terminalFlow: "PE_M_Grd_AirFlow", terminalDrop: "PE_Drop" }, store?: object) =>
  ({ nodes: [node, unit], segments: [], slots, store }) as never;
const store = { terminalFlows: { "1": { cfm: 150 } }, terminals: { "1": { inWg: 0.2 } }, equipmentFlows: { "2": { cfm: 800 } } };
const drift = (snapshot: never, segment: string, id: number): string | null =>
  (inputs as unknown as { receiptDrift: (s: never, segment: string, id: number) => string | null }).receiptDrift(snapshot, segment, id);

it("w4: the live Revit parameter is the value; a receipt that disagrees is drift, never a rung", () => {
  const snapshot = snapshotOf(terminal(), undefined, store);
  const r = resolveInputs({ snapshot, firm: TEST_FIRM, store });
  expect(r.terminals["1"]!.cfm).toMatchObject({ value: 200, source: "model", ref: "model:1/PE_M_Grd_AirFlow" });
  expect(r.terminals["1"]!.drop).toMatchObject({ value: 0.5, source: "model", ref: "model:1/PE_Drop" });
  expect(r.units["2"]!.cfm).toMatchObject({ value: 900, source: "model" });
  expect(drift(snapshot, "flows", 1)).toBe("Changed in Revit since Pe wrote 150 cfm");
  expect(drift(snapshot, "terminalDrops", 1)).toBe("Changed in Revit since Pe wrote 0.2 in-wg");
  expect(drift(snapshot, "equipmentFlows", 2)).toBe("Changed in Revit since Pe wrote 800 cfm");
  // An agreeing receipt and an element Pe never wrote are silent.
  expect(drift(snapshotOf(terminal(), undefined, { terminalFlows: { "1": { cfm: 200 } } }), "flows", 1)).toBeNull();
  expect(drift(snapshotOf(terminal()), "flows", 1)).toBeNull();
});

it("D3: a receipt whose parameter no longer reads is missing, never the stored number or the firm fallback", () => {
  const snapshot = snapshotOf(terminal({}, []), undefined, store);
  const r = resolveInputs({ snapshot, firm: TEST_FIRM, store }).terminals["1"]!;
  expect(r.cfm).toMatchObject({ status: "missing", value: null });
  expect(r.drop).toMatchObject({ status: "missing", value: null });
  expect(drift(snapshot, "flows", 1)).toBe("Pe wrote 150 cfm to PE_M_Grd_AirFlow, which no longer reads");
  expect(drift(snapshot, "terminalDrops", 1)).toBe("Pe wrote 0.2 in-wg to PE_Drop, which no longer reads");
  // Pe never wrote here: the firm criterion still serves.
  expect(resolveInputs({ snapshot, firm: TEST_FIRM }).terminals["1"]!.drop).toMatchObject({ status: "valid", source: "firm" });
});

it("with no TerminalDrop slot named the model rung reads the connector's assigned drop, where Pe writes it", () => {
  const snapshot = snapshotOf(terminal({ assignedPressureDropInWg: 0.07 }), { terminalFlow: "PE_M_Grd_AirFlow" });
  expect(resolveInputs({ snapshot, firm: TEST_FIRM }).terminals["1"]!.drop)
    .toMatchObject({ value: 0.07, source: "model", ref: "model:1/AssignedPressureDrop" });
});

const axis = { quantity: "flow", unit: "cfm", values: [0, 1000], input: { field: "flowCfm" } };
const table = (tier: string) => ({
  id: "t", title: "t", home: { tier, file: `${tier}/Catalogs/t/catalog.json` },
  source: { file: "f.pdf", title: "F", edition: "1", url: "https://example.com", page: 1, pdfPage: 1 },
  rows: axis, columns: axis, cells: { quantity: "pressure", unit: "in-wg", values: [[0.3, 0.3], [0.3, 0.3]] },
  result: { from: "cells", quantity: "total-pressure", unit: "in-wg", toInWg: 1, velocityBasis: "connector", note: "fixture" },
});
it("V5/D2: the catalog's rung is its home's tier, above the parameter until Pe has written the parameter", () => {
  const node = { ...terminal(), facts: [{ key: "flow", value: 200 }, { key: "Pe_Catalog", text: "t" }], connectors: [{ kind: "end", shape: "round", diameterIn: 8 }] };
  const snapshot = snapshotOf(node);
  for (const tier of ["user", "project", "firm"]) {
    const catalogs = { t: table(tier) } as unknown as Catalogs;
    expect(catalogLoss(node as never, 200, catalogs)).toMatchObject({ dp: 0.3, tier });
    expect(resolveInputs({ snapshot, firm: TEST_FIRM, catalogs }).terminals["1"]!.drop)
      .toMatchObject({ value: 0.3, source: tier, ref: `${tier}:1/t` });
    // A parameter Pe has written outranks the lookup, agreeing or not.
    expect(resolveInputs({ snapshot, firm: TEST_FIRM, catalogs, store: { terminals: { "1": { inWg: 0.2 } } } }).terminals["1"]!.drop)
      .toMatchObject({ value: 0.5, source: "model" });
  }
});
