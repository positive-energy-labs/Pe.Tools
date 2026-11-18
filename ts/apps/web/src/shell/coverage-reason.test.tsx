// @vitest-environment jsdom
import { test, expect, vi } from "vite-plus/test";
import { render, cleanup } from "@testing-library/react";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { module as fans, calc } from "../../../../products/fans/web/route";
import { calcValueFixtures } from "../../../../products/fans/web/src/calc/value-fixtures";
import { stableFanKey } from "@pe/ducts-web/calc/model";
import { mountTypedRoute } from "./typed-mount";
import { TypedChrome } from "./typed-shell";
import { StandaloneBand } from "./band.test-support";

test.each(["fixture", "unknown", "refused"])("FC-23 coverage reason: %s", async (kind) => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", () => { throw Error("unexpected host read"); });
  const key = stableFanKey(calcValueFixtures.scene!({fan:"all"}).data.rows.find(row => row.mark === "FC-23")!);
  const params = new URLSearchParams({fixture:"scene",fan:JSON.stringify({kind:"ids",ids:[key]})});
  const packet = await calc.source.provide!("scene", {fan:[key],calcPath:""});
  if (kind === "refused") { packet.value!.coverage.unknown = []; packet.value!.coverage.refused = [{keys:[key],reason:"Native fan connector refused"}]; }
  const expected = kind === "fixture" ? "not covered by this fixture" : kind === "unknown" ? "Native coverage could not resolve FC-23" : "Native fan connector refused";
  if (kind === "unknown") packet.reason = expected;
  const module = kind === "fixture" ? fans : {...fans,spec:{...fans.spec,edits:undefined}};
  const mount = mountTypedRoute(module,{fixture:kind === "fixture" ? "scene" : null,target:{kind:"document",ref:{session:"fixture",openId:"clinic"}},work:{address:null,open:{session:"fixture",openId:"clinic"}},address:{read:()=>params,write(){},subscribe:()=>()=>{}},memory:()=>({}),custody:{current:()=>true}},workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),{sources:{[calc.key]:{kind:"use",open(_ctx,deliver){deliver({kind:"complete",value:packet,revision:1});}}}});
  try {
    await vi.waitFor(() => expect(mount.value().state).not.toBe("reading"));
    if (kind !== "fixture") { expect(mount.value()).toMatchObject({state:"stale",reason:expected,value:packet.value!.data}); return; }
    const router = createRouter({routeTree:createRootRoute({component:()=> <StandaloneBand><TypedChrome mount={mount} document={<span>Fixture</span>}/></StandaloneBand>}),history:createMemoryHistory({initialEntries:[`/fans?${params}`]})});
    await router.load(); const view = render(<RouterProvider router={router}/>);
    await vi.waitFor(() => expect(view.container.textContent).toContain(expected));
    expect(view.container.textContent).not.toContain("Incomplete Value");
    if (kind !== "fixture") expect(view.container.textContent).not.toContain("not covered by this fixture");
  } finally { cleanup(); mount.dispose(); vi.unstubAllGlobals(); }
});
