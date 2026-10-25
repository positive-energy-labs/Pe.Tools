import { afterEach, expect, test } from "vite-plus/test";
import { resetKnob, setKnob, knobModules } from "#/knobs/knobs";
import { scopeOf, sectionsOf, systemScope } from "@pe/ducts-domain/system-scope";
import type { SceneInstance } from "#/scene/types";
import { NAVIGATION_FIXTURE } from "./navigation.fixture";
import {
  activeSystem,
  capped,
  DUCTS_MULTI,
  paintOfDucts,
  toggleSystem,
  withSystem,
} from "./selection";
import { sceneRequestOf } from "./manifest";
afterEach(() => resetKnob());

test("selection opens in order, closes membership, and evicts the oldest over the cap", () => {
  expect(DUCTS_MULTI.read().selection.systemCap).toBe(4);
  expect(capped(["A", "B", "C", "D", "E"])).toEqual(["B", "C", "D", "E"]);
  expect(toggleSystem(["A", "B"], "A")).toEqual(["B"]);
  expect(toggleSystem(["A", "B"], "C")).toEqual(["A", "B", "C"]);
  expect(withSystem(["A", "B"], "A")).toEqual(["A", "B"]);
  expect(activeSystem({ system: ["A", "B"] })).toBe("B");
  expect(activeSystem({ system: [] })).toBe("");
});

test("selection knobs change admission and disclose the capture cost", () => {
  const spec = knobModules().find((module) => module.name === "ducts")!.spec.selection!;
  expect(Object.keys(spec)).toEqual(["systemCap", "stubFt", "hop", "neighbourCap"]);
  expect(Object.values(spec).every((knob) => knob.cost === "refetch")).toBe(true);
  setKnob("ducts.selection.systemCap", 2);
  expect(capped(["A", "B", "C"])).toEqual(["B", "C"]);
  setKnob("ducts.selection.hop", "all");
  expect(DUCTS_MULTI.read().selection.hop).toBe("all");
});

test("halo and big context share capture; plain subject ink omits system keys", () => {
  const { snapshot } = NAVIGATION_FIXTURE;
  for (const layers of [["halo"], ["context"], ["halo", "context"]] satisfies (
    | "halo"
    | "context"
  )[][])
    expect(sceneRequestOf(snapshot, { system: ["SA Office"], layers })!.focusOnly).toBe(false);
  const id = snapshot.segments[0]!.id;
  const paint = paintOfDucts(snapshot, new Set([id]), new Set(), false);
  expect(paint({ revitId: id } as SceneInstance)).toEqual({ tier: "subject" });
});

test("the production fixture unions sections once and captures every opened member plus stubs", () => {
  const { snapshot } = NAVIGATION_FIXTURE;
  const systems = ["SA Office", "SA Lab", "EA Lab"];
  const scope = scopeOf(snapshot, systems)!;
  expect(scope.groups).toHaveLength(2);
  expect([...sectionsOf(snapshot, systems).keys()]).toEqual(scope.groups);
  expect(scope.shared.get(scope.groups[0]!)).toEqual(["SA Lab"]);
  const request = sceneRequestOf(
    snapshot,
    { system: systems, layers: ["meshes"] },
    [],
    [999999, 999999],
  )!;
  expect(request.elementIds).toEqual([...scope.members, 999999].sort((a, b) => a - b));
  expect(request.focusOnly).toBe(true);
  expect(sceneRequestOf(snapshot, { system: [], layers: ["context"] })!.elementIds).toEqual(
    [...snapshot.nodes, ...snapshot.segments].map((e) => e.id).sort((a, b) => a - b),
  );
});

test("paint uses each element's own system, subject wins over stub, and context stays context", () => {
  const { snapshot } = NAVIGATION_FIXTURE;
  const open = systemScope(snapshot, "SA Office").members;
  const outside = snapshot.nodes.find((n) => n.systemName === "EA Lab")!;
  const office = snapshot.nodes.find((n) => n.systemName === "SA Office")!;
  const lab = snapshot.nodes.find((n) => n.systemName === "SA Lab")!;
  const paint = paintOfDucts(snapshot, open, new Set([outside.id, office.id]));
  const instance = (id: number | null) => ({ revitId: id, focus: true }) as SceneInstance;
  expect(paint(instance(office.id))).toEqual({ tier: "subject", key: "supply", ink: "#0569a5" });
  expect(paint(instance(lab.id))).toEqual({ tier: "subject", key: "supply", ink: "#0569a5" });
  expect(paint(instance(outside.id))).toEqual({ tier: "stub", key: "exhaust", ink: "#fea665" });
  expect(paint(instance(999999))).toBeUndefined();
  expect(paint(instance(null))).toBeUndefined();
});
