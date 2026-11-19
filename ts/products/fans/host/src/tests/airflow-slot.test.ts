import { expect, test } from "vite-plus/test";
import { terminalFlowSlot } from "@pe/ducts-host/ducts-inputs";
import { receiptDrift, resolveInputs } from "@pe/ducts-domain/calc/inputs";
import { TEST_FIRM } from "@pe/ducts-domain/test-inputs";
import { factOf, storeOf } from "@pe/ducts-domain/test-snapshot";
import { buildCalc } from "@pe/fans-domain/calc/build";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import { type SettingTierRead } from "@pe/agent-contracts";
import { closedFan, recordedTables } from "./closed-fan.fixture.ts";
import { nativeFixture } from "./fans-work-fixture.ts";
import { evaluate } from "@pe/host/reads/evaluator";
import { fanRoster, fanInputs } from "../fan-calc.ts";
import { calcPort } from "@pe/ducts-host/tests/ducts-read.fixture";
import { settle, testDuctFiles } from "../../../../../apps/host/tests/effect-test.ts";
const named = "PE_M_Grd_AirFlow";
const model = (slot = named) => {
  const s = closedFan(100);
  return { ...s, slots: { ...s.slots, terminalFlow: slot }, nodes: s.nodes.map(n => n.kind !== "terminal" ? n : {
    ...n, flowParameter: slot, facts: n.facts.filter(f => f.key !== "flow"),
  }) };
};
const settings = (tier: "project" | "firm"): SettingTierRead[] => [{ tier, home: "fixture", name: "fixture", path: "fixture", sha256: null, json: { parameters: { terminalFlow: named } } }];
test("empty named default chooses one Revit Flow slot by coverage and prices the terminal", async () => {
  const s = model(), zero = terminalFlowSlot([], { ...s, nodes: s.nodes.map(n => ({ ...n, connectors: [], facts: [factOf("flow", 0)] })) });
  expect(zero.slots.terminalFlow).toBe(named);
  expect(zero.coverage.map(c => c.covered)).toEqual([0, 0]);
  const flow = terminalFlowSlot([], model());
  const pinned = terminalFlowSlot([], { ...model("revit:Flow"), nodes: s.nodes.map(n => ({ ...n, flowParameter: "revit:Flow", connectors: n.id === 3 ? [] : n.connectors, facts: [factOf(`slot:${named}`, 100)] })) });
  expect(pinned.slots.terminalFlow).toBe(named);
  expect(pinned.coverage).toEqual([{ slot: named, covered: 2, total: 2 }, { slot: "revit:Flow", covered: 1, total: 2 }]);
  expect(flow.slots.terminalFlow).toBe("revit:Flow");
  const snapshot = model(flow.slots.terminalFlow);
  const inputs = resolveInputs({ snapshot, firm: TEST_FIRM, ...flow });
  expect(inputs.terminals[3]?.cfm).toMatchObject({ value: 200, ref: expect.stringContaining("default · revit:Flow chosen by coverage 2/2") });
  const withReceipt = {
    ...snapshot,
    store: storeOf({
      ...snapshot.store,
      terminalFlows: { "3": { cfm: 150, parameter: "revit:Flow", appliedAt: "2026-11-19T00:00:00Z" } },
    }),
  };
  expect(resolveInputs({ snapshot: withReceipt, firm: TEST_FIRM, ...flow }).terminals[3]?.cfm)
    .toMatchObject({ value: 200, source: "model", ref: expect.stringContaining("default · revit:Flow chosen by coverage 2/2") });
  expect(receiptDrift(withReceipt, "flows", 3)).toBe("Changed in Revit since Pe wrote 150 cfm");
  const roster = suggestRoster(snapshot);
  const sheet = buildCalc({ snapshot, inputs, ...flow, fan: { unitId: 100, portIndex: 0 }, roster: [...roster.fans, ...roster.suggestions], grids: toGrids(recordedTables()) });
  expect(sheet.blockers.filter(b => b.kind === "no-flow")).toEqual([]);
});
test.each(["project", "firm"] as const)("%s named slot never reads Revit Flow and each uncovered terminal names the better choice", async tier => {
  const f = await nativeFixture("real", (_key, input) => model(input.slots?.terminalFlow), null, { native: key => key === "ducts.tables" ? recordedTables() : undefined });
  try {
    const sheet = (await evaluate(fanInputs, { target: f.target.ref, mode: "fan", unitId: 100, portIndex: 0 }, calcPort({
      firm: owner => settle(testDuctFiles().firm(owner)), catalogs: () => settle(testDuctFiles().catalogsFor(undefined)),
      workKey: async () => f.key, call: f.readDucts,
    }, f.saved, settings(tier)))).data;
    expect(Object.values(sheet.inputs.terminals).map(t => t.cfm.value)).toEqual([null, null]);
    const blockers = sheet.blockers.filter(b => b.kind === "no-flow");
    expect(blockers).toHaveLength(2);
    expect(blockers.every(b => b.closer.note === `0/2 terminals have ${named}; Revit Flow covers 2. Save terminalFlow = Revit Flow at project`)).toBe(true);
  } finally { await f.close(); }
});
test("read and sealed apply request carry the same coverage-chosen slot", async () => {
  const f = await nativeFixture("real", (_key, input) => model(input.slots?.terminalFlow), null, { native: key => key === "ducts.tables" ? recordedTables() : undefined });
  try {
    const roster = (await evaluate(fanRoster, { target: f.target.ref }, calcPort({
      firm: owner => settle(testDuctFiles().firm(owner)), catalogs: () => settle(testDuctFiles().catalogsFor(undefined)),
      workKey: async () => f.key, call: f.readDucts,
    }, f.saved))).data;
    expect(roster.activeSlot).toBe("revit:Flow");
    const key = { ...f.key, route: "fans" };
    const staged = await f.saved.apply(key, "fans", "human", [{ path: ["writeIntent", "edit"], value: { value: { walk: { unitId: 100, portIndex: 0 } } } }], 0);
    if (!staged.ok) throw Error(JSON.stringify(staged));
    await f.post("/actions", { id: "airflow-plan", key: "sheet.plan", target: f.target, input: { work: { key, revision: staged.revision } } });
    const receipt = await f.journal.wait("airflow-plan");
    expect(receipt, JSON.stringify(receipt)).toMatchObject({ state: "succeeded", result: { derivedRequest: { slots: { terminalFlow: roster.activeSlot } } } });
    await f.post("/actions", { id: "airflow-apply", key: "sheet.apply", target: f.target, input: { work: { key, revision: staged.revision } } });
    const applied = await f.journal.wait("airflow-apply");
    expect(applied, JSON.stringify(applied)).toMatchObject({ state: "succeeded", result: { derivedRequest: { slots: { terminalFlow: roster.activeSlot } } } });
  } finally { await f.close(); }
});
