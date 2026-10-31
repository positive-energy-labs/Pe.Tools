// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  podRouteDescriptorSchema,
  readingKey,
  workKey,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { routeFromGraph } from "#/shell/mount";
import { Route as root } from "../routes/__root";
import { makePodRoute, type PodApi } from "./pod-view";
import { peReadings } from "#/readings";
import * as routeHost from "./host";

vi.mock("../routes/__root", async () => {
  const { createRootRoute, Outlet } = await import("@tanstack/react-router");
  return { Route: createRootRoute({ component: Outlet }) };
});

test("queued Pod events wait for the ACK's authoritative Work reading", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const subscribers = new Set<(revision: number, value: number) => void>();
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    if (request.kind !== "work") return () => {};
    const publish = (revision: number, value: number) =>
      accept({
        kind: "snapshot",
        key: readingKey(request),
        value: { revision, doc: { version: 1, state: { value } } },
      } as never);
    subscribers.add(publish);
    publish(0, 0);
    return () => {
      subscribers.delete(publish);
    };
  });
  const writes: WorkWriteAck[] = [];
  vi.spyOn(routeHost, "writeRouteWork").mockImplementation(async (key, request) => {
    const ack: WorkWriteAck = {
      ...request,
      key,
      by: "human",
      base: request.expectedRevision,
      revision: request.expectedRevision + 1,
      inverse: [],
      undoable: true,
    };
    writes.push(ack);
    return { ok: true, revision: ack.revision, write: ack };
  });
  let api!: PodApi;
  const { graph, adapters } = makePodRoute(
    podRouteDescriptorSchema.parse({
      key: "route:@test/routes/queue/index.js",
      workRoute: "pod.test.queue",
      packageId: "test",
      name: "Queue",
      description: "Queue proof",
      sourcePath: "routes/queue/index.js",
      sha256: "a".repeat(64),
      trusted: true,
    }),
    {
      version: 1,
      initial: { value: 0 },
      reducer: (state, event) => ({ value: Number(state.value) + Number(event.add) }),
      create: (provided) => {
        api = provided;
        return () => (
          <output aria-label="Queued count">{String(provided.useState().state.value)}</output>
        );
      },
    },
  );
  const route = routeFromGraph(graph, adapters, "/queue");
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/queue"] }),
  });
  await router.load();
  const Component = route.options.component!;
  const view = render(
    <RouterContextProvider router={router}>
      <Component />
    </RouterContextProvider>,
  );
  await waitFor(() => expect(view.getByLabelText("Queued count").textContent).toBe("0"));
  await waitFor(() => expect(subscribers.size).toBe(1));
  let first!: Promise<void>, second!: Promise<void>;
  act(() => {
    first = api.useState().fire({ add: 1 });
    second = api.useState().fire({ add: 2 });
  });
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]!.patches).toEqual([{ path: ["state"], value: { value: 1 } }]);
  expect(api.getState().value).toBe(0);
  act(() => subscribers.forEach((publish) => publish(1, 1)));
  await first;
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]!.base).toBe(1);
  expect(workKey(writes[1]!.key)).toBe(workKey(writes[0]!.key));
  expect(writes[1]!.patches).toEqual([{ path: ["state"], value: { value: 3 } }]);
  act(() => subscribers.forEach((publish) => publish(2, 3)));
  await second;
  await waitFor(() => expect(view.getByLabelText("Queued count").textContent).toBe("3"));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("a Pod mounts the kernel fixture lane, journals reducer events and blocks host execution", async () => {
  const fetch = vi.fn(() => {
    throw Error("Real host called");
  });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  let api!: PodApi;
  const { graph, adapters } = makePodRoute(
    podRouteDescriptorSchema.parse({
      key: "route:@test/routes/counter/index.js",
      workRoute: "pod.test.counter",
      packageId: "test",
      name: "Counter",
      description: "Authored counter",
      sourcePath: "routes/counter/index.js",
      sha256: "a".repeat(64),
      trusted: true,
    }),
    {
      version: 1,
      initial: { value: 0 },
      reducer: (state, event) => ({ value: Number(state.value) + Number(event.add) }),
      fixtures: {
        count: {
          title: "Counter fixture",
          state: { value: 3 },
          queries: { "pod.read": { answer: 42 } },
        },
      },
      create: (provided) => {
        api = provided;
        return function Counter() {
          const { state, fire } = provided.useState();
          return (
            <>
              <output aria-label="Count">{String(state.value)}</output>
              <button onClick={() => void fire({ add: 1 })}>Increment</button>
            </>
          );
        };
      },
    },
  );
  const route = routeFromGraph(graph, adapters, "/counter");
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/counter?fixture=count"] }),
  });
  await router.load();
  const Component = route.options.component!;
  const view = render(
    <RouterContextProvider router={router}>
      <Component />
    </RouterContextProvider>,
  );
  await waitFor(() => expect(view.getByLabelText("Count").textContent).toBe("3"));
  fireEvent.click(view.getByText("Increment"));
  await waitFor(() => expect(view.getByLabelText("Count").textContent).toBe("4"));
  await act(async () => {
    await Promise.all([api.useState().fire({ add: 2 }), api.useState().fire({ add: 3 })]);
  });
  await waitFor(() => expect(view.getByLabelText("Count").textContent).toBe("9"));
  fireEvent.keyDown(view.getByLabelText("Counter route"), { key: "z", ctrlKey: true });
  await waitFor(() => expect(view.getByLabelText("Count").textContent).toBe("6"));
  await expect(api.read("revit.context.lens", {})).resolves.toEqual({ answer: 42 });
  await expect(api.do("revit.context.show-elements", { elementIds: [1] })).rejects.toThrow(
    "Fixture",
  );
  await expect(api.exportSnapshot(api.getState())).rejects.toThrow("Fixture");
  expect(fetch).not.toHaveBeenCalled();
});
