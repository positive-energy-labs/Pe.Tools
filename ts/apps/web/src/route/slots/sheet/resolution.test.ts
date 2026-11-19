import { expect, test } from "vite-plus/test";
import { DUCTS_DEFAULT_CRITERIA, DUCTS_CRITERIA_CELLS } from "@pe/agent-contracts";
import { resolveCriteria } from "@pe/ducts-domain/calc/inputs";
import { designCalc } from "@pe/duct-systems-web/design-calc";
import { fansCalc } from "@pe/fans-web/calc";
import { settingsSheet } from "../../../settings/route.ts";
import { sheetCells } from "./index.ts";
import { readFileSync } from "node:fs";
import { ductsNetworkData, ductParameterSlots, ductSlotRequest } from "@pe/agent-contracts";
import { DUCT_UNIT_KINDS, FAN_BLOCKER_KINDS } from "@pe/host-contracts/generated";

const settings = { ducts: [{ tier: "firm" as const, home: "firm", name: "Firm", path: "Settings/ducts.json", sha256: "hash", json: { criteria: { autoJoinGapIn: 5 } } }] };
const criteria = resolveCriteria({ criteria: { autoJoinGapIn: 9 }, criteriaMeta: { autoJoinGapIn: { by: "human", ref: "work:criterion" } } }, { version: "test", criteria: { ...DUCTS_DEFAULT_CRITERIA, autoJoinGapIn: 5 } });
const cells = (slot: Parameters<typeof sheetCells>[0], read: unknown) => sheetCells(slot, { rows: [], work: {}, read });
const fanSettings = { bindings: Object.fromEntries(Object.entries(fansCalc.bindings).filter(([name]) => name.startsWith("setting."))) };

test("P27: a slot name and its tier come from one resolution", () => {
  expect(ductParameterSlots(settings.ducts)).toMatchObject({ fanFlow: { name: null, source: "default" } });
  expect(ductParameterSlots([{ ...settings.ducts[0], json: { parameters: { fanFlow: "Firm_Flow" } } }])).toMatchObject({ fanFlow: { name: "Firm_Flow", source: "firm", ref: "Firm" } });
});

test("V3: setting-home cells draw the resolution pricing used, including Work", () => {
  const row = cells(fanSettings, { settings, calcView: { inputs: { criteria } }, calcSnapshot: { kind: "absent" } }).find(c => c.binding === "setting.ducts.autoJoinGapIn");
  expect(row).toMatchObject({ value: criteria.autoJoinGapIn.value, source: "work" });
  expect(row?.setting?.tiers).toContainEqual({ tier: "firm", home: "firm", sha256: "hash" });
});

test("V3: duct-systems draws exactly one row per criterion with the priced value and source", () => {
  const rows = cells(designCalc, { settings, criteria });
  for (const cell of Object.keys(DUCTS_CRITERIA_CELLS)) {
    expect(rows.filter(row => row.binding === `criteria.${cell}` || row.binding === `setting.ducts.${cell}`)).toHaveLength(1);
  }
  expect(rows.find(row => row.binding === "criteria.autoJoinGapIn")).toMatchObject({ value: 9, source: "work" });
});

test.each(["default", "firm"])("V3: both product slot rows draw the name in use and its %s source", source => {
  const name = source === "firm" ? "Firm_Flow" : "PE_M_Fan_AirFlow";
  const tiers = source === "firm" ? { ducts: [{ ...settings.ducts[0], json: { parameters: { fanFlow: name } } }] } : settings;
  for (const [slot, read] of [
    [designCalc, { settings: tiers, criteria, network: { slots: { fanFlow: name }, slotSources: ductParameterSlots(tiers.ducts) } }],
    [fanSettings, { settings: tiers, calcView: { inputs: { criteria } }, calcSnapshot: { slots: { fanFlow: name }, slotSources: ductParameterSlots(tiers.ducts), nodes: [], segments: [] } }],
  ] as const) expect(cells(slot, read).find(row => row.binding === "setting.ducts.parameters.fanFlow")).toMatchObject({ value: name, source });
});

test("V3: Settings resolves its own tiers and an unnamed slot reads default", () => {
  const rows = cells(settingsSheet, { settings });
  expect(rows.find(row => row.binding === "setting.ducts.autoJoinGapIn")).toMatchObject({ value: 5, source: "firm" });
  expect(rows.find(row => row.binding === "setting.ducts.parameters.fanFlow")).toMatchObject({ value: null, source: "default" });
});

test("P23: initial slot requests name only served slots and all consumers use the shared selection", () => {
  const name = "Firm_Flow";
  const tiers = { ducts: [{ ...settings.ducts[0], json: { parameters: { fanFlow: "Firm_Flow" } } }] };
  expect(ductParameterSlots(tiers.ducts)).toMatchObject({ fanFlow: { name, source: "firm" } });
  expect(ductSlotRequest(tiers.ducts)).toEqual({ fanFlow: name });
  expect(ductSlotRequest()).toEqual({});
  expect(Object.values(ductParameterSlots()).every(slot => slot.name === null && slot.source === "default")).toBe(true);
  for (const [file, pattern, count] of [
    ["duct-systems/host/src/host.ts", /ctx\.read\(ductsInputs, target\)/g, 2],
    ["fans/host/src/host.ts", /ctx\.read\(ductsInputs, args.target\)/g, 1],
    ["fans/host/src/fan-calc.ts", /ctx\.read\(ductsInputs, (request.target|target)\)/g, 2],
    ["ducts/host/src/action-runtime.ts", /await acquireSnapshotInputs\(settings,/g, 1],
    ["ducts/host/src/ducts-inputs.ts", /await read\(ductSlotRequest\(settings\)\)/g, 1],
  ] as const) {
    const source = readFileSync(new URL(`../../../../../../products/${file}`, import.meta.url), "utf8");
    expect([...source.matchAll(pattern)], file).toHaveLength(count);
  }
  const snapshot = { slots: { fanFlow: name }, slotSources: ductParameterSlots(tiers.ducts), nodes: [], segments: [] };
  for (const [slot, read] of [
    [designCalc, { settings: tiers, criteria, network: snapshot }],
    [fanSettings, { settings: tiers, calcView: { inputs: { criteria } }, calcSnapshot: snapshot }],
  ] as const) expect(cells(slot, read).find(row => row.binding === "setting.ducts.parameters.fanFlow")).toMatchObject({ value: name, source: "firm" });
});

test("P15: duct-systems slot rows use the decoded recorded walk shape", () => {
  const recording = JSON.parse(readFileSync(new URL("../../../../../../products/ducts/host/src/tests/native-recordings/driver-ducts.snapshot.walk.json", import.meta.url), "utf8"));
  const network = ductsNetworkData.parse({ ...recording, vocabulary: { unitKinds: DUCT_UNIT_KINDS, blockerKinds: FAN_BLOCKER_KINDS }, sourceVersion: "recording", systemReads: { completed: [], missing: [] } });
  expect(network.slots.fanFlow).toBe("PE_M_Fan_AirFlowDesign");
  expect(cells(designCalc, { network }).find(row => row.binding === "setting.ducts.parameters.fanFlow")).toMatchObject({ value: network.slots.fanFlow, source: "default" });
});
