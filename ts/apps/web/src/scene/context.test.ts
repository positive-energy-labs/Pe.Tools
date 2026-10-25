import { expect, it } from "vite-plus/test";
import { CATEGORY_IDS as C } from "./categories";
import { contextVisible } from "./context";
import { LOOK } from "./grounds";

it("preserves subjects and stubs despite every context filter", () => {
  for (const context of ["all", "walls", "structural", "none"] as const) {
    const layers = {
      ...LOOK.defaults.layers,
      context,
      lighting: false,
      hiddenCategories: [String(C.walls), String(C.lightingFixtures)],
    };
    for (const id of [C.walls, C.lightingFixtures, null, 123456]) {
      expect(contextVisible(id, "subject", layers)).toBe(true);
      expect(contextVisible(id, "stub", layers)).toBe(true);
    }
    expect(contextVisible(C.walls, "context", layers)).toBe(false);
    expect(contextVisible(C.lightingFixtures, "context", layers)).toBe(false);
  }
});

it("matches positive presets by numeric BuiltInCategory identity only", () => {
  const walls = { ...LOOK.defaults.layers, context: "walls" as const };
  const structural = { ...LOOK.defaults.layers, context: "structural" as const };
  for (const id of [C.walls, C.curtainPanels, C.curtainMullions]) {
    expect(contextVisible(id, "context", walls)).toBe(true);
    expect(contextVisible(id, "context", structural)).toBe(false);
  }
  for (const id of [C.structuralColumns, C.structuralFraming, C.structuralFoundations, C.floors]) {
    expect(contextVisible(id, "context", structural)).toBe(true);
    expect(contextVisible(id, "context", walls)).toBe(false);
  }
  for (const id of [null, 123456, -2008000, C.lightingFixtures, C.lightingDevices]) {
    expect(contextVisible(id, "context", walls)).toBe(false);
    expect(contextVisible(id, "context", structural)).toBe(false);
  }
});

it("retains unknown categories in all and no-lighting, and hides only explicit numeric IDs", () => {
  const noLighting = { ...LOOK.defaults.layers, lighting: false };
  for (const id of [null, 123456, -2008000, C.walls]) {
    expect(contextVisible(id, "context", LOOK.defaults.layers)).toBe(true);
    expect(contextVisible(id, "context", noLighting)).toBe(true);
    expect(contextVisible(id, "context", { ...noLighting, context: "none" })).toBe(false);
  }
  for (const id of [C.lightingFixtures, C.lightingDevices]) {
    expect(contextVisible(id, "context", LOOK.defaults.layers)).toBe(true);
    expect(contextVisible(id, "context", noLighting)).toBe(false);
  }
  expect(
    contextVisible(C.walls, "context", {
      ...LOOK.defaults.layers,
      hiddenCategories: ["Walls"],
    }),
  ).toBe(true);
  expect(
    contextVisible(C.walls, "context", {
      ...LOOK.defaults.layers,
      hiddenCategories: [String(C.walls)],
    }),
  ).toBe(false);
  expect(
    contextVisible(123456, "context", {
      ...LOOK.defaults.layers,
      hiddenCategories: ["123456"],
    }),
  ).toBe(false);
  expect(
    contextVisible(null, "context", {
      ...LOOK.defaults.layers,
      hiddenCategories: ["null"],
    }),
  ).toBe(true);
});
