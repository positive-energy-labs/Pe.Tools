// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { waitFor } from "@testing-library/react";
import { createReadingGraph, type ReadingScope } from "#/shell/readings";
import { ductsGraph, ductsPageSchema, type DuctsPage } from "./graph";
import { ductsSources, type SheetReading } from "./sources";
import { DuctsHostFixture } from "./host.fixture";
import { ductsRouteState, type DuctsRouteDocument } from "@pe/agent-contracts";

let host: DuctsHostFixture;
const releases: (() => void)[] = [];
beforeEach(() => {
  host = new DuctsHostFixture();
  vi.stubGlobal("EventSource", host.source());
  vi.stubGlobal("fetch", host.fetch);
  vi.stubGlobal("Worker", host.worker);
});
afterEach(async () => {
  for (const release of releases.splice(0).reverse()) release();
  await new Promise((resolve) => setTimeout(resolve, 30));
  vi.unstubAllGlobals();
});
function fixture() {
  const scope: ReadingScope<DuctsPage, DuctsRouteDocument> = {
    target: { kind: "document", ref: { session: "s", openId: "d" } },
    workKey: { binding: "open", route: "ducts", target: null, open: { session: "s", openId: "d" } },
    workRevision: host.revision,
    work: host.doc,
    settings: { terminalFlow: "PE_M_Grd_AirFlow" },
    page: ductsPageSchema.parse({ system: ["SA"] }),
  };
  const logs: unknown[] = [];
  const graph = createReadingGraph(ductsGraph, {
    scope,
    sources: ductsSources(),
    log: (entry) => logs.push(entry),
  });
  releases.push(() => graph.dispose());
  return { scope, graph, logs };
}
test("subscription bodies and the pricing worker answer the exact Work; only slot settings reacquire networks", async () => {
  const { graph, scope } = fixture();
  releases.push(graph.mount(["pricing"]));
  await waitFor(() => expect(graph.get("pricing").current).toBe(true));
  expect(host.pricingRequests[0]!.input.base).toBeTruthy();
  expect(graph.get("pricing").basis?.workRevision).toBe(1);
  expect(
    host.requests
      .filter((request) => request.key === "ducts.snapshot")
      .every((request) => !!request.request.selector),
  ).toBe(true);
  const count = () => host.requests.filter((request) => request.key === "ducts.snapshot").length;
  const before = count();
  graph.update({
    ...scope,
    workRevision: 2,
    work: ductsRouteState.schema.parse({ flows: { "4": { edit: { value: { cfm: 140 } } } } }),
  });
  await waitFor(() => expect(graph.get("pricing").basis?.workRevision).toBe(2));
  expect(host.pricingRequests.at(-1)!.input.base).toBeUndefined();
  expect(count()).toBe(before);
  graph.update({
    ...scope,
    workRevision: 3,
    work: ductsRouteState.schema.parse({}),
    settings: { terminalFlow: "Design CFM" },
  });
  await waitFor(() =>
    expect(
      host.requests.some(
        (request) =>
          (request.request.slots as { terminalFlow?: string } | undefined)?.terminalFlow ===
          "Design CFM",
      ),
    ).toBe(true),
  );
  await waitFor(() => expect(graph.get("pricing").basis?.workRevision).toBe(3));
});
test("the fan source pins detail to one overview basis and never writes Work from a Reading", async () => {
  const { graph, scope } = fixture();
  releases.push(graph.mount(["sheet"]));
  await waitFor(() => expect(graph.get("sheet").current).toBe(true));
  graph.update({
    ...scope,
    page: { ...scope.page, stage: "sheet", fanPort: { unitId: 14577391, portIndex: 2 } },
  });
  await waitFor(() =>
    expect((graph.get("sheet").value as SheetReading | undefined)?.open?.worksheet).toBeTruthy(),
  );
  const value = graph.get("sheet").value as SheetReading;
  expect(value.open?.inputs).not.toBeNull();
  const requests = host.requests.filter((request) => request.key === "sheet");
  expect(
    requests
      .filter((request) => !!request.request.detail)
      .every((request) => request.request.basis === value.open!.overview.basis),
  ).toBe(true);
  expect(requests.every((request) => !request.request.inputs && !request.request.proposal)).toBe(
    true,
  );
  expect(host.writes).toEqual([]);
});
test("stale sheet detail is a failure boundary with no current detail, without a blind retry", async () => {
  host.failSheetDetail = true;
  const { graph, scope } = fixture();
  releases.push(graph.mount(["sheet"]));
  await waitFor(() => expect(graph.get("sheet").current).toBe(true));
  graph.update({
    ...scope,
    page: { ...scope.page, stage: "sheet", fanPort: { unitId: 14577391, portIndex: 2 } },
  });
  await waitFor(() => expect(graph.get("sheet").status).toBe("failed"));
  expect(graph.get("sheet").current).toBe(false);
  expect(graph.get("sheet").error).toMatch(/Stale sheet basis/);
  expect(
    host.requests.filter((request) => request.key === "sheet" && !request.request.detail),
  ).toHaveLength(1);
});
