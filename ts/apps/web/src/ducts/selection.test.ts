import { afterEach, expect, test } from "vite-plus/test";
import { resetKnob } from "#/knobs/knobs";
import { systemScope } from "@pe/ducts-domain/system-scope";
import type { SceneInstance } from "#/scene/types";
import { paintOf } from "#/scene/grounds";
import { NAVIGATION_FIXTURE } from "./navigation.fixture";
import { paintOfDucts } from "./selection";


afterEach(() => resetKnob());







test("non-focus MEP paints as stub (kind from its snapshot system, pipes unknown); other context stays context", () => {
  const { snapshot } = NAVIGATION_FIXTURE;
  const paint = paintOfDucts(snapshot, new Set(), new Set());
  const at = (over: Partial<SceneInstance>) =>
    ({ revitId: null, focus: false, category: "", ...over }) as SceneInstance;
  const duct = snapshot.segments[0]!;
  expect(paint(at({ revitId: duct.id, category: "Ducts" }))).toEqual({
    tier: "stub",
    kind: "supply",
  });
  expect(paint(at({ revitId: 424242, category: "Pipes" }))).toEqual({
    tier: "stub",
    kind: "unknown",
  });
  // Not in the MEP set: no paint, so the grounds default (context) applies.
  expect(paintOf(at({ revitId: 515151, category: "Walls" }), paint).tier).toBe("context");
  // A focus instance that is not opened keeps the default (subject), never stub.
  expect(paint(at({ revitId: 424242, category: "Pipes", focus: true }))).toBeUndefined();
});

test("paint uses each element's own system, subject wins over stub, and context stays context", () => {
  const { snapshot } = NAVIGATION_FIXTURE;
  const open = systemScope(snapshot, "SA Office").members;
  const outside = snapshot.nodes.find((n) => n.systemName === "EA Lab")!;
  const office = snapshot.nodes.find((n) => n.systemName === "SA Office")!;
  const lab = snapshot.nodes.find((n) => n.systemName === "SA Lab")!;
  const paint = paintOfDucts(snapshot, open, new Set([outside.id, office.id]));
  const instance = (id: number | null) => ({ revitId: id, focus: true }) as SceneInstance;
  expect(paint(instance(office.id))).toEqual({ tier: "subject", kind: "supply" });
  expect(paint(instance(lab.id))).toBeUndefined();
  expect(paint(instance(outside.id))).toEqual({ tier: "stub", kind: "exhaust", neighbour: true });
  expect(paint(instance(999999))).toBeUndefined();
  expect(paint(instance(null))).toBeUndefined();
});
