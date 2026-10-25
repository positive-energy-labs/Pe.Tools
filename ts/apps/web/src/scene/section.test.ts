import { expect, test } from "vite-plus/test";
import { routeAddress, sceneViewSchema } from "@pe/agent-contracts";
import { clipContains, fitSection, rebaseCaps, sectionContains, sectionVolume } from "./section";
import { moveSectionFace } from "./section-controls";
import { presetLook } from "./presets";
import { LOOK } from "./grounds";
import { contextVisible } from "./context";
import { CATEGORY_IDS } from "./categories";

const bounds = { minX: 1000, minY: -20, minZ: 10, maxX: 1020, maxY: 0, maxZ: 15 };
test("cap rebasing retains a fractional world cut on the exact shader plane", () => {
  const offset = 100000.123456;
  const origin = [100000, 100000, 100000];
  const positions = rebaseCaps(
    new Float32Array([offset, 100001, 100002]),
    { kind: "plane", axis: "x", offset, keep: "below" },
    origin,
  );
  expect(positions[0]).toBe(Math.fround(offset - origin[0]!));
  expect(positions[1]).toBe(1);
  expect(positions[2]).toBe(2);
});
test("section fit includes the whole subject in world feet and rejects geometry beyond each face", () => {
  const section = fitSection(bounds, 3);
  expect(section).toEqual({
    kind: "box",
    bounds: { minX: 997, minY: -23, minZ: 7, maxX: 1023, maxY: 3, maxZ: 18 },
  });
  for (const point of [
    [997, -23, 7],
    [1023, 3, 18],
    [1010, -10, 12],
  ])
    expect(sectionContains(section, point)).toBe(true);
  for (const point of [
    [996, -10, 12],
    [1024, -10, 12],
    [1010, -24, 12],
    [1010, 4, 12],
    [1010, -10, 6],
    [1010, -10, 19],
  ])
    expect(clipContains(sectionVolume(section), point, [1010, -10, 12.5])).toBe(false);
  const crossed = moveSectionFace(section, { axis: "x", side: "min" }, 2000);
  expect(crossed.kind === "box" && crossed.bounds.minX).toBeCloseTo(1022.99);
});

test("plane side and packed polygon clipping agree for hits in world coordinates", () => {
  for (const axis of ["x", "y", "z"] as const) {
    const point = [5, 5, 5];
    const section = { kind: "plane", axis, keep: "below", offset: 4 } as const;
    expect(sectionContains(section, point)).toBe(false);
    expect(sectionContains({ ...section, keep: "above" }, point)).toBe(true);
  }
  const data = new Float32Array(384);
  data.set([-2, -2, 2, -2, 2, 2, -2, 2]);
  const volume = { data, counts: [4, 0, 0], keepInside: [true, true, true] };
  expect(clipContains(volume, [100, 100, 500], [100, 100, 0])).toBe(true);
  expect(clipContains(volume, [103, 100, 500], [100, 100, 0])).toBe(false);
  expect(
    clipContains({ ...volume, keepInside: [false, true, true] }, [103, 100, 500], [100, 100, 0]),
  ).toBe(true);
});

test("section and preset survive the shared address contract; invalid boxes cannot enter Page", () => {
  const view = { preset: "nearby-structure", section: fitSection(bounds, 3) } as const;
  const address = routeAddress("ducts");
  expect(address.read(address.write({ sceneView: view })).page.sceneView).toEqual(view);
  expect(
    sceneViewSchema.safeParse({
      ...view,
      section: { kind: "box", bounds: { ...bounds, minX: 2000 } },
    }).success,
  ).toBe(false);
  expect(
    sceneViewSchema.safeParse({
      ...view,
      section: { kind: "plane", axis: "z", offset: NaN, keep: "below" },
    }).success,
  ).toBe(false);
});

test("compound presets filter context only and never remove an opened system or stub", () => {
  for (const preset of [
    "walls",
    "structural",
    "no-lighting",
    "nearby-structure",
    "subject",
  ] as const) {
    const look = presetLook(LOOK.defaults, preset);
    expect(contextVisible(CATEGORY_IDS.lightingFixtures, "subject", look.layers)).toBe(true);
    expect(contextVisible(CATEGORY_IDS.lightingFixtures, "stub", look.layers)).toBe(true);
    expect(contextVisible(CATEGORY_IDS.lightingFixtures, "context", look.layers)).toBe(false);
  }
  expect(
    contextVisible(
      CATEGORY_IDS.structuralFraming,
      "context",
      presetLook(LOOK.defaults, "nearby-structure").layers,
    ),
  ).toBe(true);
  expect(
    contextVisible(
      CATEGORY_IDS.walls,
      "context",
      presetLook(LOOK.defaults, "nearby-structure").layers,
    ),
  ).toBe(false);
});
