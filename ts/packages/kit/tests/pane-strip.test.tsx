// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { KeyScope, readKeyMeta, readRegistrations } from "@pe/kit/keys";

import { Pane, PictureContext } from "@pe/kit/lang/pane";
import { PictureReadout } from "@pe/kit/lang/readout";
import { Popover, PopoverTrigger, SubjectPopoverContent } from "@pe/kit/lang/popover";
import { Switcher } from "@pe/kit/lang/switcher";
import { readTeaching } from "@pe/kit/lang/teach";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("a picture pane derives its crumb and supplies away-side geometry to a sibling popup", async () => {
  const box = () => new DOMRect(100, 100, 200, 200);
  const content = (selected: boolean) => (
    <>
      <PictureContext value={{ selected, box }}>
        <Pane picture title="Systems" legend={null}>
          <PictureReadout subject="Supply air" title={selected ? "Room A" : undefined}>
            facts
          </PictureReadout>
        </Pane>
      </PictureContext>
      <Pane title="list">
        <Popover>
          <PopoverTrigger>open facts</PopoverTrigger>
          <SubjectPopoverContent>subject facts</SubjectPopoverContent>
        </Popover>
      </Pane>
    </>
  );
  const view = render(content(true));
  const crumb = screen.getByRole("group", { name: "scope and selection" });
  expect(crumb.textContent).toBe("SystemsSupply airRoom A");
  const trigger = screen.getByRole("button", { name: "open facts" });
  vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue(new DOMRect(50, 150, 20, 20));
  fireEvent.click(trigger);
  const popup = await screen.findByText("subject facts");
  expect(popup.closest("[data-slot='popover-content']")?.getAttribute("data-side")).toBe("left");
  view.rerender(content(false));
  expect(crumb.textContent).toBe("SystemsSupply air");
  view.unmount();
  expect(document.querySelector("[data-slot='popover-content']")).toBeNull();
});

const modes = (onChange = vi.fn()) => ({
  value: "plan",
  label: "view",
  onChange,
  options: [
    { key: "plan", label: "plan", chord: "1" as const, says: "Look straight down." },
    { key: "iso", label: "iso", chord: "2" as const },
  ],
});

test("folded controls teach their choices through the live trigger and withdraw with their owner", async () => {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.closest('[data-slot="popover-content"], [hidden]')
        ? new DOMRect()
        : new DOMRect(0, 0, 400, 600);
    },
  );
  const page = (value: string) => (
    <PictureContext
      value={{
        selected: false,
        box: () => null,
        projection: (
          <Switcher
            ariaLabel="projection"
            value={value}
            onChange={vi.fn()}
            options={[
              { value: "parallel", label: "parallel", title: "Measured" },
              { value: "perspective", label: "perspective", title: "Depth" },
            ]}
          />
        ),
      }}
    >
      <Pane
        picture
        title="Systems"
        legend={null}
        layers={{ value: ["grid"], options: [{ key: "grid", label: "grid" }], onToggle: vi.fn() }}
      >
        body
      </Pane>
    </PictureContext>
  );
  const view = render(page("parallel"));
  expect(view.container.querySelector('[data-slot="pane-strip"]')?.getAttribute("data-fold")).toBe(
    "4",
  );
  expect(screen.queryByRole("button", { name: "parallel" })).toBeNull();
  const projection = () =>
    readTeaching().find((f) => f.kind === "modes" && f.label === "projection");
  await waitFor(() =>
    expect(projection()).toMatchObject({
      options: [
        { key: "parallel", active: true },
        { key: "perspective", active: false },
      ],
    }),
  );
  expect(readTeaching().find((f) => f.kind === "views")).toMatchObject({
    options: [{ key: "grid", active: true }],
  });
  view.rerender(page("perspective"));
  await waitFor(() =>
    expect(projection()).toMatchObject({
      options: [
        { key: "parallel", active: false },
        { key: "perspective", active: true },
      ],
    }),
  );
  view.container.hidden = true;
  await waitFor(() => expect(readTeaching()).toEqual([]));
  view.container.hidden = false;
  await waitFor(() => expect(projection()).toBeTruthy());
  view.unmount();
  expect(readTeaching()).toEqual([]);
});

/** The live registrations this pane's scope node made, as Help reads them. */
const bound = (scope: string) =>
  readRegistrations().flatMap((reg) => {
    const meta = readKeyMeta(reg.options.meta);
    return meta?.scope === scope && reg.options.enabled !== false
      ? [{ hotkey: reg.hotkey, ...meta }]
      : [];
  });

test("modes are exclusive: one pressed, a press asks for the other", () => {
  const onChange = vi.fn();
  render(
    <Pane id="canvas" title="canvas" modes={modes(onChange)}>
      body
    </Pane>,
  );
  const group = screen.getByRole("group", { name: "view" });
  const pressed = [...group.querySelectorAll("button")].map((b) => b.getAttribute("aria-pressed"));
  expect(pressed).toEqual(["true", "false"]);
  fireEvent.click(screen.getByRole("button", { name: "iso" }));
  expect(onChange).toHaveBeenCalledWith("iso");
});

test("a chord on a mode, floater or layer registers on the pane's node with its label and says", () => {
  const onOpenChange = vi.fn();
  render(
    <Pane
      id="canvas"
      title="canvas"
      modes={modes()}
      floaters={[
        {
          key: "map",
          kind: "picture",
          label: "minimap",
          chord: "M",
          says: "Show the whole field.",
          place: "br",
          open: false,
          onOpenChange,
          render: () => null,
        },
      ]}
      layers={{
        value: ["grid"],
        onToggle: vi.fn(),
        options: [{ key: "grid", label: "grid", chord: "G" }],
      }}
    >
      body
    </Pane>,
  );
  const keys = bound("canvas");
  expect(keys.map((k) => k.hotkey).sort()).toEqual(["1", "2", "G", "M"]);
  expect(keys.find((k) => k.hotkey === "1")).toMatchObject({
    name: "plan",
    description: "Look straight down.",
    refusal: null,
  });
  expect(keys.find((k) => k.hotkey === "M")?.description).toBe("Show the whole field.");
  expect(screen.getByRole("button", { name: "minimap" }).getAttribute("aria-pressed")).toBe(
    "false",
  );
  expect(screen.getByRole("button", { name: "grid" }).getAttribute("aria-pressed")).toBe("true");
});

test("an open floater draws over the body and Esc inside it closes it", () => {
  const onOpenChange = vi.fn();
  render(
    <Pane
      id="canvas"
      title="canvas"
      floaters={[
        {
          key: "map",
          kind: "picture",
          label: "minimap",
          place: "tr",
          open: true,
          onOpenChange,
          render: () => "field",
        },
      ]}
    >
      body
    </Pane>,
  );
  const floater = screen.getByRole("region", { name: "minimap" });
  expect(floater.parentElement?.getAttribute("data-slot")).toBe("pane-field");
  expect(bound("floater:map").map((k) => k.hotkey)).toEqual(["Escape"]);
  floater.focus();
  fireEvent.keyDown(floater, { key: "Escape" });
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("a hidden pane registers nothing", () => {
  render(
    <KeyScope id="route" hidden>
      <Pane id="canvas" title="canvas" modes={modes()}>
        body
      </Pane>
    </KeyScope>,
  );
  expect(
    readRegistrations().filter((reg) => readKeyMeta(reg.options.meta)?.scope === "canvas"),
  ).toEqual([]);
});

test("an overflowing trail folds layers and floaters into popovers, shortens modes, keeps chords", () => {
  // jsdom lays nothing out: the trail reports more content than room at every fold.
  const scroll = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(500);
  const client = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  render(
    <Pane
      id="canvas"
      title="canvas"
      modes={modes()}
      floaters={[
        {
          key: "map",
          kind: "picture",
          label: "minimap",
          chord: "M",
          place: "br",
          open: true,
          onOpenChange: vi.fn(),
          render: () => null,
        },
      ]}
      layers={{
        value: ["grid"],
        onToggle: vi.fn(),
        options: [{ key: "grid", label: "grid", chord: "G" }],
      }}
    >
      body
    </Pane>,
  );
  scroll.mockRestore();
  client.mockRestore();
  expect(screen.getByRole("button", { name: "layers 1/1" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "floaters 1/1" })).toBeTruthy();
  expect(screen.queryByRole("group", { name: "layers" })).toBeNull();
  expect(screen.getByRole("button", { name: "plan" }).textContent).toBe("pplan");
  expect(screen.getByRole("heading", { name: "canvas" })).toBeTruthy();
  expect(
    bound("canvas")
      .map((k) => k.hotkey)
      .sort(),
  ).toEqual(["1", "2", "G", "M"]);
});

test.each(["rail-lead", "pane-title"])(
  "%s overflow folds the strip even when the actions fit",
  (slot) => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute("data-slot") === slot ? 240 : 100;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
    const { container } = render(
      <Pane id="space" title="Space" meta="a long model reading" modes={modes()}>
        body
      </Pane>,
    );
    expect(container.querySelector("[data-slot='pane-strip']")?.getAttribute("data-fold")).toBe(
      "4",
    );
    expect(screen.getByRole("heading", { name: "Space" })).toBeTruthy();
    expect(bound("space").map((key) => key.hotkey)).toEqual(["1", "2"]);
  },
);
