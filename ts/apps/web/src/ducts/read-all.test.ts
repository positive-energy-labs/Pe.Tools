// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { waitFor } from "@testing-library/react";
import { READING_MAX_KEYS, type DuctsRouteDocument } from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { PeReadings, peReadings } from "#/readings";
import { createReadingGraph, type ReadingScope } from "#/shell/readings";
import { ductsGraph, ductsPageSchema, type DuctsPage } from "./graph";
import { DuctsHostFixture } from "./host.fixture";
import { ductsSources } from "./sources";

let host: DuctsHostFixture;
let owner: PeReadings;
const releases: (() => void)[] = [];

beforeEach(() => {
  host = new DuctsHostFixture();
  host.snapshot.systems = Array.from({ length: 369 }, (_, i) => ({
    ...host.snapshot.systems[0]!,
    id: i + 1,
    name: `System ${i + 1}`,
  }));
  vi.stubGlobal("EventSource", host.source());
  vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
    const response = await host.fetch(...args);
    const request = host.requests.at(-1);
    if (request?.key !== "ducts.snapshot") return response;
    const selector = request.request.selector as { kind: string; systemIds?: number[] };
    const snapshot = await response.json();
    return Response.json(
      {
        ...snapshot,
        systems: host.snapshot.systems.filter(
          (system) => selector.kind === "roster" || selector.systemIds?.includes(system.id),
        ),
      },
      { headers: response.headers },
    );
  });
  owner = new PeReadings(() => "http://fixture/resources/stream");
  vi.spyOn(peReadings, "subscribe").mockImplementation(owner.subscribe.bind(owner));
});

afterEach(() => {
  for (const release of releases.splice(0).reverse()) release();
  owner.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture() {
  const scope: ReadingScope<DuctsPage, DuctsRouteDocument> = {
    target: { kind: "document", ref: { session: "s", openId: "d" } },
    workKey: host.key,
    workRevision: host.revision,
    work: host.doc,
    page: ductsPageSchema.parse({ readAll: true }),
  };
  const graph = createReadingGraph(ductsGraph, { scope, sources: ductsSources(), log: () => {} });
  releases.push(() => graph.dispose());
  return { graph, scope };
}

const batches = () =>
  host.requests
    .filter((request) => request.key === "ducts.snapshot")
    .map((request) => request.request.selector as { kind: string; systemIds?: number[] })
    .filter((selector) => selector.kind === "systems")
    .map((selector) => selector.systemIds!);

test("read every system finishes 369 exactly once in bounded batches beside other subscriptions", async () => {
  for (let i = 0; i < READING_MAX_KEYS - 14; i++)
    releases.push(owner.subscribe({ kind: "receipts", id: `other-${i}` }, () => {}));
  const { graph } = fixture();
  releases.push(graph.mount(["ducts"]));
  await waitFor(() => expect(graph.get("ducts").current).toBe(true), { timeout: 3000 });
  expect((graph.get("ducts").value as DuctSnapshot).systems).toHaveLength(369);
  expect(batches().map((batch) => batch.length)).toEqual([...Array(23).fill(16), 1]);
  expect(
    batches()
      .flat()
      .sort((a, b) => a - b),
  ).toEqual(host.snapshot.systems.map((system) => system.id));
  expect(
    [...host.subscriptions.values()].filter(
      ({ request }) => request.kind === "ducts-snapshot" && request.selector?.kind === "systems",
    ),
  ).toHaveLength(0);
  releases.push(owner.subscribe({ kind: "receipts", id: "another-pane" }, () => {}));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(batches()).toHaveLength(24);
});

test("a cap refusal keeps completed progress and fails once without restarting demand", async () => {
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    if (request.kind === "ducts-snapshot" && request.selector?.kind === "systems") {
      if (batches().length === 3) {
        // Another pane consumes the remaining capacity just before the next batch joins.
        for (let i = 0; i < READING_MAX_KEYS - 1; i++)
          releases.push(owner.subscribe({ kind: "receipts", id: `pressure-${i}` }, () => {}));
      }
    }
    return owner.subscribe(request, accept);
  });
  const { graph, scope } = fixture();
  releases.push(graph.mount(["ducts"]));
  await waitFor(() => expect(graph.get("ducts").status).toBe("failed"));
  expect(graph.get("ducts").error).toBe("Too many Pe reading subscriptions");
  expect((graph.get("ducts").value as DuctSnapshot).systems).toHaveLength(48);
  const attempt = graph.get("ducts").basis?.attempt;
  owner.resync();
  graph.update({ ...scope, workRevision: 2 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(graph.get("ducts").status).toBe("failed");
  expect(graph.get("ducts").basis?.attempt).toBe(attempt);
  expect(batches()).toHaveLength(3);
});
