// @vitest-environment jsdom
import { Activity, useState } from "react";
import { act, render, cleanup } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { HostedChrome } from "#/route/hosted-chrome";
import { Button } from "@pe/kit/lang/button";
import {
  PrimaryRouteControls,
  RouteControlsProvider,
  RouteControlsSlot,
  useSituationSignal,
  usePagePaletteOpen,
  usePalette,
  usePublishPagePalette,
} from "./route-controls";
import { ChainLamp } from "#/route/situation-lamp";
import type { RouteHandle } from "#/route/use-route";

vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: "/family" } }),
}));
afterEach(cleanup);

test("only the visible primary route supplies the global control slot", () => {
  const tree = (mode: "visible" | "hidden") => (
    <RouteControlsProvider>
      <div data-testid="global">
        <RouteControlsSlot />
      </div>
      <Activity mode={mode}>
        <div data-testid="primary">
          <PrimaryRouteControls route="family">
            <Button label="Scoped help">Scoped help</Button>
          </PrimaryRouteControls>
        </div>
      </Activity>
      <HostedChrome value={<span>Hosted pane</span>}>
        <div data-testid="hosted">
          <PrimaryRouteControls route="family">
            <Button label="Hosted help">Hosted help</Button>
          </PrimaryRouteControls>
        </div>
      </HostedChrome>
    </RouteControlsProvider>
  );
  const view = render(tree("visible"));
  expect(view.getByTestId("global").textContent).toBe("Scoped help");
  expect(view.getByTestId("primary").textContent).toBe("");
  expect(view.getByTestId("hosted").textContent).toBe("Hosted help");
  view.rerender(tree("hidden"));
  expect(view.getByTestId("global").textContent).toBe("");
  view.rerender(tree("visible"));
  expect(view.getByTestId("global").textContent).toBe("Scoped help");
});

test("standalone route controls remain local without an app bar", () => {
  const view = render(
    <PrimaryRouteControls route="family">
      <Button label="Local help">Local help</Button>
    </PrimaryRouteControls>,
  );
  expect(view.getByText("Local help")).toBeTruthy();
});

test("the one lamp publisher reports archive, unbound, ready, running and refusal and clears hidden owners", () => {
  const handle = {
    manifest: { key: "family" },
    resolution: { kind: "bound" },
    failure: null,
    busy: null,
  } as unknown as RouteHandle<any, any, any, any>;
  function Witness() {
    const signal = useSituationSignal();
    return (
      <output data-testid="signal" data-tone={signal?.tone} data-kind={signal?.kind}>
        {signal?.title}
      </output>
    );
  }
  const tree = (
    inspection: boolean,
    document: string | null,
    failure = false,
    busy = false,
    mode: "visible" | "hidden" = "visible",
    health: string | null = null,
  ) => (
    <RouteControlsProvider>
      <Witness />
      <Activity mode={mode}>
        <ChainLamp
          handle={
            {
              ...handle,
              failure: failure ? { message: "Permission refused", cells: [] } : null,
              busy: busy ? { key: "read", seconds: 1 } : null,
            } as typeof handle
          }
          inspection={inspection}
          health={health}
          stageWord={inspection ? "Archived" : "Current"}
          session={document ? "session-one" : null}
          document={document}
        />
      </Activity>
      <HostedChrome value={<span>Hosted</span>}>
        <ChainLamp handle={handle} inspection session="hosted" document="Foreign document" />
      </HostedChrome>
    </RouteControlsProvider>
  );
  const view = render(tree(true, "Saved model"));
  const signal = view.getByTestId("signal");
  expect(signal.getAttribute("data-kind")).toBe("archived");
  expect(signal.getAttribute("data-tone")).toBe("nav");
  expect(signal.textContent).toContain("Saved observation");
  expect(signal.textContent).not.toContain("session-one");
  view.rerender(tree(false, null));
  expect(signal.getAttribute("data-kind")).toBe("unbound");
  expect(signal.getAttribute("data-tone")).toBe("caution");
  view.rerender(tree(false, "Bound model"));
  expect(signal.getAttribute("data-kind")).toBe("ready");
  expect(signal.getAttribute("data-tone")).toBe("done");
  view.rerender(tree(false, "Bound model", false, false, "visible", "Needs initialization"));
  expect(signal.getAttribute("data-kind")).toBe("health");
  expect(signal.getAttribute("data-tone")).toBe("caution");
  expect(signal.textContent).toContain("Needs initialization");
  view.rerender(tree(false, "Bound model", false, true));
  expect(signal.getAttribute("data-kind")).toBe("busy");
  expect(signal.getAttribute("data-tone")).toBe("commit");
  view.rerender(tree(false, "Bound model", true));
  expect(signal.getAttribute("data-kind")).toBe("failure");
  expect(signal.getAttribute("data-tone")).toBe("caution");
  expect(signal.textContent).toContain("Permission refused");
  view.rerender(tree(false, "Bound model", false, false, "hidden"));
  expect(signal.getAttribute("data-kind")).toBeNull();
  expect(signal.textContent).toBe("");
});

test("only a visible primary page picker publishes a hold and releases it on close or hide", () => {
  function Picker({ open }: { open: boolean }) {
    usePublishPagePalette("family", open, () => {});
    return null;
  }
  function Witness() {
    return <output data-testid="palette-hold">{String(usePagePaletteOpen())}</output>;
  }
  const tree = (open: boolean, mode: "visible" | "hidden" = "visible") => (
    <RouteControlsProvider>
      <Witness />
      <Activity mode={mode}>
        <Picker open={open} />
      </Activity>
      <HostedChrome value={<span>Hosted</span>}>
        <Picker open />
      </HostedChrome>
    </RouteControlsProvider>
  );
  const view = render(tree(false));
  expect(view.getByTestId("palette-hold").textContent).toBe("false");
  view.rerender(tree(true));
  expect(view.getByTestId("palette-hold").textContent).toBe("true");
  view.rerender(tree(true, "hidden"));
  expect(view.getByTestId("palette-hold").textContent).toBe("false");
  view.rerender(tree(true));
  expect(view.getByTestId("palette-hold").textContent).toBe("true");
  view.rerender(tree(false));
  expect(view.getByTestId("palette-hold").textContent).toBe("false");
});

test("one palette is open at a time: global closes the page palette and a page palette closes global", () => {
  let palette: ReturnType<typeof usePalette> | undefined;
  let openPage: (open: boolean) => void = () => {};
  function Page() {
    const [open, setOpen] = useState(false);
    openPage = setOpen;
    usePublishPagePalette("family", open, setOpen);
    return <output data-testid="page">{String(open)}</output>;
  }
  function Shell() {
    palette = usePalette();
    return <output data-testid="open">{String(palette.open)}</output>;
  }
  const view = render(
    <RouteControlsProvider>
      <Shell />
      <Page />
    </RouteControlsProvider>,
  );
  expect(view.getByTestId("open").textContent).toBe("null");
  act(() => openPage(true));
  expect(view.getByTestId("open").textContent).toBe("page");
  act(() => palette!.show("global"));
  expect(view.getByTestId("open").textContent).toBe("global");
  expect(view.getByTestId("page").textContent).toBe("false");
  act(() => openPage(true));
  expect(view.getByTestId("open").textContent).toBe("page");
  act(() => palette!.show("page"));
  expect(view.getByTestId("page").textContent).toBe("true");
  act(() => palette!.hide());
  expect(view.getByTestId("open").textContent).toBe("null");
  expect(view.getByTestId("page").textContent).toBe("false");
});
