// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { module as systems } from "../../../../products/duct-systems/web/route.ts";
// Compile the real pane and overlay before timing the mount's loading boundary.
import "../route/slots/picture/pane.tsx";
import "@pe/duct-systems-web/screen/screen";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { mountTypedRoute } from "./typed-mount";
import { TypedChrome } from "./typed-shell";
import { StandaloneBand } from "./band.test-support";
import { PaneActionSlots } from "./pane-actions";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";

afterEach(() => {cleanup(); vi.unstubAllGlobals();});
test("Systems fixture Picture finishes loading its drawing", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("localStorage", {getItem: () => null, setItem() {}});
  const search = new URLSearchParams({ fixture: "navigation", system: JSON.stringify({kind:"ids",ids:["system-name:SA Lab"]}) });
  const mount = mountTypedRoute(systems, {
    address: { read: () => search, write() {}, subscribe: () => () => {} },
    fixture: "navigation", target: {kind:"host"}, work: {address:null,open:null},
    custody: {current: () => true}, memory: () => ({}),
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`));
  function Panel() {
    useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
    return <StandaloneBand><PaneActionSlots><TypedChrome mount={mount} document={null} /></PaneActionSlots></StandaloneBand>;
  }
  try {
    const router = createRouter({routeTree:createRootRoute({component:Panel}), history:createMemoryHistory()});
    await router.load();
    const page = render(<RouterProvider router={router} />);
    await waitFor(() => expect(page.getByRole("button", {name: /^centrelines$/i})).toBeTruthy(), {timeout:5000});
    expect(page.getByRole("button", {name: /^centrelines$/i}).getAttribute("aria-disabled")).not.toBe("true");
    expect(document.body.textContent).not.toContain("Loading drawing");
  } finally { cleanup(); mount.dispose(); }
});
