// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { waitFor } from "@testing-library/react";
import { createReadingGraph, type ReadingScope } from "#/shell/readings";
import { ductsGraph, ductsPageSchema, type DuctsPage } from "./graph";
import { ductsSources, type SheetReading } from "./sources";
import sheetFixture from "./sheet/sheet.fixture.json";
import { stableFanKey, selectedFans, fanLabel } from "./sheet/model";
import { manyCodec } from "../../../../packages/agent-contracts/src/route-field";
import { DuctsHostFixture } from "./host.fixture";
import { type DuctsRouteDocument } from "@pe/agent-contracts";

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
test("the fan source pins detail to one overview basis and never writes Work from a Reading", async () => {
  const { graph, scope } = fixture();
  releases.push(graph.mount(["sheet"]));
  await waitFor(() => expect(graph.get("sheet").current).toBe(true));
  graph.update({
    ...scope,
    page: { ...scope.page, stage: "sheet", fan: [stableFanKey(sheetFixture.roster.rows[0]!)] },
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
    page: { ...scope.page, stage: "sheet", fan: [stableFanKey(sheetFixture.roster.rows[0]!)] },
  });
  await waitFor(() => expect(graph.get("sheet").status).toBe("failed"));
  expect(graph.get("sheet").current).toBe(false);
  expect(graph.get("sheet").error).toMatch(/Stale sheet basis/);
  expect(
    host.requests.filter((request) => request.key === "sheet" && !request.request.detail),
  ).toHaveLength(1);
});

test("two stable fan keys retain two independent sheets", async () => {
  const { graph, scope } = fixture();
  graph.update({ ...scope, page: { ...scope.page, stage: "sheet", fan: [stableFanKey(sheetFixture.roster.rows[0]!), stableFanKey(sheetFixture.roster.rows[1]!)] } });
  releases.push(graph.mount(["sheet"]));
  await waitFor(() => expect(graph.get("sheet").current).toBe(true));
  const sheets = graph.get("sheet").value as SheetReading;
  expect(sheets.opened).toHaveLength(2);
  expect(
    host.requests
      .filter((r) => r.key === "sheet" && !r.request.detail)
      .map((r) => r.request.unitId),
  ).toEqual([14577391, 22]);
  expect(host.writes).toEqual([]);
});


test("duplicate marks select independently and stable deep links round trip after mark/id changes", () => {
  const rows = sheetFixture.roster.rows;
  const duplicates = rows.filter((row) => row.mark === "FC-23");
  expect(duplicates).toHaveLength(2);
  const keys = duplicates.map(stableFanKey);
  expect(new Set(keys).size).toBe(2);
  const url = new URL("http://fixture/fans");
  url.searchParams.set("fan", manyCodec.encode(keys));
  const decoded = manyCodec.decode(url.searchParams.get("fan")!) as string[];
  const changed = duplicates.map((row) => ({ ...row, mark: "RENAMED", unitId: row.unitId + 100 }));
  expect(selectedFans(decoded, changed).map(stableFanKey)).toEqual(keys);
  expect(duplicates.map((row) => fanLabel(row, rows))[0]).not.toBe(fanLabel(duplicates[1]!, rows));
});

test.each(["FC-23@0", "13760867:1", "14577391:2", "missing@9"])(
  "failed multi-pick %s preserves the previous ledger, Work and whole roster and names the refusal",
  async (bad) => {
    const { graph, scope } = fixture();
    const key = stableFanKey(sheetFixture.roster.rows[0]!);
    graph.update({ ...scope, page: { ...scope.page, stage: "sheet", fan: [key] } });
    releases.push(graph.mount(["sheet"]));
    await waitFor(() => expect(graph.get("sheet").current).toBe(true));
    const before = graph.get("sheet").value as SheetReading;
    const work = structuredClone(host.doc);
    const roster = graph.get("fans").value;
    graph.update({ ...scope, page: { ...scope.page, stage: "sheet", fan: [key, bad] } });
    await waitFor(() => expect(graph.get("sheet").status).toBe("failed"));
    expect(graph.get("sheet").error).toContain(`Fan link '${bad}'`);
    expect(graph.get("sheet").previous).toBe(before);
    expect(graph.get("fans").value).toBe(roster);
    expect(before.rows).toHaveLength(sheetFixture.roster.rows.length);
    expect(host.doc).toEqual(work);
    expect(host.writes).toEqual([]);
  },
);

test("both duplicate-mark fans open together on the fixture transport", async () => {
  const { graph, scope } = fixture();
  const rows = sheetFixture.roster.rows.filter((row) => row.mark === "FC-23");
  graph.update({ ...scope, page: { ...scope.page, stage: "sheet", fan: rows.map(stableFanKey) } });
  releases.push(graph.mount(["sheet"]));
  await waitFor(() => expect(graph.get("sheet").current).toBe(true));
  expect((graph.get("sheet").value as SheetReading).opened).toHaveLength(2);
  expect(host.requests.filter((r) => r.key === "sheet" && !r.request.detail).map((r) => r.request.unitId))
    .toEqual(rows.map((row) => row.unitId));
});


test("a backend failure after one fan read keeps the previous successful ledger", async () => {
  const { graph, scope } = fixture();
  const first = stableFanKey(sheetFixture.roster.rows[0]!);
  graph.update({ ...scope, page: { ...scope.page, fan: [first] } });
  releases.push(graph.mount(["sheet"]));
  await waitFor(() => expect(graph.get("sheet").current).toBe(true));
  const ledger = graph.get("sheet").value;
  const work = structuredClone(host.doc);
  host.failFan = 13760867;
  graph.update({ ...scope, page: { ...scope.page, fan: [first, stableFanKey(sheetFixture.roster.rows[3]!)] } });
  await waitFor(() => expect(graph.get("sheet").status).toBe("failed"));
  expect(graph.get("sheet").previous).toBe(ledger);
  expect(graph.get("sheet").error).toContain("Fan read refused");
  expect(host.doc).toEqual(work);
  expect(host.writes).toEqual([]);
});
