// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { z } from "zod";
import {
  address,
  bindWork,
  pane,
  readingKey,
  workKey,
  type RouteGraph,
  type WorkKey,
} from "@pe/agent-contracts";
import { RouteWorkspace } from "../../../../packages/runtime/src/route-workspace";
import { docAtom } from "../route/route-work";
import { makeAtomRegistry } from "../route/route-owner";
import { previousOf, type Readings } from "../readings";
import { createGraphMount } from "./mount-owner";
import { workVerb } from "./verbs";

test("a composer-shaped address reader and a page reader share accepted deltas, deletion and one journal", async () => {
  const route = `identity-${crypto.randomUUID()}`;
  const schema = z.object({ cells: z.record(z.string(), z.string()).default({}) });
  const spec = { route, schema, title: route, description: route };
  const composer: WorkKey = {
    binding: "address",
    route,
    target: address("C:/Models/ONE.rvt"),
    from: { session: "s", openId: "o" },
  };
  const page = bindWork(route, address("c:\\models\\one.rvt"));
  const stored = new Map<string, unknown>();
  const host = new RouteWorkspace({
    registrations: [{ spec }],
    store: {
      getState: async ({ targetKey }) => stored.get(targetKey) ?? null,
      setState: async ({ targetKey, value }) => {
        stored.set(targetKey, structuredClone(value));
      },
    },
  });
  const resources: Readings = {
    dirty: () => {},
    subscribe: (request, deliver) => {
      if (request.kind !== "work") throw Error("Unexpected reading");
      return host.observe(request, route, (result) => {
        if ("error" in result) throw Error(result.error);
        deliver({ kind: "snapshot", key: readingKey(request), value: result.value });
      });
    },
  };
  const registry = makeAtomRegistry();
  const composerReader = docAtom(spec, composer, resources);
  const pageReader = docAtom({ ...spec }, page, resources);
  expect(composerReader).toBe(pageReader);
  const release = registry.mount(pageReader);
  const graph: RouteGraph<Record<string, never>, z.output<typeof schema>> = {
    key: route,
    address: route,
    name: route,
    work: schema,
    fields: {},
    readings: {},
    verbs: {
      edit: workVerb(
        { label: "edit", input: z.object({}) },
        { patches: () => [{ path: ["cells", "a"], value: "edit" }] },
      ),
    },
    panes: { main: { label: "Main", purpose: "Test", draws: [], verbs: [] } },
    stages: { main: { word: "Main", panes: ["main"], verbs: ["edit"] } },
    layout: pane("main"),
  };
  const mount = (key: WorkKey) =>
    createGraphMount(graph, {
      getSnapshot: () => {
        const seen = previousOf(registry.get(pageReader));
        return {
          target: { kind: "host" },
          workKey: key,
          work: seen
            ? { handle: { key, revision: seen.revision ?? 0 }, doc: seen.doc ?? { cells: {} } }
            : null,
        };
      },
      subscribe: (notify) => registry.subscribe(pageReader, notify),
      sources: {},
      write: (key, write) => host.write(key, route, "human", write),
      subscribeAcceptedDeltas: (key, accept) => host.observeAccepted(key, accept),
    });
  const a = mount(composer),
    b = mount(page);
  const ca = a.connect(),
    cb = b.connect();
  try {
    await expect.poll(() => a.snapshot().work?.handle.revision).toBe(0);
    await a.control("edit").run();
    await expect.poll(() => previousOf(registry.get(pageReader))?.doc?.cells.a).toBe("edit");
    expect(a.journals.get(workKey(composer))).toBe(b.journals.get(workKey(page)));
    expect((await b.restore("undo"))?.ok).toBe(true);
    await expect.poll(() => previousOf(registry.get(composerReader))?.doc?.cells).toEqual({});
    expect((await a.restore("redo"))?.ok).toBe(true);
    await expect.poll(() => b.snapshot().work?.doc.cells.a).toBe("edit");
    const result = await host.write(composer, route, "human", {
      kind: "apply",
      press: "composer-revert",
      expectedRevision: 3,
      patches: [{ path: ["cells", "a"] }],
    });
    expect(result.ok).toBe(true);
    await expect.poll(() => b.snapshot().work?.doc.cells).toEqual({});
    expect(previousOf(registry.get(composerReader))?.revision).toBe(4);
  } finally {
    ca();
    cb();
    a.dispose();
    b.dispose();
    release();
    registry.dispose();
  }
});
