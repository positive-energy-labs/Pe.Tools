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
import { systemReadCoverage, type NetworkSnapshot } from "./system-reads";
import { noTerminalSnapshot } from "./no-terminal.fixture";

let host: DuctsHostFixture;
let owner: PeReadings;
const releases: (() => void)[] = [];
let missing: Set<number>;
let renamed: Set<number>;

beforeEach(() => {
  host = new DuctsHostFixture();
  missing = new Set();
  renamed = new Set();
  vi.stubGlobal("Worker", host.worker);
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
        systems: host.snapshot.systems
          .filter(
            (system) =>
              selector.kind === "roster" ||
              (selector.systemIds?.includes(system.id) && !missing.has(system.id)),
          )
          .map((system) =>
            selector.kind !== "roster" && renamed.has(system.id)
              ? { ...system, id: system.id + 1000, name: `Renamed ${system.name}` }
              : system,
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

test.each(["missing", "renamed"])(
  "369 requested systems finish once when ten are %s",
  async (kind) => {
    const ids = host.snapshot.systems.slice(-10).map((system) => system.id);
    for (const id of ids) (kind === "missing" ? missing : renamed).add(id);
    const { graph } = fixture();
    releases.push(graph.mount(["pricing"]));
    await waitFor(() => expect(graph.get("ducts").current).toBe(true), { timeout: 3000 });
    const snapshot = graph.get("ducts").value as NetworkSnapshot;
    expect(snapshot.systemReads).toEqual({
      completed: host.snapshot.systems.map((system) => system.id),
      missing: ids,
    });
    expect(systemReadCoverage(snapshot, host.snapshot)).toMatchObject({
      read: 369,
      of: 369,
      report: expect.stringContaining("10 systems returned nothing: System 360"),
    });
    await waitFor(() => expect(graph.get("pricing").current).toBe(true));
    expect(batches()).toHaveLength(24);
  },
);

test("transport recovery of the same roster never restarts a finished sweep or strands pricing", async () => {
  const { graph } = fixture();
  releases.push(graph.mount(["pricing"]));
  await waitFor(() => expect(graph.get("pricing").current).toBe(true), { timeout: 3000 });
  expect(batches()).toHaveLength(24);
  const attempt = graph.get("ducts").basis?.attempt;
  owner.resync();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(graph.get("pricing").current).toBe(true);
  expect(graph.get("ducts").basis?.attempt).toBe(attempt);
  expect(batches()).toHaveLength(24);
});

test("a transport recovery during a sweep preserves progress and pricing settles", async () => {
  const fetch = globalThis.fetch;
  let interrupted = false;
  vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
    const response = await fetch(...args);
    if (!interrupted && batches().length === 3) {
      interrupted = true;
      owner.resync();
    }
    return response;
  });
  const { graph } = fixture();
  releases.push(graph.mount(["pricing"]));
  await waitFor(() => expect(graph.get("pricing").current).toBe(true), { timeout: 3000 });
  expect(interrupted).toBe(true);
  expect(batches()).toHaveLength(24);
  expect(graph.get("ducts").basis?.attempt.generation).toBe(1);
});

test("EX 1 pricing fails with words without read-all, retaining the native network", async () => {
  host.snapshot = noTerminalSnapshot();
  const { graph, scope } = fixture();
  graph.update({ ...scope, page: { ...scope.page, system: ["EX 1"], readAll: false } });
  releases.push(graph.mount(["pricing"]));
  await waitFor(() => expect(graph.get("pricing").status).toBe("failed"));
  expect(graph.get("pricing").error).toBe(
    "EX 1 has no terminal: its air leaves at open end 11620957; nothing to price",
  );
  expect(graph.get("ducts").current).toBe(true);
  const attempt = graph.get("pricing").basis?.attempt;
  owner.resync();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(graph.get("pricing").status).toBe("failed");
  expect(graph.get("pricing").basis?.attempt).toBe(attempt);
});
