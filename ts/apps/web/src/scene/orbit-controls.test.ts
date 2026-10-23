// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { PerspectiveCamera } from "three";
import { createOrbitControls } from "./orbit-controls";

test("24 detached canvas disposals release their original document key listeners", () => {
  const add = vi.spyOn(document, "addEventListener");
  const remove = vi.spyOn(document, "removeEventListener");
  for (let i = 0; i < 24; i++) {
    const host = document.createElement("div");
    const canvas = document.createElement("canvas");
    document.body.append(host);
    host.append(canvas);
    const controls = createOrbitControls(new PerspectiveCamera(), canvas);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", code: "ControlLeft" }));
    host.remove();
    controls.dispose();
  }
  const registrations = add.mock.calls.filter(([type]) => type === "keydown" || type === "keyup");
  expect(registrations.filter(([type]) => type === "keydown")).toHaveLength(24);
  for (const [type, listener] of registrations)
    expect(
      remove.mock.calls.some(
        ([removedType, removedListener, options]) =>
          type === removedType &&
          listener === removedListener &&
          (options === true || (typeof options === "object" && options.capture === true)),
      ),
    ).toBe(true);
  add.mockRestore();
  remove.mockRestore();
});
