// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { module as chat } from "../chat/route";
import { mountTypedRoute } from "../shell/typed-mount";
import { TypedChrome } from "../shell/typed-shell";
import { StandaloneBand } from "../shell/band.test-support";
import { dockChatAddress } from "./hosted-route";
import { WorkbenchProvider } from "./provider";
import { PaneActionSlots } from "../shell/pane-actions";

afterEach(() => {cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, "", "/");});
test.each(["/fans?fixture=scene", "/duct-systems?fixture=navigation"])(
  "Pea beside %s settles with New Thread and keeps the tool fixture", async href => {
    window.history.replaceState({}, "", href);
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("localStorage", {getItem: () => null, setItem() {}});
    const fetch = vi.fn(() => { throw Error("Fixture must not contact the host"); });
    vi.stubGlobal("fetch", fetch);
    let search = new URL(href, "http://pe.local").searchParams;
    const address = dockChatAddress({ read: () => search, write: next => { search = next; }, subscribe: () => () => {} });
    const mount = mountTypedRoute(chat, {
      address, fixture: address.read().get("fixture"), target: { kind: "host" },
      work: { address: null, open: null }, custody: { current: () => true }, memory: () => ({}),
    }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`));
    function Panel() {
      useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
      return <WorkbenchProvider><StandaloneBand><PaneActionSlots><TypedChrome mount={mount} document={null} /></PaneActionSlots></StandaloneBand></WorkbenchProvider>;
    }
    const router = createRouter({ routeTree: createRootRoute({ component: Panel }), history: createMemoryHistory({ initialEntries: [href] }) });
    try {
      await router.load();
      const page = render(<RouterProvider router={router} />);
      await waitFor(() => {
        expect(page.getByRole("button", {name:"New thread"})).toBeTruthy();
        expect(page.getByRole("region", {name:"Threads"}).getAttribute("aria-busy")).not.toBe("true");
        expect(page.getByRole("region", {name:"Threads"}).textContent).not.toContain("Reading");
        expect(mount.value().state).toBe("ready");
      }, {timeout:5000});
      expect(fetch).not.toHaveBeenCalled();
      const next = address.read();
      next.set("thread", "chosen");
      address.write(next, "replace");
      expect(search.get("fixture")).toBe(new URL(href, "http://pe.local").searchParams.get("fixture"));
      expect(search.get("thread")).toBe("chosen");
    } finally { cleanup(); mount.dispose(); }
  },
);
