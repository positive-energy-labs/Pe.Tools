import { expect, test, vi } from "vite-plus/test";
import { routeAddress, type SceneSection } from "@pe/agent-contracts";
import { SectionEditorController } from "./section-editor-controller";
import { emptyCuts } from "@pe/web-kernel/scene/cuts";

const bounds = { minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 10, maxZ: 10 };
const plane = (offset: number): SceneSection => ({
  kind: "plane",
  axis: "x",
  keep: "below",
  offset,
});
function fixture() {
  const source = { document: "doc-a", section: plane(1) },
    commit = vi.fn();
  return {
    source,
    commit,
    controller: new SectionEditorController(
      () => source,
      () => bounds,
      commit,
    ),
  };
}
test("P3-C 100 motion samples write no Page; release makes exactly one named commit", () => {
  const { controller, commit } = fixture();
  controller.begin(plane(1));
  for (let i = 0; i < 100; i++) controller.preview(plane(i + 2));
  expect(commit).not.toHaveBeenCalled();
  controller.release();
  controller.release();
  expect(commit.mock.calls).toEqual([[plane(101), "named"]]);
});
test("P3-C cancel, lost pointer, unchanged and invalid release make no Page entry", () => {
  const { controller, commit } = fixture();
  controller.begin(plane(2));
  controller.cancel();
  controller.release();
  controller.begin(plane(1));
  controller.release();
  const cuts = emptyCuts();
  cuts.top = {
    ...cuts.top,
    closed: true,
    polyline: [
      [0, 0],
      [3, 3],
      [0, 3],
      [3, 0],
    ],
  };
  controller.begin({ kind: "cuts", cuts });
  expect(controller.read()?.refusal).toMatch(/cross/);
  controller.release();
  expect(commit).not.toHaveBeenCalled();
});

test("release rounds a full cut for the share link after previewing its exact points", () => {
  const { controller, commit } = fixture();
  const cuts = emptyCuts();
  cuts.top.closed = true;
  cuts.top.polyline = Array.from({ length: 56 }, (_, i) => [
    1250.123456789 + 20 * Math.cos((i * 2 * Math.PI) / 56),
    2400.987654321 + 20 * Math.sin((i * 2 * Math.PI) / 56),
  ]);
  const section = { kind: "cuts" as const, cuts };
  controller.begin(section);
  expect(controller.read()).toEqual({ section, refusal: null });
  expect(commit).not.toHaveBeenCalled();
  expect(controller.release()).toBeNull();

  const saved: SceneSection | null = commit.mock.calls[0]?.[0];
  expect(saved?.kind).toBe("cuts");
  if (saved?.kind !== "cuts") return;
  expect(saved.cuts.top.polyline).toHaveLength(56);
  expect(saved.cuts.top.polyline[0]).toEqual([1270.1235, 2400.9877]);
  const address = routeAddress("duct-systems");
  const before = address.link({ sceneView: { preset: "all", section } });
  const after = address.link({ sceneView: { preset: "all", section: saved } });
  expect(after.length).toBeLessThan(before.length * 0.8);
});

test("release refuses a cut whose distinct points become too close after rounding", () => {
  const { controller, commit } = fixture();
  const cuts = emptyCuts();
  cuts.top.polyline = [
    [1.000051, 1.000051],
    [1.001, 1.000401],
  ];
  controller.begin({ kind: "cuts", cuts });
  expect(controller.read()?.refusal).toBeNull();
  expect(controller.release()).toBe("Cut points must be distinct");
  expect(commit).not.toHaveBeenCalled();
});
test.each(["document", "section"] as const)(
  "P3-C external %s replacement kills obsolete release and motion cannot rearm it",
  (key) => {
    const { controller, commit, source } = fixture();
    controller.begin(plane(2));
    if (key === "document") source.document = "doc-b";
    else source.section = plane(3);
    controller.preview(plane(4));
    controller.release();
    expect(controller.read()).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  },
);
