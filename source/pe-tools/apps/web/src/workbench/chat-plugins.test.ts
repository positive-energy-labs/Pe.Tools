import { expect, test } from "vite-plus/test";

import { CHAT_PLUGIN_ROUTES, chatPluginTitle, proposedRecord } from "./chat-plugins";

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
