// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { bindWork, ductsRouteState, routeAddress } from "@pe/agent-contracts";
import { EMPTY_CATALOGS } from "@pe/ducts-domain/catalog";
import { createGraphMount } from "#/shell/mount-owner";
import { ductsGraph } from "./graph";
import { ductsAdapters } from "./route";
import { snapshot } from "./test-fixture";
import { pricingJob } from "./pricing-job";
import { type ReadingPublication, type ReadingSource } from "#/shell/readings";

const io = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("#/host/client", () => ({ callHostRpc: io.call }));
vi.mock("#/scene/scene3d", () => ({ Scene3D: () => <div /> }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  io.call.mockReset();
});

test("URL restore dispatches the same overview as manual system selection after readings arrive", async () => {
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
  const source = (id: string): ReadingSource => ({
    kind: "use",
    open: (_, emit) => {
      publications.set(id, emit);
    },
  });
  const sources = Object.fromEntries(
    Object.keys(ductsAdapters.sources).map((id) => [id, source(id)]),
  );
  sources["ducts.meshes"] = ductsAdapters.sources["ducts.meshes"]!;
  const ref = { session: "url-restore", openId: "doc" };
  const key = bindWork("ducts", null, undefined, ref);
  const initial = routeAddress("ducts").read(
    Object.fromEntries(new URLSearchParams("system=SA&picture=model&stage=network")),
  ).page;
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
        target: { kind: "document", ref },
        workKey: key,
        work: { handle: { key, revision: 1 }, doc },
      }),
      subscribe: () => () => {},
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
    expect(owner.view.read().page).toMatchObject({ system: ["SA"], stage: "network" });
    publish("ducts.roster", snapshot, "roster-1");
    publish("ducts.networks", snapshot, "network-1");
    publish("ducts.tables", {});
    publish("ducts.catalogs", { tables: EMPTY_CATALOGS, findings: [] });
    publish("ducts.pricing", result.result);
    await waitFor(() => expect(io.call).toHaveBeenCalled());
    const restored = io.call.mock.calls[0]![1];
    expect(restored).toMatchObject({ contextRepresentation: "overview", focusOnly: false });
    act(() => owner.view.setPage({ system: [] }));
    act(() => owner.view.setPage({ system: ["SA"] }));
    publish("ducts.networks", snapshot, "network-2");
    await waitFor(() => expect(io.call.mock.calls.length).toBeGreaterThan(1));
    expect(io.call.mock.calls.at(-1)![1]).toEqual(restored);
  } finally {
    view.unmount();
    release();
    disconnect();
    owner.dispose();
  }
});
