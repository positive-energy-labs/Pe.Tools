// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import {
  RouteControlsProvider,
  PrimaryRouteControls,
  SituationPinnedControl,
  usePublishPagePalette,
} from "./route-controls";
import { SituationDrawer } from "./situation-drawer";
import { SituationAction } from "#/route/situation-verbs";
import type { RouteHandle, ActionHandle } from "#/route/use-route";

vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: "/family" } }),
}));
afterEach(cleanup);

test("hover, pin and Escape fold a mounted body without resetting its local state", async () => {
  const mounts = vi.fn();
  function Body() {
    const [count, setCount] = useState(0);
    useEffect(mounts, []);
    return (
      <Button label="Count" onClick={() => setCount((n) => n + 1)}>
        Count {count}
      </Button>
    );
  }
  render(
    <RouteControlsProvider>
      <nav className="pe-appbar">
        <SituationDrawer />
      </nav>
      <SituationPinnedControl />
      <PrimaryRouteControls route="family" slot="situation">
        <Body />
      </PrimaryRouteControls>
    </RouteControlsProvider>,
  );
  const trigger = await screen.findByRole("button", { name: "Show Situation" });
  const drawer = document.getElementById("pe-situation-drawer")!;
  const body = drawer.querySelector("button");
  const portal = drawer.parentElement;
  expect(drawer.getAttribute("data-state")).toBe("closed");
  fireEvent.pointerOver(trigger);
  await waitFor(() => expect(drawer.getAttribute("data-state")).toBe("open"));
  fireEvent.click(screen.getByRole("button", { name: "Count" }));
  fireEvent.click(trigger);
  await waitFor(() => expect(drawer.getAttribute("data-mode")).toBe("pinned"));
  expect(portal?.parentElement?.className).toBe("pe-situation-dock");
  expect(drawer.querySelector("button")).toBe(body);
  fireEvent.pointerLeave(screen.getByRole("navigation"));
  await new Promise((resolve) => setTimeout(resolve, 180));
  expect(drawer.getAttribute("data-state")).toBe("open");
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(drawer.getAttribute("data-state")).toBe("closed"));
  expect(portal?.parentElement).toBe(document.body);
  expect(drawer.querySelector("button")).toBe(body);
  expect(drawer.hasAttribute("inert")).toBe(true);
  fireEvent.focus(trigger);
  await waitFor(() => expect(drawer.getAttribute("data-state")).toBe("open"));
  expect(screen.getByText("Count 1")).toBeTruthy();
  expect(mounts).toHaveBeenCalledTimes(1);
});

test("the whole bar opens Situation except editing controls and drawer padding keeps it open", async () => {
  render(
    <RouteControlsProvider>
      <nav className="pe-appbar">
        <span data-testid="bar-space">Product</span>
        <Input aria-label="Bar filter" />
        <SituationDrawer />
      </nav>
      <PrimaryRouteControls route="family" slot="situation">
        Situation body
      </PrimaryRouteControls>
    </RouteControlsProvider>,
  );
  await screen.findByRole("button", { name: "Show Situation" });
  const drawer = document.getElementById("pe-situation-drawer")!;
  fireEvent.pointerOver(screen.getByRole("textbox", { name: "Bar filter" }));
  expect(drawer.getAttribute("data-state")).toBe("closed");
  fireEvent.pointerOver(screen.getByTestId("bar-space"));
  await waitFor(() => expect(drawer.getAttribute("data-state")).toBe("open"));
  fireEvent.pointerLeave(screen.getByRole("navigation"));
  fireEvent.pointerEnter(drawer);
  await new Promise((resolve) => setTimeout(resolve, 340));
  expect(drawer.getAttribute("data-state")).toBe("open");
  fireEvent.pointerLeave(drawer);
  await new Promise((resolve) => setTimeout(resolve, 180));
  expect(drawer.getAttribute("data-state")).toBe("open");
  await waitFor(() => expect(drawer.getAttribute("data-state")).toBe("closed"));
});

test("native drawer entry into nested route portal background owns hover across logical React boundaries", async () => {
  render(
    <RouteControlsProvider>
      <nav className="pe-appbar">
        <SituationDrawer />
      </nav>
      <span data-testid="outside">Outside</span>
      <PrimaryRouteControls route="family" slot="situation">
        <div data-testid="portalled-background">
          <Input aria-label="Situation filter" />
        </div>
      </PrimaryRouteControls>
    </RouteControlsProvider>,
  );
  const trigger = await screen.findByRole("button", { name: "Show Situation" });
  const bar = screen.getByRole("navigation");
  const drawer = document.getElementById("pe-situation-drawer")!;
  fireEvent.pointerOver(trigger);
  await waitFor(() => expect(drawer.getAttribute("data-state")).toBe("open"));
  // Native pointerenter is non-bubbling. React synthesizes enter from pointerover and
  // cannot discover this DOM boundary through the route body's separate portal owner.
  act(() => {
    bar.dispatchEvent(new MouseEvent("pointerleave", { relatedTarget: null }));
    drawer.dispatchEvent(new MouseEvent("pointerenter", { relatedTarget: bar }));
  });
  fireEvent.pointerOver(screen.getByTestId("portalled-background"));
  fireEvent.pointerOver(screen.getByRole("textbox", { name: "Situation filter" }));
  await new Promise((resolve) => setTimeout(resolve, 650));
  expect(drawer.getAttribute("data-state")).toBe("open");
  act(() => drawer.dispatchEvent(new MouseEvent("pointerleave", { relatedTarget: bar })));
  await new Promise((resolve) => setTimeout(resolve, 650));
  expect(drawer.getAttribute("data-state")).toBe("open");
  act(() =>
    bar.dispatchEvent(
      new MouseEvent("pointerleave", { relatedTarget: screen.getByTestId("outside") }),
    ),
  );
  await waitFor(() => expect(drawer.getAttribute("data-state")).toBe("closed"));
});

test("a picker opened from the drawer holds it while focus moves into its body portal", async () => {
  function Body() {
    return (
      <Popover.Root>
        <Popover.Trigger render={<Button label="Pick document">Pick document</Button>} />
        <Popover.Portal>
          <Popover.Positioner>
            <Popover.Popup>
              <Input aria-label="Portal document filter" />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    );
  }
  render(
    <RouteControlsProvider>
      <nav className="pe-appbar">
        <SituationDrawer />
      </nav>
      <PrimaryRouteControls route="family" slot="situation">
        <Body />
      </PrimaryRouteControls>
    </RouteControlsProvider>,
  );
  const trigger = await screen.findByRole("button", { name: "Show Situation" });
  fireEvent.pointerOver(trigger);
  fireEvent.click(await screen.findByRole("button", { name: "Pick document" }));
  const input = await screen.findByRole("textbox", { name: "Portal document filter" });
  fireEvent.focus(input);
  fireEvent.pointerLeave(screen.getByRole("navigation"));
  await new Promise((resolve) => setTimeout(resolve, 180));
  expect(screen.getByRole("region", { name: "Situation drawer" }).getAttribute("data-state")).toBe(
    "open",
  );
});
test("a background outcome cannot reveal a closed drawer or leak its body-portalled flag", async () => {
  const action = {
    label: "Read",
    says: "Read the model",
    count: null,
    refusal: null,
    run: vi.fn(),
  } as unknown as ActionHandle;
  const handle = {
    manifest: { key: "family", actions: {} },
    readings: {},
    work: { changed: false },
    busy: null,
    outcome: { key: "read", at: 1, refusal: { message: "A saved refusal", cells: [] } },
    stop: vi.fn(),
  } as unknown as RouteHandle<any, any, any, any>;
  render(
    <RouteControlsProvider>
      <nav className="pe-appbar">
        <SituationDrawer />
      </nav>
      <PrimaryRouteControls route="family" slot="situation">
        <SituationAction handle={handle} name="read" action={action} />
      </PrimaryRouteControls>
    </RouteControlsProvider>,
  );
  const trigger = await screen.findByRole("button", { name: "Show Situation" });
  expect(document.getElementById("pe-situation-drawer")!.getAttribute("data-state")).toBe("closed");
  expect(screen.queryByText("A saved refusal")).toBeNull();
  fireEvent.pointerOver(trigger);
  await screen.findByText("A saved refusal");
});

test("the real page picker opens an unpinned Situation, owns first Escape and releases its hold", async () => {
  function Body() {
    const [open, setOpen] = useState(false);
    usePublishPagePalette("family", open, setOpen);
    return (
      <>
        <Button label="Open page picker" onClick={() => setOpen(true)}>
          Open picker
        </Button>
        <PrimaryRouteControls route="family" slot="situation">
          <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger render={<Button label="Page picker">Page picker</Button>} />
            <Popover.Portal>
              <Popover.Positioner>
                <Popover.Popup>
                  <Input aria-label="Page picker filter" />
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        </PrimaryRouteControls>
      </>
    );
  }
  render(
    <RouteControlsProvider>
      <nav className="pe-appbar">
        <SituationDrawer />
      </nav>
      <SituationPinnedControl />
      <Body />
    </RouteControlsProvider>,
  );
  const trigger = await screen.findByRole("button", { name: "Show Situation" });
  const drawer = document.getElementById("pe-situation-drawer")!;
  expect(drawer.getAttribute("data-state")).toBe("closed");
  fireEvent.click(screen.getByRole("button", { name: "Open page picker" }));
  const input = await screen.findByRole("textbox", { name: "Page picker filter" });
  await waitFor(() => expect(drawer.getAttribute("data-state")).toBe("open"));
  expect(drawer.getAttribute("data-mode")).toBe("floating");
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("textbox", { name: "Page picker filter" })).toBeNull(),
  );
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(drawer.getAttribute("data-state")).toBe("closed"));
  fireEvent.click(trigger);
  expect(drawer.getAttribute("data-mode")).toBe("pinned");
  fireEvent.click(screen.getByRole("button", { name: "Open page picker" }));
  const pinnedInput = await screen.findByRole("textbox", { name: "Page picker filter" });
  fireEvent.keyDown(pinnedInput, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("textbox", { name: "Page picker filter" })).toBeNull(),
  );
  expect(drawer.getAttribute("data-mode")).toBe("pinned");
  expect(drawer.getAttribute("data-state")).toBe("open");
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(drawer.getAttribute("data-state")).toBe("closed"));
  expect(drawer.getAttribute("data-mode")).toBe("floating");
});
