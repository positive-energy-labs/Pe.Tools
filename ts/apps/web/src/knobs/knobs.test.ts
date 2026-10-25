import { afterEach, expect, it, vi } from "vite-plus/test";
import { bool, colour, defineKnobs, diffText, num, resetKnob, set, setKnob } from "./knobs";

afterEach(() => {
  resetKnob();
  vi.unstubAllEnvs();
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
