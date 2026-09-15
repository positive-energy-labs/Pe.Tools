// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { peReadings, useHostStatus, useInventory } from "#/readings";
import { inspectAtomRegistry } from "#/state/atom-inspect";
import { defineRoute } from "./manifest";
import { appAtomRegistry, useRoute } from "./use-route";

test("a stream reconnect retains the target and dirties the bound Reading", async () => {
  let inventory!: Parameters<typeof peReadings.subscribe>[1];
  let documentSubscriptions = 0;
  const subscribe = vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    if (request.kind === "inventory") inventory = accept;
    if (request.kind === "takeoff-reading") documentSubscriptions++;
    return () => {
      if (request.kind === "takeoff-reading") documentSubscriptions--;
    };
  });
  const dirty = vi.spyOn(peReadings, "dirty").mockImplementation(() => {});
  const manifest = defineRoute({
    key: "target-gap",
    name: "Target gap",
    needs: "project",
    readings: { snapshot: { kind: "takeoff-reading", target: { session: "", openId: "" } } },
    actions: {
      refresh: {
        label: "refresh",
        says: "reads again",
        needs: "document",
        actor: "any",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: ["snapshot"],
        ready: () => null,
        run: async () => {},
      },
    },
  });
  try {
    const { result } = renderHook(() =>
      useRoute(manifest, {
        target: JSON.stringify({ kind: "open", ref: { session: "revit", openId: "doc" } }),
      }),
    );
    act(() =>
      inventory({
        kind: "snapshot",
        key: "inventory",
        value: {
          sessions: [
            {
              connected: true,
              sessionId: "revit",
              sdkSessionId: "friendly-recovery-name",
              openDocumentCount: 1,
              openDocuments: [{ openId: "doc", address: null, isFamilyDocument: false }],
            },
          ],
        },
      } as never),
    );
    expect(result.current.resolution.kind).toBe("resolved");
    expect(documentSubscriptions).toBe(1);
    await act(async () => {
      expect(await result.current.actions.refresh.run()).toBeNull();
    });
    expect(dirty).toHaveBeenCalledWith({
      kind: "takeoff-reading",
      target: { session: "revit", openId: "doc" },
    });
    act(() => inventory({ kind: "stale", key: "inventory" }));
    expect(result.current.resolution.kind).toBe("resolved");
    expect(documentSubscriptions).toBe(1);
    act(() => inventory({ kind: "snapshot", key: "inventory", value: { sessions: [] } } as never));
    expect(result.current.resolution.kind).toBe("choose");
  } finally {
    cleanup();
    dirty.mockRestore();
    subscribe.mockRestore();
  }
});

test("a missing Work writer refuses before the action can continue", async () => {
  let continued = false;
  const manifest = defineRoute({
    key: "writer-refusal",
    name: "Writer refusal",
    actions: {
      save: {
        label: "save",
        says: "writes Work",
        needs: "host",
        actor: "human",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: [],
        ready: () => null,
        run: async (ctx) => {
          await ctx.write([]);
          continued = true;
        },
      },
    },
  });
  try {
    const { result } = renderHook(() => useRoute(manifest));
    let refusal;
    await act(async () => {
      refusal = await result.current.actions.save.run();
    });
    expect(refusal).toMatchObject({ code: "not-ready" });
    expect(continued).toBe(false);
  } finally {
    cleanup();
  }
});

test("same-tick Work writes carry the accepted revision forward", async () => {
  let acceptWork!: Parameters<typeof peReadings.subscribe>[1];
  const subscribe = vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    if (request.kind === "work") acceptWork = accept;
    return () => {};
  });
  const bodies: Array<{ expectedRevision: number }> = [];
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    if (typeof init?.body !== "string") throw Error("expected a JSON request body");
    bodies.push(JSON.parse(init.body) as { expectedRevision: number });
    return new Response(JSON.stringify({ ok: true, revision: bodies.length }));
  });
  const manifest = defineRoute({
    key: "queued-work",
    name: "Queued Work",
    work: {
      route: "queued-work",
      title: "Queued Work",
      description: "proof",
      schema: z.object({ values: z.record(z.string(), z.string()) }),
      agentWriteMask: [],
      commands: {},
    },
  });
  try {
    const { result } = renderHook(() => useRoute(manifest, { work: "shared" }));
    act(() =>
      acceptWork({
        kind: "snapshot",
        key: "queued-work",
        value: { revision: 0, doc: { values: {} } },
      } as never),
    );
    await act(async () => {
      const first = result.current.work.write([{ path: ["values", "a"], value: "1" }]);
      const second = result.current.work.write([{ path: ["values", "b"], value: "2" }]);
      expect(await Promise.all([first, second])).toEqual([null, null]);
    });
    expect(bodies.map((body) => body.expectedRevision)).toEqual([0, 1]);
  } finally {
    cleanup();
    fetch.mockRestore();
    subscribe.mockRestore();
  }
});

test("document-owned Work stays unbound until an Address or named workspace exists", () => {
  const requests: unknown[] = [];
  const subscribe = vi.spyOn(peReadings, "subscribe").mockImplementation((request) => {
    requests.push(request);
    return () => {};
  });
  const work = {
    route: "document-work-gate",
    title: "Document Work gate",
    description: "proof",
    schema: z.object({}),
    agentWriteMask: [],
    commands: {},
  };
  const manifest = defineRoute({
    key: "document-work-gate",
    name: "Document Work gate",
    needs: "project",
    work,
    actions: {
      save: {
        label: "save",
        says: "writes the selected document",
        needs: "project",
        actor: "human",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: [],
        requires: { work: true },
        ready: () => null,
        run: async () => {},
      },
    },
  });
  try {
    const unbound = renderHook(() => useRoute(manifest));
    expect(requests).not.toContainEqual(expect.objectContaining({ kind: "work" }));
    expect(unbound.result.current.work.doc).toBeNull();
    unbound.unmount();

    renderHook(() => useRoute(manifest, { work: "saved-review" }));
    expect(requests).toContainEqual({
      kind: "work",
      route: "document-work-gate",
      target: null,
      work: "saved-review",
    });
  } finally {
    cleanup();
    subscribe.mockRestore();
  }
});

test("a frozen seed owns an isolated registry, refuses actions, and never reaches live resources", async () => {
  const previousUrl = location.href;
  history.replaceState({}, "", "/?demo=show");
  let actionRan = false;
  const subscribe = vi.spyOn(peReadings, "subscribe").mockImplementation(() => () => {});
  const dirty = vi.spyOn(peReadings, "dirty").mockImplementation(() => {});
  const manifest = defineRoute({
    key: "seed-isolation",
    name: "Seed isolation",
    work: {
      route: "seed-isolation",
      title: "Seed isolation",
      description: "proof",
      schema: z.object({}),
      agentWriteMask: [],
      commands: {},
    },
    readings: {
      inventory: { kind: "inventory" },
      head: { kind: "thread-head", thread: "live-thread" },
    },
    actions: {
      show: {
        label: "show",
        says: "shows the seed",
        needs: "document",
        actor: "any",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: [],
        ready: () => null,
        run: async () => {
          actionRan = true;
        },
      },
    },
    seeds: {
      show: {
        title: "isolated",
        target: { kind: "document", ref: { session: "demo", openId: "demo" } },
        work: {},
        readings: {},
        page: {},
      },
    },
  });

  try {
    const { result } = renderHook(() => useRoute(manifest));
    expect(result.current.demo).toBe(true);
    expect(result.current.resolution).toEqual({
      kind: "resolved",
      target: { kind: "document", ref: { session: "demo", openId: "demo" } },
    });
    await act(async () => {
      expect(await result.current.work.write([])).toMatchObject({ code: "not-ready" });
    });
    await act(async () => {
      result.current.work.reload();
      expect(await result.current.actions.show.run()).toMatchObject({ code: "not-ready" });
    });
    expect(actionRan).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();
    expect(dirty).not.toHaveBeenCalled();
    expect(
      inspectAtomRegistry(appAtomRegistry)
        .inspect()
        .nodes.some((node) => node.label.startsWith("seed-isolation/")),
    ).toBe(false);
    const { work: _work, ...displayOnlyManifest } = manifest;
    const displayOnly = renderHook(() => useRoute(displayOnlyManifest));
    expect(displayOnly.result.current.work).toMatchObject({ doc: {}, revision: 0 });
    displayOnly.unmount();
  } finally {
    cleanup();
    history.replaceState({}, "", previousUrl);
    dirty.mockRestore();
    subscribe.mockRestore();
  }
});

test("disabled shared readings stay absent without subscribing", () => {
  const subscribe = vi.spyOn(peReadings, "subscribe").mockImplementation(() => () => {});
  try {
    const { result } = renderHook(() => ({
      host: useHostStatus(false),
      inventory: useInventory(false),
    }));
    expect(result.current).toEqual({
      host: { state: "absent" },
      inventory: { state: "absent" },
    });
    expect(subscribe).not.toHaveBeenCalled();
  } finally {
    cleanup();
    subscribe.mockRestore();
  }
});
