// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import {
  address,
  bindWork,
  pane,
  readingKey,
  workKey,
  workWriteSchema,
  type RouteGraph,
} from "@pe/agent-contracts";
import { peReadings, previousOf } from "#/readings";
import { acquireWorkJournal } from "#/shell/journal";
import * as host from "../route/host";
import { useWorkHandles } from "./use-work-handles";
import { RouteWorkspace } from "../../../../packages/runtime/src/route-workspace";
import { createGraphMount } from "./mount-owner";
import { appAtomRegistry } from "./owner";
import { docAtom } from "./work-document";
import { workVerb } from "./verbs";

test("a Chat head Work write acknowledges the canonical kernel journal", async () => {
  const schema = z.object({ count: z.number().default(0) });
  const graph: RouteGraph<Record<string, never>, z.output<typeof schema>> = {
    key: "head-journal",
    address: "head-journal",
    name: "Head journal",
    work: schema,
    fields: {},
    readings: {},
    verbs: {},
    panes: { main: { label: "Main", purpose: "Test", draws: [], verbs: [] } },
    stages: { main: { word: "Main", panes: ["main"], verbs: [] } },
    layout: pane("main"),
  };
  const key = bindWork(graph.key, null, crypto.randomUUID());
  const entries = [{ graph, key }];
  const held = acquireWorkJournal(key);
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    if (request.kind === "work")
      accept({
        kind: "snapshot",
        key: readingKey(request),
        value: { revision: 3, doc: schema.parse({}) },
      } as never);
    return () => {};
  });
  vi.spyOn(host, "writeRouteWork").mockImplementation(async (_key, body) => {
    const write = workWriteSchema.parse(body);
    return {
      ok: true,
      revision: 4,
      write: {
        key,
        kind: write.kind,
        by: "human",
        press: write.press,
        base: 3,
        revision: 4,
        patches: write.patches,
        inverse: [{ path: ["count"], value: 0 }],
        undoable: true,
      },
    };
  });
  try {
    const hook = renderHook(() => useWorkHandles(entries), { wrapper: StrictMode });
    expect(hook.result.current[0]!.revision).toBe(3);
    await act(async () => {
      expect(
        await hook.result.current[0]!.write([{ path: ["count"], value: 1 }], 3, {
          press: "head-take",
        }),
      ).toBeNull();
    });
    expect(held.journal.read().undo.map((step) => step.press)).toEqual(["head-take"]);
  } finally {
    cleanup();
    held.release();
    vi.restoreAllMocks();
  }
});

test("a head and its route share real host admission, undo, redo and author barriers across key spellings", async () => {
  const route = `multi-work-${crypto.randomUUID()}`;
  const schema = z.object({ count: z.number().default(0) });
  const spec = { route, title: route, description: route, schema };
  const graph: RouteGraph<Record<string, never>, z.output<typeof schema>> = {
    key: route,
    address: route,
    name: route,
    work: schema,
    fields: {},
    readings: {},
    verbs: {
      increment: workVerb(
        { label: "increment", input: z.object({}) },
        {
          patches: ({ snapshot }) => [
            { path: ["count"], value: (snapshot.work!.doc as { count: number }).count + 1 },
          ],
        },
      ),
    },
    panes: { main: { label: "Main", purpose: "Test", draws: [], verbs: [] } },
    stages: { main: { word: "Main", panes: ["main"], verbs: ["increment"] } },
    layout: pane("main"),
  };
  const pageKey = bindWork(route, address("C:/Models/MULTI.rvt"));
  const headKey = bindWork(route, address("c:\\models\\multi.rvt"), undefined, {
    session: "s",
    openId: "o",
  });
  const otherKey = bindWork(route, null, crypto.randomUUID());
  const stored = new Map<string, unknown>();
  const workspace = new RouteWorkspace({
    registrations: [{ spec }],
    store: {
      getState: async ({ targetKey }) => stored.get(targetKey) ?? null,
      setState: async ({ targetKey, value }) => {
        stored.set(targetKey, structuredClone(value));
      },
    },
  });
  vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    if (request.kind === "work")
      return workspace.observe(request, route, (result) => {
        if ("error" in result) throw Error(result.error);
        accept({ kind: "snapshot", key: readingKey(request), value: result.value });
      });
    if (request.kind === "work-acks")
      return workspace.observeAccepted(request.work, (ack) => {
        accept({ kind: "event", key: readingKey(request), value: ack } as never);
      });
    return () => {};
  });
  const transport = vi
    .spyOn(host, "writeRouteWork")
    .mockImplementation((key, request) => workspace.write(key, route, "human", request));
  const entries = [
    { graph, key: headKey },
    { graph, key: otherKey },
  ];
  const hook = renderHook(() => useWorkHandles(entries));
  const atom = docAtom(spec, pageKey);
  const mount = createGraphMount(graph, {
    getSnapshot: () => {
      const seen = previousOf(appAtomRegistry.get(atom));
      return {
        target: { kind: "host" },
        workKey: pageKey,
        work: seen
          ? {
              handle: { key: pageKey, revision: seen.revision ?? 0 },
              doc: seen.doc ?? schema.parse({}),
            }
          : null,
      };
    },
    subscribe: (notify) => appAtomRegistry.subscribe(atom, notify),
    sources: {},
    write: host.writeRouteWork,
    subscribeAcceptedDeltas: (key, accept) => workspace.observeAccepted(key, accept),
  });
  const disconnect = mount.connect();
  try {
    await expect.poll(() => hook.result.current[0]!.doc).toEqual({ count: 0 });
    await act(async () => {
      expect(
        await hook.result.current[0]!.write([{ path: ["count"], value: 3 }], 0, {
          press: "head-take",
        }),
      ).toBeNull();
    });
    expect(transport.mock.calls[0]![0]).toEqual(headKey);
    await expect.poll(() => mount.snapshot().work?.doc.count).toBe(3);
    expect(
      mount
        .journal(pageKey)
        .read()
        .undo.map(({ press }) => press),
    ).toEqual(["head-take"]);
    expect(hook.result.current[1]!.doc).toEqual({ count: 0 });
    expect(mount.journal(otherKey).read().undo).toEqual([]);
    await act(async () => {
      expect((await mount.restore("undo"))?.ok).toBe(true);
    });
    await expect.poll(() => hook.result.current[0]!.doc?.count).toBe(0);
    await act(async () => {
      expect((await mount.restore("redo"))?.ok).toBe(true);
    });
    await expect.poll(() => hook.result.current[0]!.doc?.count).toBe(3);
    await act(async () => {
      expect((await mount.control("increment").run()).state).toBe("done");
    });
    await expect.poll(() => hook.result.current[0]!.doc?.count).toBe(4);
    await act(async () => {
      expect(
        (
          await workspace.write(headKey, route, "pea", {
            kind: "apply",
            press: "pea-edit",
            expectedRevision: 4,
            patches: [{ path: ["count"], value: 10 }],
          })
        ).ok,
      ).toBe(true);
    });
    await expect.poll(() => mount.snapshot().work?.doc.count).toBe(10);
    expect(await mount.restore("undo")).toMatchObject({ ok: false, code: "barrier" });
    expect(workKey(headKey)).toBe(workKey(pageKey));
  } finally {
    disconnect();
    mount.dispose();
    cleanup();
    vi.restoreAllMocks();
  }
});
