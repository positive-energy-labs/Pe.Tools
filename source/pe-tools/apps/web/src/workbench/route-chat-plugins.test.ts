import { expect, test } from "vite-plus/test";
import { selectRouteChatPlugin } from "./route-chat-plugins.tsx";

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
