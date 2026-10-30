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
test("subscription bodies and the pricing worker answer the exact Work; only parameter edits reacquire networks", async () => {
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
  expect(
    host.requests
      .filter((request) => request.key === "ducts.snapshot")
      .map((request) => request.request.selector),
  ).toEqual([{ kind: "roster" }, { kind: "systems", systemIds: [900] }]);
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
    work: ductsRouteState.schema.parse({
      parameters: Object.fromEntries(
        [
          "terminalFlow",
          "fanFlow",
          "fanStatic",
          "terminalDrop",
          "componentDrop",
          "fittingCoefficient",
        ].map((key) => [
          key,
          { edit: { value: key === "terminalFlow" ? "Design CFM" : `Project ${key}` } },
        ]),
      ),
    }),
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
  expect(
    host.requests.filter((request) => request.key === "ducts.snapshot").at(-1)?.request.slots,
  ).toEqual({
    terminalFlow: "Design CFM",
    fanFlow: "Project fanFlow",
    fanStatic: "Project fanStatic",
    terminalDrop: "Project terminalDrop",
    componentDrop: "Project componentDrop",
    fittingCoefficient: "Project fittingCoefficient",
  });
});
test("the fan source pins detail to one overview basis and never writes Work from a Reading", async () => {
  const { graph, scope } = fixture();
  releases.push(graph.mount(["sheet"]));
  await waitFor(() => expect(graph.get("sheet").current).toBe(true));
  graph.update({
    ...scope,
    page: { ...scope.page, stage: "sheet", fan: "14577391:2" },
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
    page: { ...scope.page, stage: "sheet", fan: "14577391:2" },
  });
  await waitFor(() => expect(graph.get("sheet").status).toBe("failed"));
  expect(graph.get("sheet").current).toBe(false);
  expect(graph.get("sheet").error).toMatch(/Stale sheet basis/);
  expect(
    host.requests.filter((request) => request.key === "sheet" && !request.request.detail),
  ).toHaveLength(1);
});

test("fan reach includes beyond-unit context and a Work edit rereads roster and the open fan", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const response = await host.fetch(input, init);
    if (
      (input instanceof Request ? input.url : input.toString()).endsWith("/pe/ducts/sheet") &&
      typeof init?.body === "string" &&
      JSON.parse(init.body).detail?.kind === "elements"
    ) {
      const body = await response.json();
      return Response.json({
        ...body,
        beyond: [{ unitId: 6105264, mark: "RV-15", elementIds: [999999], cuts: [] }],
      });
    }
    return response;
  });
  vi.stubGlobal("fetch", fetch);
  const { graph, scope } = fixture();
  const page = {
    ...scope.page,
    stage: "sheet" as const,
    fan: "14577391:2",
  };
  graph.update({ ...scope, page });
  releases.push(graph.mount(["sheetSnapshot"]));
  await waitFor(() => expect(graph.get("sheetSnapshot").current).toBe(true));
  const selectors = host.requests
    .filter((r) => r.key === "ducts.snapshot")
    .map((r) => r.request.selector);
  expect(selectors).toEqual([{ kind: "ids", ids: expect.arrayContaining([14577391, 999999]) }]);
  const count = () =>
    fetch.mock.calls.filter(([url]) =>
      (url instanceof Request ? url.url : url.toString()).endsWith("/pe/ducts/roster"),
    ).length;
  expect(count()).toBe(1);
  graph.update({
    ...scope,
    page,
    workRevision: 2,
    work: ductsRouteState.schema.parse({
      criteria: { edit: { value: { splitPolicy: "proportional" } } },
    }),
  });
  await waitFor(() => expect(graph.get("sheet").basis?.workRevision).toBe(2));
  await waitFor(() => expect(graph.get("sheet").current).toBe(true));
  expect(count()).toBe(2);
  expect(host.requests.filter((r) => r.key === "sheet" && !r.request.detail)).toHaveLength(2);
  expect(host.writes).toEqual([]);
});
