import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  bool,
  choice,
  colour,
  defineKnobs,
  diffText,
  num,
  offeredLabel,
  offeredOf,
  resetKnob,
  set,
  setKnob,
} from "./knobs";

afterEach(() => {
  resetKnob();
  vi.unstubAllEnvs();
});

it("offers readable labels while storing stable category IDs", () => {
  const knobs = defineKnobs("category-labels", "knobs.test.ts", {
    layers: { hidden: set("Hidden") },
  });
  knobs.offer("layers", "hidden", ["-2000011"], { "-2000011": "Murs" });
  expect(offeredOf("category-labels.layers.hidden")).toEqual(["-2000011"]);
  expect(offeredLabel("category-labels.layers.hidden", "-2000011")).toBe("Murs");
  knobs.set("layers", "hidden", ["-2000011"]);
  expect(knobs.read().layers.hidden).toEqual(["-2000011"]);
  knobs.offer("layers", "hidden", ["-2000011"], { "-2000011": "Walls" });
  expect(offeredLabel("category-labels.layers.hidden", "-2000011")).toBe("Walls");
});

it("copies only knobs that differ from code, grouped by module with their source", () => {
  const scene = {
    name: "scene",
    source: "scene/grounds.ts",
    spec: {
      veil: { farFt: num("Far", 40, [1, 64, 1]), curve: num("Curve", 2, [0.5, 6, 0.1]) },
      lights: { sun: colour("Sun", "#fffaf2") },
    },
  };
  const capture = {
    name: "capture",
    source: "scene/host.ts",
    spec: { context: { paddingFt: num("Padding", 15, [0, 60, 1], "refetch") } },
  };
  const changed = new Map<string, unknown>([
    ["scene.veil.farFt", 24],
    ["scene.veil.curve", 2],
    ["scene.lights.sun", "#ffeedd"],
    ["capture.context.paddingFt", 0.1 + 0.2],
  ]);
  expect(diffText([scene, capture], changed)).toBe(
    [
      "# scene/grounds.ts",
      "scene.veil.farFt: 24 (default 40)",
      "scene.lights.sun: #ffeedd (default #fffaf2)",
      "# scene/host.ts",
      "capture.context.paddingFt: 0.3 (default 15)",
    ].join("\n"),
  );
  expect(diffText([scene, capture], new Map())).toBe("");
});

it("reads overrides over defaults, stays stable between changes, and forgets a reset", () => {
  const knobs = defineKnobs("test", "knobs.test.ts", {
    a: { on: bool("On", false), hidden: set("Hidden") },
  });
  const first = knobs.read();
  expect(first).toEqual({ a: { on: false, hidden: [] } });
  expect(knobs.read()).toBe(first);
  setKnob("test.a.on", true);
  setKnob("test.a.hidden", ["Walls"]);
  expect(knobs.read()).toEqual({ a: { on: true, hidden: ["Walls"] } });
  setKnob("test.a.on", false);
  resetKnob("test.a.hidden");
  expect(knobs.read()).toEqual(first);
  setKnob("test.a.on", true);
  vi.stubEnv("DEV", false);
  expect(knobs.read()).toEqual(first);
  expect(defineKnobs("test", "knobs.test.ts", { a: { on: bool("On", false) } }).read()).toEqual({
    a: { on: false },
  });
});

it("rejects invalid dynamic edits before typed scene and capture readers see them", () => {
  const knobs = defineKnobs("validated", "knobs.test.ts", {
    group: {
      distance: num("Distance", 10, [0, 64, 0.5], "refetch", "ft"),
      mode: choice("Mode", "walls", ["walls", "none"]),
      enabled: bool("Enabled", false),
      ink: colour("Ink", "alarm"),
      categories: set("Categories"),
    },
  });
  const first = knobs.read();
  for (const value of [NaN, Infinity, -1, 65, "20", null])
    expect(setKnob("validated.group.distance", value)).toBe(false);
  expect(setKnob("validated.group.mode", "other")).toBe(false);
  expect(setKnob("validated.group.enabled", 1)).toBe(false);
  expect(setKnob("validated.group.ink", "invalid-token")).toBe(false);
  expect(setKnob("validated.group.categories", [3])).toBe(false);
  expect(knobs.read()).toBe(first);
  knobs.set("group", "distance", 12);
  knobs.set("group", "mode", "none");
  expect(knobs.read().group).toMatchObject({ distance: 12, mode: "none" });
  const edited = knobs.read();
  knobs.set("group", "distance", 12);
  expect(knobs.read()).toBe(edited);
  vi.stubEnv("DEV", false);
  expect(knobs.set("group", "distance", 30)).toBe(false);
  expect(knobs.read()).toBe(knobs.defaults);
});

it("re-registers defaults without losing valid edits and only invalidates the changed module", () => {
  const spec = { a: { n: num("N", 2, [0, 8, 1]) }, b: { on: bool("On", false) } };
  const one = defineKnobs("one", "one.ts", spec);
  const two = defineKnobs("two", "two.ts", spec);
  const unchanged = two.read();
  one.set("a", "n", 5);
  one.set("b", "on", true);
  expect(two.read()).toBe(unchanged);
  expect(defineKnobs("one", "one.ts", spec).read().a.n).toBe(5);
  resetKnob("one.a");
  expect(one.read()).toEqual({ a: { n: 2 }, b: { on: true } });
  resetKnob("one");
  expect(one.read()).toEqual(one.defaults);
});
