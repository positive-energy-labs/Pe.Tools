import { expect, test, vi } from "vite-plus/test";
import type { SceneSection } from "@pe/agent-contracts";
import { SectionEditorController } from "./section-editor-controller";
import { emptyCuts } from "./cuts";

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
