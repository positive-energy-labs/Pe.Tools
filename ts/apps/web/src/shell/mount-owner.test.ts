// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { pane, type RouteGraph, type WorkKey } from "@pe/agent-contracts";
import { field } from "../../../../packages/agent-contracts/src/route-field";
import { createGraphMount, type MountScope } from "./mount-owner";
import { pageVerb, queryVerb } from "./verbs";

test("K1.3/11: hydration acquires an image once; a new Target resets declared scope and fences old deliveries", () => {
  type Page = { view: string; filter: string };
  const graph: RouteGraph<Page, Record<string, never>> = {
    key: "proof",
    address: "proof",
    name: "Proof",
    needs: "document",
    work: z.object({}),
    fields: {
      view: { ...field(z.string().default(""), {}), role: "selection" },
      filter: { ...field(z.string().default(""), {}), role: "query" },
    },
    resetOnTarget: ["view"],
    readings: { image: { kind: "use", source: "image", retire: "target" } },
    verbs: {
      close: pageVerb({ label: "Close", input: z.object({}) }, { page: () => ({ view: "" }) }),
    },
    panes: { main: { label: "Main", purpose: "Proof", draws: ["image"], verbs: ["close"] } },
    stages: { main: { word: "Main", panes: ["main"], verbs: [] } },
    layout: pane("main"),
  };
  const key: WorkKey = {
    binding: "open",
    route: "proof",
    target: null,
    open: { session: "S", openId: "A" },
  };
  let scope: MountScope<Record<string, never>> = {
    target: { kind: "document", ref: key.open },
    workKey: key,
    work: null,
  };
  let update!: () => void;
  const attempts: { key: unknown; emit: (part: any) => void }[] = [];
  const write = vi.fn();
  const owner = createGraphMount(
    graph,
    {
      getSnapshot: () => scope,
      subscribe: (fn) => {
        update = fn;
        return () => {};
      },
      sources: {
        image: {
          kind: "use",
          open: (ctx, emit) => {
            attempts.push({ key: ctx.workKey, emit });
            emit({ kind: "complete", value: "A", revision: 0 });
          },
        },
      },
      write,
      subscribeAcceptedDeltas: () => () => {},
    },
    { view: "A view", filter: "kept" },
  );
  const disconnect = owner.connect();
  const release = owner.readings.mount(["image"]);
  expect(attempts).toHaveLength(1);
  expect(attempts[0]!.key).toEqual(key);
  scope = { ...scope, work: { handle: { key: structuredClone(key), revision: 1 }, doc: {} } };
  update();
  expect(attempts).toHaveLength(1);
  scope = { ...scope, target: { kind: "document", ref: { session: "S", openId: "B" } } };
  update();
  expect(owner.view.read().page).toEqual({ view: "", filter: "kept" });
  expect(attempts).toHaveLength(2);
  attempts[0]!.emit({ kind: "complete", value: "late A", revision: 1 });
  expect(owner.readings.get("image").value).toBe("A");
  expect(write).not.toHaveBeenCalled();
  release();
  disconnect();
  owner.dispose();
});

test("an admitted query publishes its result once; a failed refresh retains it without another source GET", async () => {
  const run = vi.fn(async () => ["new"]);
  const open = vi.fn((_ctx, emit) => emit({ kind: "complete", value: ["old"], revision: 1 }));
  const graph: RouteGraph<Record<string, never>> = {
    key: "query-proof",
    address: "query-proof",
    name: "Query",
    fields: {},
    readings: { list: { kind: "use", source: "list", query: "list", retire: "never" } },
    verbs: {
      refresh: queryVerb(
        { key: "list", input: z.object({}), run },
        { label: "Refresh", input: z.object({}), review: "none" },
      ),
    },
    panes: { main: { label: "Main", purpose: "Test", draws: ["list"], verbs: [] } },
    layout: pane("main"),
    stages: { main: { word: "Main", panes: ["main"], verbs: ["refresh"] } },
  };
  const owner = createGraphMount(graph, {
    getSnapshot: () => ({ target: { kind: "host" }, work: null }),
    subscribe: () => () => {},
    sources: { list: { kind: "use", open } },
    verbReadings: { refresh: ["list"] },
    write: vi.fn(),
    subscribeAcceptedDeltas: () => () => {},
  });
  const disconnect = owner.connect(),
    release = owner.readings.mount(["list"]);
  try {
    expect(owner.readings.get("list").value).toEqual(["old"]);
    expect((await owner.control("refresh").run()).state).toBe("done");
    expect(owner.readings.get("list")).toMatchObject({ value: ["new"], current: true });
    run.mockRejectedValueOnce(Error("offline"));
    expect((await owner.control("refresh").run()).state).toBe("failed");
    expect(owner.readings.get("list")).toMatchObject({
      previous: ["new"],
      status: "failed",
      current: false,
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledTimes(1);
  } finally {
    release();
    disconnect();
    owner.dispose();
  }
});

test.each([false, true])(
  "a query cannot publish into a replaced dependency attempt (failed=%s)",
  async (failed) => {
    let settle!: (value: string[]) => void;
    let reject!: (cause: Error) => void;
    let dependency!: import("./readings").ReadingDelivery;
    const graph: RouteGraph<Record<string, never>> = {
      key: "query-race",
      address: "query-race",
      name: "Query race",
      fields: {},
      readings: {
        dependency: { kind: "use", source: "dependency", retire: "never" },
        list: { kind: "use", source: "list", query: "list", deps: ["dependency"], retire: "never" },
      },
      verbs: {
        refresh: queryVerb(
          {
            key: "list",
            input: z.object({}),
            run: () =>
              new Promise<string[]>((resolve, fail) => {
                settle = resolve;
                reject = fail;
              }),
          },
          { label: "Refresh", input: z.object({}), review: "none" },
        ),
      },
      panes: { main: { label: "Main", purpose: "Test", draws: ["list"], verbs: [] } },
      layout: pane("main"),
      stages: { main: { word: "Main", panes: ["main"], verbs: ["refresh"] } },
    };
    const owner = createGraphMount(graph, {
      getSnapshot: () => ({ target: { kind: "host" }, work: null }),
      subscribe: () => () => {},
      sources: {
        dependency: {
          kind: "use",
          open: (_, emit) => {
            dependency = emit;
            emit({ kind: "complete", value: "old", revision: 1 });
          },
        },
        list: {
          kind: "use",
          open: (ctx, emit) =>
            emit({ kind: "complete", value: [ctx.inputs.dependency!.value], revision: 1 }),
        },
      },
      verbReadings: { refresh: ["list"] },
      write: vi.fn(),
      subscribeAcceptedDeltas: () => () => {},
    });
    const disconnect = owner.connect();
    const release = owner.readings.mount(["list"]);
    try {
      const running = owner.control("refresh").run();
      await vi.waitFor(() => expect(settle).toBeDefined());
      dependency({ kind: "complete", value: "current", revision: 2 });
      const current = owner.readings.get("list");
      expect(current.value).toEqual(["current"]);
      if (failed) reject(Error("old request failed"));
      else settle(["obsolete"]);
      await running;
      expect(owner.readings.get("list")).toBe(current);
    } finally {
      release();
      disconnect();
      owner.dispose();
    }
  },
);
