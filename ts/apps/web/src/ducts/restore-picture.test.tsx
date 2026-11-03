// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { bindWork, ductsRouteState, routeAddress } from "@pe/agent-contracts";
import { EMPTY_CATALOGS } from "@pe/ducts-domain/catalog";
import { createGraphMount } from "#/shell/mount-owner";
import { ductsGraph } from "./graph";
import { ductsAdapters } from "./route";
import { snapshot as fixtureSnapshot } from "./test-fixture";
import { graphUrlPage } from "#/shell/mount-page";
import { parseSearchWith } from "@tanstack/react-router";
import { pricingJob } from "./pricing-job";
import { type ReadingPublication, type ReadingSource } from "#/shell/readings";

const snapshot = {
  ...fixtureSnapshot,
  systems: fixtureSnapshot.systems.map((s) => ({ ...s, name: "SA 7" })),
  groups: fixtureSnapshot.groups.map((g) => ({
    ...g,
    systemNames: g.systemNames.map(() => "SA 7"),
  })),
};

const io = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("#/host/build-stamp", () => ({ webBuildStamp: { version: "test", build: "restore" } }));
vi.mock("#/host/client", () => ({ callHostRpc: io.call }));
vi.mock("#/scene/scene3d", () => ({ Scene3D: () => <div /> }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  io.call.mockReset();
});

async function restore(binding: boolean) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) {
        this.callback(
          [{ target: element, contentRect: { width: 640, height: 480 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      disconnect() {}
    },
  );
  io.call.mockImplementation(() => new Promise(() => {}));
  const doc = ductsRouteState.schema.parse({});
  const result = pricingJob()({
    id: 1,
    base: { snapshot, grids: {}, catalogs: EMPTY_CATALOGS },
    doc,
  });
  if (!("result" in result)) throw Error("Pricing failed");
  const publications = new Map<string, (event: ReadingPublication) => void>();
  let bound = !binding;
  let update = () => {};
  const source = (id: string): ReadingSource => ({
    kind: "use",
    open: (ctx, emit) => {
      publications.set(id, emit);
      if (id === "ducts.roster" && ctx.target.kind !== "document")
        emit({ kind: "complete", value: null, revision: 0 });
    },
  });
  const sources = Object.fromEntries(
    Object.keys(ductsAdapters.sources).map((id) => [id, source(id)]),
  );
  sources["ducts.meshes"] = ductsAdapters.sources["ducts.meshes"]!;
  const ref = { session: "url-restore", openId: "doc" };
  const key = bindWork("ducts", null, undefined, ref);
  // Exact first Document request from u2-regate-bebca73d/restore-trace/direct-network.json.
  const tracedUrl =
    "http://127.0.0.1:5173/ducts?target=%7B%22kind%22%3A%22open%22%2C%22ref%22%3A%7B%22session%22%3A%22session-39fd29bdcbd0a930%22%2C%22openId%22%3A%22d91fb7bf33c94538870925251718bfad%22%7D%7D&system=SA+7&fan=30e1ec43-ea2c-4cb6-88a5-a404a5ba8387-005c135f%401&picture=model";
  const search = parseSearchWith(JSON.parse)(new URL(tracedUrl).search);
  expect(routeAddress("ducts").read(search).page.system).toEqual(["SA 7"]);
  const initial = graphUrlPage(ductsGraph).read(search);
  const owner = createGraphMount(
    {
      ...ductsGraph,
      readings: {
        ...ductsGraph.readings,
        pricing: { ...ductsGraph.readings.pricing, kind: "use" },
      },
    },
    {
      ...ductsAdapters,
      sources,
      getSnapshot: () => ({
        target: bound ? { kind: "document", ref } : { kind: "host" },
        workKey: key,
        work: { handle: { key, revision: 1 }, doc },
      }),
      subscribe: (notify) => {
        update = notify;
        return () => {};
      },
      write: vi.fn(),
      subscribeAcceptedDeltas: () => () => {},
    },
    initial,
  );
  const disconnect = owner.connect();
  const release = owner.readings.mount(["pricing"]);
  function View() {
    useSyncExternalStore(owner.subscribe, owner.version, owner.version);
    return ductsAdapters.wrap!(
      owner,
      ductsAdapters.bodies["e-picture"]!({
        owner,
        page: owner.view.read().page,
        visible: true,
        verbs: () => null,
        focusRow: () => {},
      }),
    );
  }
  const view = render(<View />);
  const publish = (id: string, value: unknown, sourceVersion?: string) =>
    act(() => publications.get(id)!({ kind: "complete", value, revision: 1, sourceVersion }));
  try {
    expect(owner.view.read().page).toMatchObject({ system: ["SA 7"], stage: "network" });
    act(() => {
      bound = true;
      update();
    });
    expect(owner.view.read().page.system).toEqual(["SA 7"]);
    publish("ducts.roster", snapshot, "roster-1");
    publish("ducts.networks", snapshot, "network-1");
    publish("ducts.tables", {});
    publish("ducts.catalogs", { tables: EMPTY_CATALOGS, findings: [] });
    publish("ducts.pricing", result.result);
    await waitFor(() => expect(io.call).toHaveBeenCalled());
    const restored = io.call.mock.calls[0]![1];
    expect(restored).toMatchObject({ contextRepresentation: "overview", focusOnly: false });
    act(() => owner.view.setPage({ system: [] }));
    act(() => owner.view.setPage({ system: ["SA 7"] }));
    publish("ducts.networks", snapshot, "network-2");
    await waitFor(() => expect(io.call.mock.calls.length).toBeGreaterThan(1));
    expect(io.call.mock.calls.at(-1)![1]).toEqual(restored);
  } finally {
    view.unmount();
    release();
    disconnect();
    owner.dispose();
  }
}

test("exact URL restore after document binding", () => restore(false));
// TODO: S1b must skip subject admission for an unbound target / absent roster in mount-page-owner.ts.
test.fails("exact URL restore survives an absent roster while binding", () => restore(true));
