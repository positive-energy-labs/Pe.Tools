import { expect, it } from "vite-plus/test";
import * as inputs from "./inputs.ts";
import { catalogLoss, catalogSchema, catalogTableSchema, type Catalogs } from "../catalog.ts";
import { ductCatalogReadingSchema } from "@pe/agent-contracts";
import { TEST_FIRM, TEST_SLOTS } from "../test-inputs.ts";

const { resolveInputs } = inputs;
const uid = "6d52156a-3876-4d76-b641-341454252f26-00000001";
const terminal = (drop: object = { catalogDropInWg: 0.5 }, facts: object[] = [{ key: "flow", value: 200 }]) => ({
  uniqueId: uid, id: 1, kind: "terminal", flowParameter: "PE_M_Grd_AirFlow", facts, connectors: [], terminalDrop: drop,
});
const unit = { uniqueId: uid.replace(/1$/, "2"), id: 2, kind: "equipment", family: "F", type: "T", name: "RTU", facts: [{ key: "fanFlow", value: 900 }], connectors: [{}, {}, {}] };
const snapshotOf = (node: object, slots: object = { ...TEST_SLOTS, terminalFlow: "PE_M_Grd_AirFlow", terminalDrop: "PE_Drop", fanFlow: "Design Flow" }, store?: object) =>
  ({ nodes: [node, unit], segments: [], slots, store }) as never;
const store = { terminalFlows: { "1": { cfm: 150, parameter: "PE_M_Grd_AirFlow" } }, terminals: { "1": { inWg: 0.2 } }, equipmentFlows: { "2": { cfm: 800, parameter: "Design Flow" } } };
const drift = (snapshot: never, segment: string, id: number): string | null =>
  (inputs as unknown as { receiptDrift: (s: never, segment: string, id: number) => string | null }).receiptDrift(snapshot, segment, id);

it("w4: the live Revit parameter is the value; a receipt that disagrees is drift, never a rung", () => {
  const snapshot = snapshotOf(terminal(), undefined, store);
  const r = resolveInputs({ snapshot, firm: TEST_FIRM });
  expect(r.terminals["1"]!.cfm).toMatchObject({ value: 200, source: "model", ref: "model:1/PE_M_Grd_AirFlow" });
  expect(r.terminals["1"]!.drop).toMatchObject({ value: 0.5, source: "model", ref: "model:1/PE_Drop" });
  expect(r.units["2"]!.cfm).toMatchObject({ value: 900, source: "model" });
  expect(drift(snapshot, "flows", 1)).toBe("Changed in Revit since Pe wrote 150 cfm");
  expect(drift(snapshot, "terminalDrops", 1)).toBe("Changed in Revit since Pe wrote 0.2 in-wg");
  expect(drift(snapshot, "equipmentFlows", 2)).toBe("Changed in Revit since Pe wrote 800 cfm");
  // An agreeing receipt and an element Pe never wrote are silent.
  expect(drift(snapshotOf(terminal(), undefined, { terminalFlows: { "1": { cfm: 200, parameter: "PE_M_Grd_AirFlow" } } }), "flows", 1)).toBeNull();
  expect(drift(snapshotOf(terminal()), "flows", 1)).toBeNull();
});

it("D3: a receipt whose parameter no longer reads is missing, never the stored number or the firm fallback", () => {
  const snapshot = snapshotOf(terminal({}, []), undefined, store);
  const r = resolveInputs({ snapshot, firm: TEST_FIRM }).terminals["1"]!;
  expect(r.cfm).toMatchObject({ status: "missing", value: null });
  expect(r.drop).toMatchObject({ status: "missing", value: null });
  expect(drift(snapshot, "flows", 1)).toBe("Pe wrote 150 cfm to PE_M_Grd_AirFlow, which no longer reads");
  expect(drift(snapshot, "terminalDrops", 1)).toBe("Pe wrote 0.2 in-wg to PE_Drop, which no longer reads");
  // Pe never wrote here: the firm criterion still serves.
  expect(resolveInputs({ snapshot: snapshotOf(terminal({}, [])), firm: TEST_FIRM }).terminals["1"]!.drop).toMatchObject({ status: "valid", source: "firm" });
});

it("a written zero is a value: the reader's 0 resolves 0 from the model with no drift, and an absent parameter is still missing", () => {
  // The reader's real shape: a parameter that reads 0 is a `0` fact; an absent one is a `null` fact or no drop.
  const zeros = { terminalFlows: { "1": { cfm: 0, parameter: "PE_M_Grd_AirFlow" } }, terminals: { "1": { inWg: 0 } }, equipmentFlows: { "2": { cfm: 0, parameter: "Design Flow" } } };
  const zeroUnit = { ...unit, facts: [{ key: "fanFlow", value: 0 }] };
  const read = { nodes: [terminal({ catalogDropInWg: 0 }, [{ key: "flow", value: 0 }]), zeroUnit], segments: [], slots: { ...TEST_SLOTS, terminalFlow: "PE_M_Grd_AirFlow", terminalDrop: "PE_Drop", fanFlow: "Design Flow" }, store: zeros } as never;
  const r = resolveInputs({ snapshot: read, firm: TEST_FIRM });
  for (const value of [r.terminals["1"]!.cfm, r.terminals["1"]!.drop, r.units["2"]!.cfm])
    expect(value).toMatchObject({ status: "valid", value: 0, source: "model" });
  for (const [segment, id] of [["flows", 1], ["terminalDrops", 1], ["equipmentFlows", 2]] as const)
    expect(drift(read, segment, id)).toBeNull();
  // Pe never wrote: the same zeros state nothing, so the flow is missing and the firm criterion serves the drop.
  const unwritten = resolveInputs({ snapshot: { ...(read as object), store: undefined } as never, firm: TEST_FIRM });
  expect(unwritten.terminals["1"]!.cfm.status).toBe("missing");
  expect(unwritten.terminals["1"]!.drop).toMatchObject({ source: "firm" });
  // The parameter is gone (a null fact, a null drop): missing, and the note says so.
  const absent = { ...(read as object), nodes: [terminal({ catalogDropInWg: null }, [{ key: "flow", value: null }]), zeroUnit] } as never;
  const gone = resolveInputs({ snapshot: absent, firm: TEST_FIRM }).terminals["1"]!;
  expect(gone.cfm.status).toBe("missing");
  expect(gone.drop.status).toBe("missing");
  expect(drift(absent, "terminalDrops", 1)).toBe("Pe wrote 0 in-wg to PE_Drop, which no longer reads");
});

it.each([undefined, "Old Airflow"])("ignores a terminal and unit receipt whose parameter is %s", parameter => {
  const slots = { ...TEST_SLOTS, terminalFlow: "PE_M_Grd_AirFlow", fanFlow: "Design Flow" };
  const read = {
    nodes: [terminal({}, [{ key: "flow", value: 0 }]), { ...unit, facts: [{ key: "fanFlow", value: 0 }] }],
    segments: [],
    slots,
    store: { slots, terminalFlows: { "1": { cfm: 150, parameter } }, equipmentFlows: { "2": { cfm: 800, parameter } } },
  } as never;
  const r = resolveInputs({ snapshot: read, firm: TEST_FIRM });
  expect(r.terminals["1"]!.cfm).toMatchObject({ status: "missing", value: null });
  expect(r.units["2"]!.cfm).toMatchObject({ status: "missing", value: null });
  expect(drift(read, "flows", 1)).toBeNull();
  expect(drift(read, "equipmentFlows", 2)).toBeNull();
});

it("compares Revit Flow receipts at the connector's three-place precision", () => {
  const node = { ...terminal(), flowParameter: "revit:Flow", connectors: [{ flowCfm: 150.123 }] };
  const slots = { ...TEST_SLOTS, terminalFlow: "revit:Flow" };
  const receipt = (cfm: number) => ({ terminalFlows: { "1": { cfm, parameter: slots.terminalFlow } } });
  expect(drift(snapshotOf(node, slots, receipt(150.1234)), "flows", 1)).toBeNull();
  expect(drift(snapshotOf(node, slots, receipt(150.1236)), "flows", 1)).toBe("Changed in Revit since Pe wrote 150.1236 cfm");
});

it("a receipt agrees with its parameter as the reader rounds it (4 places): no drift on an untouched model", () => {
  const wrote = { terminals: { "1": { inWg: 0.07312 } } };
  expect(drift(snapshotOf(terminal({ catalogDropInWg: 0.0731 }), undefined, wrote), "terminalDrops", 1)).toBeNull();
  expect(drift(snapshotOf(terminal({ catalogDropInWg: 0.0733 }), undefined, wrote), "terminalDrops", 1)).toBe("Changed in Revit since Pe wrote 0.07312 in-wg");
});

it("the connector's assigned drop is not a rung: the applier never writes it under a named slot", () => {
  const snapshot = snapshotOf(terminal({ assignedPressureDropInWg: 0.07 }));
  expect(resolveInputs({ snapshot, firm: TEST_FIRM }).terminals["1"]!.drop).toMatchObject({ source: "firm" });
});

const axis = { quantity: "flow", unit: "cfm", values: [0, 1000], input: { field: "flowCfm", scale: 1 } };
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
    const catalogs: Catalogs = { t: catalogTableSchema.parse(table(tier)) };
    const loss = catalogLoss(node as never, 200, catalogs);
    expect(loss, JSON.stringify(loss)).toMatchObject({ dp: 0.3, tier });
    expect(resolveInputs({ snapshot, firm: TEST_FIRM, catalogs }).terminals["1"]!.drop)
      .toMatchObject({ value: 0.3, source: tier, ref: `${tier}:1/t` });
    // A parameter Pe has written outranks the lookup, agreeing or not.
    expect(resolveInputs({ snapshot: snapshotOf(node, undefined, store), firm: TEST_FIRM, catalogs }).terminals["1"]!.drop)
      .toMatchObject({ value: 0.5, source: "model" });
  }
});

it("P25: a written terminal next to a homeless table prices the parameter and does not look the table up", () => {
  const node = { ...terminal(), facts: [{ key: "flow", value: 200 }, { key: "Pe_Catalog", text: "t" }], connectors: [{ kind: "end", shape: "round", diameterIn: 8 }] };
  const { home: _home, ...homeless } = table("firm");
  // @ts-expect-error a homeless table is no Catalogs entry
  const priced = resolveInputs({ snapshot: snapshotOf(node, undefined, store), firm: TEST_FIRM, catalogs: { t: homeless } });
  expect(priced.terminals["1"]!.drop).toMatchObject({ value: 0.5, source: "model" });
  // The table shape pricing consumes requires its home: a recorded table from before V5 no longer decodes.
  expect(catalogTableSchema.safeParse(homeless).success).toBe(false);
  expect(catalogTableSchema.safeParse(table("firm")).success).toBe(true);
  // A catalog file states no home; the host's reader stamps it.
  expect(catalogSchema.safeParse({ version: 1, tables: [homeless] }).success).toBe(true);
  expect(catalogSchema.safeParse({ version: 1, tables: [table("firm")] }).success).toBe(false);
});

it("S5: a catalog reading requires the reader-stamped home on every table", () => {
  const { home: _home, ...homeless } = table("firm");
  expect(ductCatalogReadingSchema.safeParse({ tables: { t: homeless }, findings: [] }).success).toBe(false);
  expect(ductCatalogReadingSchema.safeParse({ tables: { t: table("firm") }, findings: [] }).success).toBe(true);
  for (const home of [{ tier: "model", file: "catalog.json" }, { tier: "firm", file: "" }, { tier: "firm", file: "catalog.json", extra: true }])
    expect(ductCatalogReadingSchema.safeParse({ tables: { t: { ...table("firm"), home } }, findings: [] }).success).toBe(false);
});
