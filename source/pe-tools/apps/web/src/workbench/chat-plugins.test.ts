import { expect, test } from "vite-plus/test";

import {
  CHAT_PLUGIN_ROUTES,
  actionCall,
  actionRoute,
  actionWord,
  chatPluginTitle,
  proposedRecord,
} from "./chat-plugins";

const ok = { ok: true, revision: 12, target: { session: "B", document: "C:/MEP.rvt" } };
const patches = [{ path: ["cells", "a"] }, { path: ["cells", "b"] }, { path: ["cells", "c"] }];

test("a landed propose leaves one record: its own patch count and recorded subject", () => {
  expect(
    proposedRecord("pe_do", { key: "route:families.propose", input: { patches } }, ok),
  ).toEqual({ route: "families", changes: 3, subject: "C:/MEP.rvt" });
  // The pea tools may carry input as JSON text, and a result as MCP structured content.
  expect(
    proposedRecord(
      "pe_do",
      { key: "route:pods.propose", input: JSON.stringify({ patches }), workspaceId: "pod|a.json" },
      { structuredContent: { ...ok, target: { session: null, document: null } } },
    ),
  ).toEqual({ route: "pods", changes: 3, subject: "pod|a.json" });
});

test("reads, refusals, commands and unhosted routes leave no proposed record", () => {
  const args = { key: "route:families.propose", input: { patches } };
  expect(proposedRecord("pe_do", args, { ...ok, ok: false })).toBeNull();
  expect(proposedRecord("pe_do", args, undefined)).toBeNull();
  expect(proposedRecord("pe_read", { key: "route:families" }, ok)).toBeNull();
  expect(proposedRecord("pe_do", { key: "route:families.plan" }, ok)).toBeNull();
  expect(
    proposedRecord("pe_do", { key: "route:other.propose", input: { patches } }, ok),
  ).toBeNull();
  expect(proposedRecord("pe_find", { query: "families" }, ok)).toBeNull();
});

test("every hosted route has a title", () => {
  for (const route of CHAT_PLUGIN_ROUTES) expect(chatPluginTitle(route)).toBeTruthy();
});

test("the count is distinct cells and fields, not patches", () => {
  const input = {
    patches: [
      // Two rungs of one cell's proposal are one change.
      { path: ["cells", "Neck Width|3101|A", "proposal", "value"], value: "10in" },
      { path: ["cells", "Neck Width|3101|A", "proposal", "note"], value: "match B" },
      { path: ["cells", "Neck Width|3101|B", "proposal"], value: { value: "10in" } },
      // A whole-subtree proposal on one field pointer, twice.
      { path: ["fields", "/parameters/0", "proposal"], value: { value: 1 } },
      { path: ["fields", "/parameters/0", "proposal", "confidence"], value: "low" },
    ],
  };
  expect(proposedRecord("pe_do", { key: "route:families.propose", input }, ok)?.changes).toBe(3);
});

test("an action call names its receipt; its route is the action's entity", () => {
  expect(
    actionCall("pe_do", { key: "workflow:takeoffs.sync" }, { result: { id: "run-1" } }),
  ).toEqual({ id: "run-1", key: "takeoffs.sync" });
  // A control names the original receipt in its input.
  expect(actionCall("pe_do", { key: "op:action.resume", input: { id: "run-1" } }, {})).toEqual({
    id: "run-1",
    key: "action.resume",
  });
  expect(actionCall("pe_do", { key: "op:revit.context.summary" }, { id: "op-9" })).toEqual({
    id: "op-9",
    key: "revit.context.summary",
  });
  expect(actionCall("pe_do", { key: "route:families.propose" }, { id: "x" })).toBeNull();
  expect(actionCall("pe_read", { key: "workflow:takeoffs.sync" }, { id: "x" })).toBeNull();
  expect(actionCall("pe_do", { key: "workflow:takeoffs.sync" }, {})).toBeNull();

  expect(actionRoute("schedule.grid.push")).toBe("schedules");
  expect(actionRoute("settings.write")).toBe("pods");
  expect(actionRoute("families.apply")).toBe("families");
  expect(actionRoute("revit.context.summary")).toBeNull();
  expect(actionRoute("action.resume")).toBeNull();
  expect(actionWord("schedule.grid.push")).toBe("grid push");
});

test("F-H6-5: a scope proposal is a change (a root cell, like cells and fields)", () => {
  const input = {
    patches: [
      { path: ["scope", "proposal"], value: { value: { familyNames: ["LBP15A"] } } },
      { path: ["scope", "proposal", "note"], value: "the three Price LBP15A families" },
      { path: ["cells", '["LBP15A","A","View Description"]', "proposal"], value: { value: "X" } },
    ],
  };
  expect(proposedRecord("pe_do", { key: "route:families.propose", input }, ok)?.changes).toBe(2);
});
