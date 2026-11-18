import { expect, test } from "vite-plus/test";
import { DUCTS_DEFAULT_CRITERIA, DUCTS_CRITERIA_CELLS } from "@pe/agent-contracts";
import { resolveCriteria } from "@pe/ducts-domain/calc/inputs";
import { designCalc } from "@pe/duct-systems-web/design-calc";
import { fansCalc } from "@pe/fans-web/calc";
import { settingsSheet } from "../../../settings/route.ts";
import { sheetCells } from "./index.ts";

const settings = { ducts: [{ tier: "firm", home: "firm", name: "Firm", path: "Settings/ducts.json", sha256: "hash", json: { criteria: { autoJoinGapIn: 5 } } }] };
const criteria = resolveCriteria({ criteria: { autoJoinGapIn: 9 }, criteriaMeta: { autoJoinGapIn: { by: "human", ref: "work:criterion" } } }, null, { version: "test", criteria: { ...DUCTS_DEFAULT_CRITERIA, autoJoinGapIn: 5 } });
const cells = (slot: Parameters<typeof sheetCells>[0], read: unknown) => sheetCells(slot, { rows: [], work: {}, model: [], read });
const fanSettings = { bindings: Object.fromEntries(Object.entries(fansCalc.bindings).filter(([name]) => name.startsWith("setting."))) };

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
    [designCalc, { settings: tiers, criteria, network: { slots: { fanFlow: name } } }],
    [fanSettings, { settings: tiers, calcView: { inputs: { criteria } }, calcSnapshot: { slots: { fanFlow: name }, nodes: [], segments: [] } }],
  ] as const) expect(cells(slot, read).find(row => row.binding === "setting.ducts.parameters.fanFlow")).toMatchObject({ value: name, source });
});

test("V3: Settings resolves its own tiers and an unnamed slot reads default", () => {
  const rows = cells(settingsSheet, { settings });
  expect(rows.find(row => row.binding === "setting.ducts.autoJoinGapIn")).toMatchObject({ value: 5, source: "firm" });
  expect(rows.find(row => row.binding === "setting.ducts.parameters.fanFlow")).toMatchObject({ value: null, source: "default" });
});
