// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { KeyScope } from "../src/keys";
import { PictureReadout } from "../src/components/lang/readout";
import { PaneCrumb } from "../src/components/lang/pane-crumb";

afterEach(cleanup);

it("claims wheel events and clears by button without binding Escape", () => {
  const clear = vi.fn();
  const view = (title?: string, hidden = false) => (
    <KeyScope id="picture" hidden={hidden}>
      <PictureReadout title={title} onClear={clear}>
        facts
      </PictureReadout>
    </KeyScope>
  );
  const { rerender } = render(view("short"));
  const dock = screen.getByRole("region", { name: "the selection" });
  const body = dock.querySelector<HTMLElement>("[data-readout-body]")!;
  const wheel = new WheelEvent("wheel", {
    deltaY: 2,
    deltaMode: 1,
    cancelable: true,
    bubbles: true,
  });
  fireEvent(body, wheel);
  expect(wheel.defaultPrevented).toBe(true);
  expect(body.scrollTop).toBe(32);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(clear).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Clear the selection · Esc" }));
  expect(clear).toHaveBeenCalledTimes(1);
  rerender(view("a much longer selection name"));
  expect(screen.getByRole("region", { name: "the selection" })).toBe(dock);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(clear).toHaveBeenCalledTimes(1);
  rerender(view(undefined));
  fireEvent.keyDown(document, { key: "Escape" });
  rerender(view("hidden selection", true));
  fireEvent.keyDown(document, { key: "Escape" });
  expect(clear).toHaveBeenCalledTimes(1);
});

it("keeps crumb order, invokes its segment and exposes Revit targets", () => {
  const press = vi.fn();
  render(
    <PaneCrumb
      segments={[
        { label: "Systems", onPress: press },
        { label: "Supply" },
        { label: "Room A", revit: [123] },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Systems" }));
  expect(press).toHaveBeenCalledOnce();
  expect(screen.getByText("Room A").getAttribute("data-revit-ids")).toBe("123");
  expect(
    [...document.querySelectorAll("[data-crumb-segment]")].map((node) => node.textContent),
  ).toEqual(["Systems", "Supply", "Room A"]);
});
