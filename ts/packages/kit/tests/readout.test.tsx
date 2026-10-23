// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { KeyScope } from "../src/keys";
import { PictureReadout } from "../src/components/lang/readout";
import { PaneCrumb } from "../src/components/lang/pane-crumb";

afterEach(cleanup);

it.each([undefined, "selected duct"])("swaps notices in the reserved lines for %s", (title) => {
  const view = (pending?: string, retained?: string) => (
    <PictureReadout title={title} summary="system summary" pending={pending} retained={retained}>
      <p>retained facts</p>
    </PictureReadout>
  );
  const { container, rerender } = render(view());
  const lines = [...container.querySelectorAll(".dl-readout-line")];
  const facts = screen.getByText("retained facts");
  expect(lines).toHaveLength(2);
  for (const pending of ["refreshing", "opening another system", undefined]) {
    rerender(view(pending, pending ? "showing the last read" : undefined));
    expect([...container.querySelectorAll(".dl-readout-line")]).toEqual(lines);
    expect(screen.getByText("retained facts")).toBe(facts);
    expect(facts.parentElement?.children).toHaveLength(2);
    expect(screen.getByText("system summary").getAttribute("aria-hidden")).toBe(
      pending ? "true" : null,
    );
    for (const status of screen.queryAllByRole("status"))
      expect(status.closest(".dl-readout-line")).not.toBeNull();
  }
});

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
  expect(dock.querySelector("header [data-readout-title]")).toBeTruthy();
  expect(dock.querySelector("header")?.textContent).toBe("");
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
