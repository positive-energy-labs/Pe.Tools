// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { SceneSection } from "@pe/agent-contracts";
import { SectionEditor } from "./section-editor";
import { SectionEditorController } from "./section-editor-controller";
import { emptyCuts } from "@pe/web-kernel/scene/cuts";

afterEach(cleanup);
const bounds = { minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 10, maxZ: 10 };
function fixture(withCut = true) {
  const cuts = emptyCuts();
  cuts.top.polyline = [
    [1, 1],
    [8, 1],
    [8, 8],
  ];
  const source: { document: string; section: SceneSection | null } = {
    document: "doc",
    section: withCut ? { kind: "cuts", cuts } : null,
  };
  const commit = vi.fn(),
    onAxis = vi.fn();
  const controller = new SectionEditorController(
    () => source,
    () => bounds,
    commit,
  );
  const view = render(
    <SectionEditor
      controller={controller}
      section={source.section}
      bounds={bounds}
      axis="top"
      viewport={{ kind: "plane", scale: 10, tx: 0, ty: 100 }}
      onAxis={onAxis}
      thumbnail={() => {}}
    />,
  );
  const svg = view.getByLabelText("Top cut drawing");
  Object.defineProperty(svg, "setPointerCapture", { value: vi.fn() });
  const pointer = (target: Element, type: string, x = 10, y = 90) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, "pointerId", { value: 1 });
    fireEvent(target, event);
  };
  return { view, source, controller, svg, commit, onAxis, pointer };
}
test("P3-C corner drag commits at release, lost capture and Escape cancel without Page writes", () => {
  const f = fixture();
  const node = f.svg.querySelector('[data-node="0"]')!;
  f.pointer(node, "pointerdown");
  f.pointer(f.svg, "pointermove", 30, 90);
  expect(f.commit).not.toHaveBeenCalled();
  f.pointer(f.svg, "pointerup", 30, 90);
  expect(f.commit).toHaveBeenCalledTimes(1);
  expect(f.commit.mock.calls[0]![1]).toBe("named");
  f.commit.mockClear();
  f.pointer(node, "pointerdown");
  f.pointer(f.svg, "pointermove", 30, 90);
  f.pointer(f.svg, "lostpointercapture");
  f.pointer(f.svg, "pointerup");
  expect(f.commit).not.toHaveBeenCalled();
  f.pointer(node, "pointerdown");
  f.pointer(f.svg, "pointermove", 30, 90);
  fireEvent.keyDown(f.svg, { key: "Escape" });
  f.pointer(f.svg, "pointerup");
  expect(f.commit).not.toHaveBeenCalled();
  expect(f.onAxis).toHaveBeenLastCalledWith(null);
});

test("New leaves an empty picture alone and clears the last cut", () => {
  const blank = fixture(false);
  fireEvent.click(blank.view.getByRole("button", { name: "Draw a new cut" }));
  expect(blank.commit).not.toHaveBeenCalled();
  blank.view.unmount();

  const drawn = fixture();
  fireEvent.click(drawn.view.getByRole("button", { name: "Draw a new cut" }));
  expect(drawn.commit.mock.calls).toEqual([[null, "named"]]);
});
test("P3-C Pea replacement between contact and release cannot be overwritten", () => {
  const f = fixture();
  f.pointer(f.svg.querySelector('[data-node="0"]')!, "pointerdown");
  f.source.section = { kind: "plane", axis: "z", keep: "above", offset: 7 };
  f.pointer(f.svg, "pointermove", 30, 90);
  f.pointer(f.svg, "pointerup");
  expect(f.commit).not.toHaveBeenCalled();
});
test("right-click inserts an edge point and deletes a node through one named commit", () => {
  const f = fixture();
  fireEvent.contextMenu(f.svg.querySelector('[data-edge="0"]')!);
  expect(f.commit.mock.calls[0]![0].cuts.top.polyline).toEqual([
    [1, 1],
    [4.5, 1],
    [8, 1],
    [8, 8],
  ]);
  f.commit.mockClear();
  fireEvent.contextMenu(f.svg.querySelector('[data-node="1"]')!);
  expect(f.commit).toHaveBeenCalledTimes(1);
});
