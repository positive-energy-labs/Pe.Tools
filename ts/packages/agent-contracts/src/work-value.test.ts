import { expect, it } from "vite-plus/test";
import { resolveValue, VALUE_SOURCES, type ValueLayers } from "./work-value.ts";
it("resolves each layer in order and preserves units and the winning revision", () => {
  const layers: ValueLayers<number> = Object.fromEntries(
    VALUE_SOURCES.map((source, i) => [source, { value: i, version: i + 10 }]),
  );
  for (const [i, source] of VALUE_SOURCES.entries()) {
    expect(resolveValue(layers, "cfm")).toEqual({
      value: i,
      source,
      units: "cfm",
      version: i + 10,
      status: "valid",
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
  expect(resolveValue({ Work: { value: NaN }, firm: { value: 10 } })).toMatchObject({
    value: null,
    source: "Work",
    status: "invalid",
  });
  expect(
    resolveValue({ run: { value: null }, Work: { value: 0 }, default: { value: 10 } }),
  ).toMatchObject({ value: 0, source: "Work", status: "valid" });
});
