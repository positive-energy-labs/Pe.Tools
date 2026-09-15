// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

// The live thread has moved on to document B. A completed card must not notice.
vi.mock("#/chat/scope", () => ({
  useThreadScope: () => ({
    hydrated: true,
    defaultTarget: { kind: "named", session: "pe.app-26", address: "C:/Live/B.rvt" },
    revision: 99,
  }),
}));
vi.mock("@tanstack/react-router", () => ({ Link: () => null }));

import { selectRouteChatPlugin } from "./route-chat-plugins.tsx";

afterEach(cleanup);

test("route chat plugins select registered routes from pe_read and pe_do route keys", () => {
  for (const key of [
    "route:parameter-links",
    "route:parameter-links.propose",
    "route:parameter-links.preview",
  ]) {
    expect(selectRouteChatPlugin("pe_do", { key })?.spec.route).toBe("parameter-links");
  }
  expect(selectRouteChatPlugin("pe_read", { key: "route:family-types" })).toBeNull();
  expect(selectRouteChatPlugin("pe_do", { key: "workflow:schedule-grid.apply" })?.spec.route).toBe(
    "schedule-grid",
  );
  expect(selectRouteChatPlugin("pe_read", { key: "op:schedule-grid.snapshot" })?.spec.route).toBe(
    "schedule-grid",
  );
  expect(selectRouteChatPlugin("pe_do", { key: "route:pods.run" })).toBeNull();
});

test("route chat plugins ignore unregistered routes, other tools, and non-route keys", () => {
  expect(selectRouteChatPlugin("pe_find", { query: "parameter-links" })).toBeNull();
  expect(selectRouteChatPlugin("pe_do", { key: "op:revit.context.summary" })).toBeNull();
  expect(selectRouteChatPlugin("pe_do", { key: "route:other" })).toBeNull();
  expect(selectRouteChatPlugin("pe_do", {})).toBeNull();
  expect(selectRouteChatPlugin("pe_do", null)).toBeNull();
});

test("Takeoffs semantic actions select the embedded workspace and keep original receipt identity", async () => {
  const { actionReceiptId } = await import("./route-chat-plugins/tool-names");
  expect(selectRouteChatPlugin("pe_do", { key: "workflow:takeoffs.sync" })?.spec.route).toBe(
    "takeoffs",
  );
  expect(selectRouteChatPlugin("pe_do", { key: "op:action.recover" })?.spec.route).toBe("takeoffs");
  expect(
    actionReceiptId(
      { input: { actionId: "intended" } },
      { result: { id: "admitted", state: "detached" } },
    ),
  ).toBe("admitted");
  expect(actionReceiptId({ input: { id: "original" } }, {})).toBe("original");
  expect(
    actionReceiptId(
      {},
      { result: { action: { id: "pod-original" }, response: { status: "partial" } } },
    ),
  ).toBe("pod-original");
  expect(actionReceiptId({}, { doc: { id: "active-work" } })).toBeUndefined();
});

test("a completed card shows the Target its turn recorded, never the live thread Target", async () => {
  const { ConnectedRouteChatPlugin, routeChatPlugins, recordedTarget } =
    await import("./route-chat-plugins/tool-names");
  // Exactly what the pea tool wrote for this call: capability-tools.ts returns
  // `{ ok, key, target: { session, document }, revision, result }`.
  const recorded = {
    ok: true,
    key: "route:parameter-links.preview",
    target: { session: null, document: "C:/Recorded/A.rvt" },
    revision: 7,
    result: { ok: true, revision: 7, doc: { draft: null } },
  };
  expect(recordedTarget(recorded)).toEqual({ target: "C:/Recorded/A.rvt", revision: 7 });

  render(
    createElement(ConnectedRouteChatPlugin, {
      registration: routeChatPlugins["parameter-links"],
      toolCallId: "call-1",
      toolName: "pe_do",
      args: { key: "route:parameter-links.preview" },
      sessionState: recorded,
      running: false,
      active: false,
    }),
  );

  expect(screen.getByTestId("plugin-target").textContent).toBe("C:/Recorded/A.rvt");
  expect(screen.getByTestId("plugin-revision").textContent).toBe("r7");
  expect(document.body.textContent).not.toContain("C:/Live/B.rvt");
  expect(document.body.textContent).not.toContain("r99");
});

test("a card whose result records no Target says so instead of borrowing the live one", async () => {
  const { ConnectedRouteChatPlugin, routeChatPlugins } =
    await import("./route-chat-plugins/tool-names");
  render(
    createElement(ConnectedRouteChatPlugin, {
      registration: routeChatPlugins["parameter-links"],
      toolCallId: "call-2",
      toolName: "pe_do",
      args: { key: "route:parameter-links.preview" },
      sessionState: { ok: true },
      running: false,
      active: false,
    }),
  );
  expect(screen.getByTestId("plugin-target").textContent).toBe("target not recorded");
  expect(screen.queryByTestId("plugin-revision")).toBeNull();
  expect(document.body.textContent).toContain("draft not recorded");
});
