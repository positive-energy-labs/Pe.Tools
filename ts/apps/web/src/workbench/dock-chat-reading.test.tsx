// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { module as chat } from "../chat/route";
// Load the lazy drawing before timing fixture readiness; this witness measures labels, not compilation.
import "../chat/chat-drawing";
import { mountTypedRoute } from "../shell/typed-mount";
import { TypedChrome } from "../shell/typed-shell";
import { StandaloneBand } from "../shell/band.test-support";
import { dockChatAddress } from "./hosted-route";
import { WorkbenchProvider } from "./provider";
import { PaneActionSlots } from "../shell/pane-actions";
import type { DrawContext } from "@pe/web-kernel/route/typed-route";

afterEach(() => {cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, "", "/");});
test.each([
  ["/fans?fixture=scene", true], ["/duct-systems?fixture=navigation", true],
  ["/fans?fixture=scene", false],
] as const)(
  "Pea beside %s settles and labels fixture origin %s", async (href, demo) => {
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
      // Same document names, but no fixture origin: names must never decide provenance.
      const displayed: typeof mount = demo ? mount : { ...mount, draw: (id, draw) =>
        mount.draw<DrawContext<unknown, never, unknown, unknown>>(id, ctx => draw?.({ ...ctx,
          value: { ...ctx.value, publication: { ...ctx.value.publication, origin: null } },
        } as never)),
      };
      return <WorkbenchProvider><StandaloneBand><PaneActionSlots><TypedChrome mount={displayed} document={null} /></PaneActionSlots></StandaloneBand></WorkbenchProvider>;
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
      expect(mount.value().publication?.origin).toMatchObject({ kind: "fixture" });
      fireEvent.click(page.getByRole("button", { name: "Choose session" }));
      await waitFor(() => {
        const label = page.getByText("pe-app-25-main");
        expect(label.parentElement?.textContent?.includes("Demo")).toBe(demo);
      });
      fireEvent.click(page.getByText("pe-app-25-main"));
      const crumb = await page.findByRole("button", { name: /^pe-app-25-main(?:\s*Demo)?$/ });
      expect(crumb.textContent?.includes("Demo")).toBe(demo);
      const next = address.read();
      next.set("thread", "chosen");
      address.write(next, "replace");
      expect(search.get("fixture")).toBe(new URL(href, "http://pe.local").searchParams.get("fixture"));
      expect(search.get("thread")).toBe("chosen");
    } finally { cleanup(); mount.dispose(); }
  },
);
