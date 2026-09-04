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
  expect(selectRouteChatPlugin("pe_read", { key: "route:family-types" })?.spec.route).toBe(
    "family-types",
  );
  expect(selectRouteChatPlugin("pe_do", { key: "route:pods.run" })?.spec.route).toBe("pods");
});

test("route chat plugins ignore unregistered routes, other tools, and non-route keys", () => {
  expect(selectRouteChatPlugin("pe_find", { query: "parameter-links" })).toBeNull();
  expect(selectRouteChatPlugin("pe_do", { key: "op:revit.context.summary" })).toBeNull();
  expect(selectRouteChatPlugin("pe_do", { key: "route:other" })).toBeNull();
  expect(selectRouteChatPlugin("pe_do", {})).toBeNull();
  expect(selectRouteChatPlugin("pe_do", null)).toBeNull();
});
