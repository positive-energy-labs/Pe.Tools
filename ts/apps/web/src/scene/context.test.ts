import { expect, it } from "vite-plus/test";
import { contextVisible } from "./context";
import { LOOK } from "./grounds";

it("filters only context, preserving subjects and stubs in every preset", () => {
  for (const context of ["all", "walls", "structural", "none"] as const) {
    const layers = {
      ...LOOK.defaults.layers,
      context,
      lighting: false,
      hiddenCategories: ["Ducts"],
    };
    expect(contextVisible("Ducts", "subject", layers)).toBe(true);
    expect(contextVisible("Ducts", "stub", layers)).toBe(true);
    expect(contextVisible("Ducts", "context", layers)).toBe(false);
    expect(contextVisible("Lighting Fixtures", "context", layers)).toBe(false);
  }
  expect(contextVisible("Walls", "context", { ...LOOK.defaults.layers, context: "walls" })).toBe(
    true,
  );
  expect(
    contextVisible("Structural Framing", "context", { ...LOOK.defaults.layers, context: "walls" }),
  ).toBe(false);
  expect(
    contextVisible("Structural Framing", "context", {
      ...LOOK.defaults.layers,
      context: "structural",
    }),
  ).toBe(true);
  expect(contextVisible("Unknown localized category", "context", LOOK.defaults.layers)).toBe(true);
  expect(
    contextVisible("Unknown localized category", "context", {
      ...LOOK.defaults.layers,
      context: "structural",
    }),
  ).toBe(false);
});
