import { expect, it } from "vite-plus/test";
import { CATEGORY_IDS as C } from "./categories";
import { contextVisible } from "./context";
import { LOOK } from "./grounds";

it("subjects and envelopes are visible under every context filter", () => {
  for (const context of ["all", "walls", "structural", "none"] as const) {
    const layers = {
      ...LOOK.defaults.layers,
      context,
      lighting: false,
      hiddenCategories: [String(C.walls), String(C.lightingFixtures), String(C.pipes)],
    };
    for (const id of [C.walls, C.lightingFixtures, C.pipes, null, 123456]) {
      expect(contextVisible(id, "subject", layers)).toBe(true);
      expect(contextVisible(id, "envelope", layers)).toBe(true);
    }
  }
});

it("preset none hides a proximity pipe stub but keeps a neighbour duct stub", () => {
  const none = { ...LOOK.defaults.layers, context: "none" as const };
  expect(contextVisible(C.pipes, "stub", none)).toBe(false);
  expect(contextVisible(C.pipes, "stub", none, false)).toBe(false);
  expect(contextVisible(C.ducts, "stub", none, true)).toBe(true);
  expect(contextVisible(C.ducts, "stub", none, false)).toBe(false);
  expect(contextVisible(C.ducts, "context", none)).toBe(false);
});

it("a hidden category hides both proximity and neighbour stubs, and never a subject", () => {
  const hidden = { ...LOOK.defaults.layers, hiddenCategories: [String(C.pipes), String(C.ducts)] };
  expect(contextVisible(C.pipes, "stub", hidden, false)).toBe(false);
  expect(contextVisible(C.ducts, "stub", hidden, true)).toBe(false);
  expect(contextVisible(C.pipes, "subject", hidden)).toBe(true);
  expect(contextVisible(C.pipes, "stub", LOOK.defaults.layers)).toBe(true);
});

it("the lighting toggle hides proximity stubs, not neighbours", () => {
  const noLighting = { ...LOOK.defaults.layers, lighting: false };
  expect(contextVisible(C.lightingFixtures, "stub", noLighting, false)).toBe(false);
  expect(contextVisible(C.lightingFixtures, "stub", noLighting, true)).toBe(true);
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
