// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { module as ducts } from "@pe/duct-systems-web/route";
import { calc } from "@pe/fans-web/route";
import { ductsLink } from "@pe/ducts-web/identity";
import { networkFixtures } from "../../../../products/ducts/web/src/fixture-registry.ts";
import { fansCalcData, workFingerprintSchema } from "@pe/agent-contracts";
import { mountTypedRoute } from "./typed-mount";
import { TypedChrome } from "./typed-shell";
import { StandaloneBand } from "./band.test-support";

const closes: (() => void)[] = [];
afterEach(() => { cleanup(); closes.splice(0).forEach(close => close()); vi.unstubAllGlobals(); });
async function arrive(href: string) {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  await import("@pe/duct-systems-web/screen/screen");
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("Fixture called the host"); }));
  const url = new URL(href, "http://pe.local");
  const mount = mountTypedRoute(ducts, {
    fixture: url.searchParams.get("fixture"), target: { kind: "document", ref: { session: "fixture", openId: "clinic" } },
    work: { address: null, open: { session: "fixture", openId: "clinic" } },
    address: { read: () => url.searchParams, write() {}, subscribe: () => () => {} },
    memory: () => ({}), custody: { current: () => true },
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`));
  closes.push(() => mount.dispose());
  const router = createRouter({ routeTree: createRootRoute({ component: () => <StandaloneBand><TypedChrome mount={mount} document={<span>Fixture</span>} /></StandaloneBand> }), history: createMemoryHistory({ initialEntries: [href] }) });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: "Duct settings" });
  expect(document.body.textContent).not.toContain("Missing fixture");
  expect(document.body.textContent).not.toContain("provide is not a function");
}
test.each(Object.keys(networkFixtures))("/ducts resolves registered fixture %s", async name => {
  await arrive(`/ducts?fixture=${name}`);
});
test("MUAS-1 scene fix href reaches a rendering ducts mount", async () => {
  const data = fansCalcData.parse(calc.source.provide!("scene", { fan: "all", sheetPath: "" }).value!.data);
  const fan = data.open!.overview.fan!;
  expect(fan.mark).toBe("MUAS-1");
  await arrive(ductsLink(fan, { fixture: "scene" }));
});
