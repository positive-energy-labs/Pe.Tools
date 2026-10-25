// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SectionControls, SectionHandles } from "./section-controls";
import type { Section } from "./section";

afterEach(cleanup);
const subject = { minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 10, maxZ: 10 };
test("section to subject and plane toggle publish camera-independent state", () => {
  const onChange = vi.fn();
  const view = render(
    <SectionControls
      view={{ preset: "walls", section: null }}
      subject={subject}
      padding={3}
      onChange={onChange}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Section to subject" }));
  expect(onChange).toHaveBeenLastCalledWith({
    preset: "walls",
    section: {
      kind: "box",
      bounds: { minX: -3, minY: -3, minZ: -3, maxX: 13, maxY: 13, maxZ: 13 },
    },
  });
  fireEvent.click(view.getByRole("button", { name: "Plane cut" }));
  const plane = { kind: "plane", axis: "z", offset: 5, keep: "below" } as const;
  expect(onChange).toHaveBeenLastCalledWith({ preset: "walls", section: plane });
  view.rerender(
    <SectionControls
      view={{ preset: "walls", section: plane }}
      subject={subject}
      padding={3}
      onChange={onChange}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Plane cut" }));
  expect(onChange).toHaveBeenLastCalledWith({ preset: "walls", section: null });
});

test("face keyboard input commits and Escape cancels a preview without changing the camera", () => {
  const onPreview = vi.fn(),
    onCommit = vi.fn();
  const section: Section = { kind: "plane", axis: "x", offset: 5, keep: "below" };
  const view = render(
    <SectionHandles
      section={section}
      subject={subject}
      project={(p) => [p[0]! * 10, p[1]! * 10]}
      onPreview={onPreview}
      onCommit={onCommit}
    />,
  );
  const handle = view.getByRole("button", { name: /Drag section X cut/ });
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(onCommit).toHaveBeenLastCalledWith({ ...section, offset: 5.25 });
  onCommit.mockClear();
  fireEvent.keyDown(handle, { key: "Escape" });
  expect(onPreview).toHaveBeenLastCalledWith(undefined);
  expect(onCommit).not.toHaveBeenCalled();
});

test("face dragging previews immediately and commits only at release; cancellation discards it", () => {
  const onPreview = vi.fn(),
    onCommit = vi.fn();
  const section: Section = { kind: "plane", axis: "x", offset: 5, keep: "below" };
  const view = render(
    <SectionHandles
      section={section}
      subject={subject}
      project={(p) => [p[0]! * 10, p[1]! * 10]}
      onPreview={onPreview}
      onCommit={onCommit}
    />,
  );
  const handle = view.getByRole("button", { name: /Drag section X cut/ });
  Object.defineProperty(handle, "setPointerCapture", { value: vi.fn() });
  const pointer = (type: string, clientX: number) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY: 50 });
    Object.defineProperty(event, "pointerId", { value: 1 });
    fireEvent(handle, event);
  };
  pointer("pointerdown", 50);
  pointer("pointermove", 70);
  expect(onPreview).toHaveBeenLastCalledWith({ ...section, offset: 7 });
  expect(onCommit).not.toHaveBeenCalled();
  pointer("pointerup", 70);
  expect(onCommit).toHaveBeenLastCalledWith({ ...section, offset: 7 });
  onCommit.mockClear();
  pointer("pointerdown", 50);
  pointer("pointermove", 60);
  pointer("pointercancel", 60);
  expect(onPreview).toHaveBeenLastCalledWith(undefined);
  expect(onCommit).not.toHaveBeenCalled();
});
