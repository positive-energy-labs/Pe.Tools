// @vitest-environment jsdom
import { cleanup, render, waitFor, fireEvent } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { pane, projectRouteGraph, type RouteGraph } from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { Route as root } from "../routes/__root";
import { routeFromGraph, type GraphMount } from "./mount";
import { createFixtureMount, fixtureEnvironment } from "./fixture";
import { commandVerb, queryVerb, rpcVerb, workVerb } from "./verbs";

afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 10));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const input = z.object({}).default({});
const read = {
  key: "fixture.read",
  input,
  run: async () => {
    throw Error("Real query called");
  },
};
const graph: RouteGraph<{ stage: string }, { value: number }> = {
  key: "fixture-proof",
  address: "fixture-proof",
  name: "Fixture proof",
  needs: "project",
  work: z.object({ value: z.number().default(0) }),
  fields: { stage: { ...field(z.string().default("edit"), {}), role: "stage" } },
  readings: Object.fromEntries(
    (["use", "feed", "derive", "worker", "port"] as const).map((kind) => [
      kind,
      { kind, source: kind, retire: "never" },
    ]),
  ),
  verbs: {
    edit: workVerb({ label: "Edit", input }, { patches: () => [{ path: ["value"], value: 7 }] }),
    query: queryVerb(read, { label: "Query", input, review: "none" }),
    rpc: rpcVerb(
      read,
      { label: "RPC", input, review: "none", caller: "human" },
      { intent: () => ({}) },
    ),
    command: commandVerb(
      "ducts.refresh",
      { label: "Command", input, review: "none" },
      { intent: () => ({}) },
    ),
  },
  panes: {
    body: {
      label: "Body",
      purpose: "Fixture",
      draws: ["use", "feed", "derive", "worker", "port"],
      verbs: ["edit"],
    },
  },
  layout: pane("body"),
  stages: { edit: { word: "Edit", panes: ["body"], verbs: [] } },
  seeds: Object.fromEntries(
    ["one", "two"].map((name, i) => [
      name,
      {
        title: name,
        load: async () => ({
          work: { value: i + 1 },
          readings: { use: 1, feed: 2, derive: 3, worker: 4, port: 5 },
          queries: { "fixture.read": { answer: 42 } },
        }),
      },
    ]),
  ),
};

test("graph projection publishes seed choices without copying fixture payloads", () => {
  expect(projectRouteGraph(graph).seeds).toEqual({ one: { title: "one" }, two: { title: "two" } });
});

test("kernel fixture mounts an arbitrary graph, isolates every source, and restores acknowledged Work without fetch", async () => {
  const fetch = vi.fn(() => {
    throw Error("Real host called");
  });
  vi.stubGlobal("fetch", fetch);
  const forbidden = vi.fn(() => {
    throw Error("Real adapter called");
  });
  const owner = await createFixtureMount(graph, "one", {
    write: forbidden,
    getSnapshot: forbidden,
    subscribe: forbidden,
    subscribeAcceptedDeltas: forbidden,
    subscribeReceipts: forbidden,
    subscribeDocumentChanged: forbidden,
    checkpoint: forbidden,
  });
  const release = owner.connect();
  const demand = owner.readings.mount(Object.keys(graph.readings));
  try {
    await waitFor(() =>
      expect(Object.keys(graph.readings).map((id) => owner.readings.get(id).status)).toEqual(
        Array(5).fill("ready"),
      ),
    );
    expect((await owner.control("edit").run()).state).toBe("done");
    expect(owner.snapshot().work?.doc.value).toBe(7);
    await owner.restore("undo");
    await waitFor(() => expect(owner.snapshot().work?.doc.value).toBe(1));
    await owner.restore("redo");
    expect(owner.snapshot().work?.doc.value).toBe(7);
    expect(await owner.control("query").run()).toMatchObject({
      state: "done",
      kind: "query",
      receipt: { value: { answer: 42 } },
    });
    for (const id of ["rpc", "command"])
      expect(await owner.control(id).run()).toMatchObject({
        state: "refused",
        refusal: { message: expect.stringContaining("Fixture") },
      });
    await owner.checkpoint();
    expect(forbidden).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    demand();
    release();
    owner.dispose();
  }
});

test.each(["", "unknown"])(
  "undeclared fixture %s stays isolated and refuses Work",
  async (name) => {
    const fetch = vi.fn(() => {
      throw Error("Real host called");
    });
    vi.stubGlobal("fetch", fetch);
    const owner = await createFixtureMount(graph, name);
    const release = owner.connect();
    try {
      expect(owner.snapshot().failure).toContain("not declared");
      expect((await owner.control("edit").run()).state).toBe("refused");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      release();
      owner.dispose();
    }
  },
);

test("URL fixture shows its seed and switches to a fresh memory Work without acquiring the real door", async () => {
  const fetch = vi.fn(() => {
    throw Error("Real host called");
  });
  vi.stubGlobal("fetch", fetch);
  let owner!: GraphMount<{ stage: string }, { value: number }>;
  const route = routeFromGraph(graph, {
    sources: Object.fromEntries(
      Object.entries(graph.readings).map(([id, r]) => [
        id,
        r.kind === "derive"
          ? {
              kind: "derive",
              derive: () => {
                throw Error("real source");
              },
            }
          : r.kind === "worker"
            ? {
                kind: "worker",
                algorithmVersion: "real",
                connect: () => {
                  throw Error("real worker");
                },
              }
            : {
                kind: r.kind,
                open: () => {
                  throw Error("real source");
                },
              },
      ]),
    ),
    bodies: {
      body: ({ owner: mounted }) => {
        owner = mounted;
        return <span>{mounted.snapshot().work?.doc.value}</span>;
      },
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/fixture-proof?fixture=one"] }),
  });
  const unsubscribe = router.history.subscribe(router.load);
  await router.load();
  const Component = route.options.component!;
  const view = render(
    <RouterContextProvider router={router}>
      <Component />
    </RouterContextProvider>,
  );
  try {
    await view.findByLabelText("Fixture lane");
    await waitFor(() => expect(owner.snapshot().work?.doc.value).toBe(1));
    fireEvent.change(view.getByLabelText("Fixture seed"), { target: { value: "two" } });
    await waitFor(() => expect(owner.snapshot().work?.doc.value).toBe(2));
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    cleanup();
    unsubscribe();
  }
});

test("seed discovery never loads payloads and fixture mounting awaits only the selected seed", async () => {
  let deliver!: (value: { readings: Record<string, unknown>; work: { value: number } }) => void;
  const load = vi.fn(
    () =>
      new Promise<{ readings: Record<string, unknown>; work: { value: number } }>((resolve) => {
        deliver = resolve;
      }),
  );
  const other = vi.fn(async () => ({ readings: {} }));
  const lazy = {
    ...graph,
    seeds: { selected: { title: "Selected", load }, other: { title: "Other", load: other } },
  };
  expect(projectRouteGraph(lazy).seeds).toEqual({
    selected: { title: "Selected" },
    other: { title: "Other" },
  });
  expect(load).not.toHaveBeenCalled();
  const pending = fixtureEnvironment(lazy, "selected");
  expect(load).toHaveBeenCalledTimes(1);
  expect(other).not.toHaveBeenCalled();
  deliver({ readings: {}, work: { value: 9 } });
  const lane = await pending;
  expect(lane.ports.getSnapshot().work?.doc.value).toBe(9);
});

test("a failed seed import stays isolated and refuses Work", async () => {
  const broken = {
    ...graph,
    seeds: {
      broken: {
        title: "Broken",
        load: async () => {
          throw Error("missing chunk");
        },
      },
    },
  };
  const owner = await createFixtureMount(broken, "broken");
  expect(owner.snapshot().failure).toContain("missing chunk");
  expect((await owner.control("edit").run()).state).toBe("refused");
  owner.dispose();
});
