import { expect, it } from "vite-plus/test";
import { resolveValue, VALUE_SOURCES, type ValueLayers } from "./work-value.ts";
it("unattributed Work blocks fallback and a present layer must cite evidence", () => {
  expect(resolveValue({ Work: { value: 1, author: "unknown", ref: "legacy:1" }, model: { value: 2, author: null, ref: "model:1" } }))
    .toMatchObject({ status: "invalid", value: null, source: "Work", author: "unknown", ref: "legacy:1" });
  expect(() => resolveValue({ model: { value: 1, author: null } })).toThrow("nonempty evidence ref");
});
it("resolves each layer in order and preserves units and the winning revision", () => {
  const layers: ValueLayers<number> = Object.fromEntries(
    VALUE_SOURCES.map((source, i) => [source, { value: i, version: i + 10, author: source === "run" || source === "Work" ? "human" : null, ref: `${source}:${i}` }]),
  );
  for (const [i, source] of VALUE_SOURCES.entries()) {
    expect(resolveValue(layers, "cfm")).toEqual({
      value: i,
      source,
      units: "cfm",
      version: i + 10,
      status: "valid",
      author: source === "run" || source === "Work" ? "human" : null,
      ref: `${source}:${i}`,
    });
    delete layers[source];
  }
  expect(resolveValue(layers, "cfm")).toMatchObject({
    value: null,
    source: "none",
    status: "missing",
  });
});
it("an invalid higher layer blocks fallback, while absent cells fall through", () => {
  expect(resolveValue({ Work: { value: NaN, author: "pea", ref: "Work:bad" }, firm: { value: 10, author: null, ref: "firm:1" } })).toMatchObject({
    value: null,
    source: "Work",
    status: "invalid",
  });
  expect(
    resolveValue({ run: { value: null, author: null }, Work: { value: 0, author: "human", ref: "Work:0" }, default: { value: 10, author: null, ref: "default:1" } }),
  ).toMatchObject({ value: 0, source: "Work", status: "valid" });
});
