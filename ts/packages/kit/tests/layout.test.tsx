// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { Pane, PaneFaultProvider, PaneOverlay, PaneSplit } from "../src/components/lang/pane";
import { PictureReadout } from "../src/components/lang/readout";
import { Button } from "../src/components/lang/button";
import { ButtonGroup } from "../src/components/lang/button-group";
import { X } from "lucide-react";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("empty chrome has no header or empty title, while metadata and actions can earn a header", () => {
  const { container, rerender } = render(
    <Pane title="" meta={false} tabs={<></>} actions={[]} help={null}>
      body
    </Pane>,
  );
  expect(container.querySelector("[data-slot='pane-header']")).toBeNull();
  rerender(<Pane meta="three rooms">body</Pane>);
  expect(container.querySelector("[data-slot='pane-header']")).not.toBeNull();
  expect(container.querySelector("h2")).toBeNull();
  rerender(<Pane actions={<Button label="fit">fit</Button>}>body</Pane>);
  expect(screen.getByRole("button", { name: "fit" })).toBeTruthy();
});

it("nested picture furniture joins the same field, and readout wheel and clear button survive the portal", () => {
  const clear = vi.fn();
  const { container } = render(
    <Pane overlay={<span>tools</span>}>
      <div>
        <PictureReadout title="Room A" onClear={clear}>
          facts
        </PictureReadout>
        <PaneOverlay label="status" place="br">
          ready
        </PaneOverlay>
      </div>
    </Pane>,
  );
  const field = container.querySelector("[data-slot='pane-field']")!;
  const floaters = [...field.querySelectorAll("[data-slot='floater']")];
  expect(floaters).toHaveLength(3);
  expect(floaters.every((node) => node.parentElement === field)).toBe(true);
  expect(field.querySelectorAll("[data-slot='floater-grip']")).toHaveLength(3);
  expect(field.querySelectorAll("[data-slot='floater-resize']")).toHaveLength(3);
  const body = field.querySelector<HTMLElement>("[data-readout-body]")!;
  const wheel = new WheelEvent("wheel", { deltaY: 20, bubbles: true, cancelable: true });
  fireEvent(body, wheel);
  expect(wheel.defaultPrevented).toBe(true);
  expect(body.scrollTop).toBe(20);
  fireEvent.pointerDown(screen.getByText("facts"));
  fireEvent.click(screen.getByRole("button", { name: "Clear the selection · Esc" }));
  expect(clear).toHaveBeenCalledOnce();
});

it("faults reach the application's single injected sink", () => {
  const fault = vi.fn();
  const error = new Error("failed subject");
  function Broken(): never {
    throw error;
  }
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <PaneFaultProvider onFault={fault}>
      <Pane>
        <Broken />
      </Pane>
    </PaneFaultProvider>,
  );
  expect(fault).toHaveBeenCalledWith(error);
  expect(screen.getByRole("alert").textContent).toContain("failed subject");
});

it("a split infers support for a side without grow", () => {
  const { container } = render(
    <PaneSplit
      axis="horizontal"
      start={<div>navigation</div>}
      end={<PaneSplit axis="vertical" grow start="subject" end={null} />}
    />,
  );
  expect(screen.getByText("navigation").parentElement?.dataset.surface).toBe("support");
  const outer = container.querySelector("[data-slot='pane-split']")!;
  expect(outer.querySelectorAll(":scope > [data-surface='support']")).toHaveLength(1);
});

it("button groups collapse glyph labels by available width and restore them when space returns", () => {
  let resize = () => {};
  let width = 300;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    gap: "4px",
    getPropertyValue: () => "24px",
  } as unknown as CSSStyleDeclaration);
  const { container, unmount } = render(
    <ButtonGroup>
      <Button icon={X} label="clear">
        clear
      </Button>
      <Button label="fit">fit</Button>
    </ButtonGroup>,
  );
  const group = container.querySelector(".dl-button-group")!;
  expect(group.hasAttribute("data-icon-labels")).toBe(false);
  width = 80;
  act(resize);
  expect(group.hasAttribute("data-icon-labels")).toBe(true);
  width = 300;
  act(resize);
  expect(group.hasAttribute("data-icon-labels")).toBe(false);
  unmount();
  expect(disconnect).toHaveBeenCalled();
});
