// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { peReadings, useHostStatus, useInventory } from "#/readings";
import { inspectAtomRegistry } from "#/state/atom-inspect";
import { defineRoute } from "./manifest";
import { Situation } from "./situation";
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

test("a late action write keeps the Work revision it computed from", async () => {
  let acceptWork!: Parameters<typeof peReadings.subscribe>[1];
  const subscribe = vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    if (request.kind === "work") acceptWork = accept;
    return () => {};
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let revision = 1;
  let value = "original";
  let nativeCalls = 0;
  const bodies: Array<{ expectedRevision: number }> = [];
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (typeof input === "string" && input.endsWith("/call")) {
      nativeCalls += 1;
      return new Response(JSON.stringify({ outcome: "Succeeded" }));
    }
    if (typeof init?.body !== "string") throw Error("expected a JSON request body");
    const body = JSON.parse(init.body) as {
      patches: Array<{ value: string }>;
      expectedRevision: number;
    };
    bodies.push(body);
    if (body.expectedRevision !== revision)
      return new Response(
        JSON.stringify({
          kind: "refused",
          ok: false,
          code: "stale_revision",
          error: "someone wrote first",
        }),
        { status: 409 },
      );
    value = body.patches[0]!.value;
    return new Response(JSON.stringify({ ok: true, revision: ++revision }));
  });
  const manifest = defineRoute({
    key: "late-write",
    name: "Late write",
    work: {
      route: "late-write",
      title: "Late write",
      description: "proof",
      schema: z.object({ value: z.string() }),
      agentWriteMask: [],
      commands: {},
    },
    actions: {
      compute: {
        label: "compute",
        says: "writes from one snapshot",
        needs: "host",
        actor: "any",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: [],
        requires: { work: true },
        ready: () => null,
        run: async (ctx) => {
          const computed = `${ctx.work.doc!.value}-computed`;
          await ctx.call("native.once");
          await held;
          await ctx.write([{ path: ["value"], value: computed }]);
        },
      },
    },
  });
  try {
    const { result } = renderHook(() => useRoute(manifest, { work: "shared" }));
    act(() =>
      acceptWork({
        kind: "snapshot",
        key: "late-write",
        value: { revision, doc: { value } },
      } as never),
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.actions.compute.run();
    });
    revision = 2;
    value = "newer";
    act(() =>
      acceptWork({
        kind: "snapshot",
        key: "late-write",
        value: { revision, doc: { value } },
      } as never),
    );
    await act(async () => {
      release();
      expect(await pending).toMatchObject({ code: "stale-revision" });
    });
    expect(bodies.map((body) => body.expectedRevision)).toEqual([1]);
    expect({ revision, value }).toEqual({ revision: 2, value: "newer" });
    expect(nativeCalls).toBe(1);
  } finally {
    cleanup();
    fetch.mockRestore();
    subscribe.mockRestore();
  }
});

test("action commands use their snapshot revision on immediate and late runs", async () => {
  let acceptWork!: Parameters<typeof peReadings.subscribe>[1];
  const subscribe = vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    if (request.kind === "work") acceptWork = accept;
    return () => {};
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let serverRevision = 4;
  const revisions: number[] = [];
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    if (typeof init?.body !== "string") throw Error("expected a JSON request body");
    const body = JSON.parse(init.body) as { expectedRevision: number };
    revisions.push(body.expectedRevision);
    if (body.expectedRevision !== serverRevision)
      return new Response(
        JSON.stringify({
          kind: "refused",
          ok: false,
          code: "stale_revision",
          error: "someone wrote first",
        }),
        { status: 409 },
      );
    return new Response(JSON.stringify({ ok: true, revision: ++serverRevision }));
  });
  const manifest = defineRoute({
    key: "action-command-revision",
    name: "Action command revision",
    work: {
      route: "action-command-revision",
      title: "Action command revision",
      description: "proof",
      schema: z.object({ value: z.string() }),
      agentWriteMask: [],
      commands: {
        save: { description: "save", input: z.object({}), actor: "human" },
      },
    },
    actions: {
      save: {
        label: "save",
        says: "commands from one snapshot",
        needs: "host",
        actor: "human",
        input: z.boolean() as unknown as z.ZodType<never>,
        dirties: [],
        requires: { work: true },
        ready: () => null,
        run: async (ctx, wait: boolean) => {
          if (wait) await held;
          await ctx.command("save");
        },
      },
    },
  });
  try {
    const { result } = renderHook(() => useRoute(manifest, { work: "shared" }));
    const publish = (revision: number) =>
      act(() =>
        acceptWork({
          kind: "snapshot",
          key: "action-command-revision",
          value: { revision, doc: { value: `r${revision}` } },
        } as never),
      );
    publish(4);
    await act(async () => expect(await result.current.actions.save.run(false)).toBeNull());
    publish(5);
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.actions.save.run(true);
    });
    serverRevision = 6;
    publish(6);
    await act(async () => {
      release();
      expect(await pending).toMatchObject({ code: "stale-revision" });
    });
    expect(revisions).toEqual([4, 5]);
  } finally {
    cleanup();
    fetch.mockRestore();
    subscribe.mockRestore();
  }
});

test("an action initializes current absent Work at revision zero", async () => {
  let acceptWork!: Parameters<typeof peReadings.subscribe>[1];
  const subscribe = vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    if (request.kind === "work") acceptWork = accept;
    return () => {};
  });
  let expectedRevision: number | undefined;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    if (typeof init?.body !== "string") throw Error("expected a JSON request body");
    expectedRevision = (JSON.parse(init.body) as { expectedRevision: number }).expectedRevision;
    return new Response(JSON.stringify({ ok: true, revision: 1 }));
  });
  const manifest = defineRoute({
    key: "initialize-absent",
    name: "Initialize absent",
    work: {
      route: "initialize-absent",
      title: "Initialize absent",
      description: "proof",
      schema: z.object({ value: z.string().optional() }),
      agentWriteMask: [],
      commands: {},
    },
    actions: {
      initialize: {
        label: "initialize",
        says: "starts Work",
        needs: "host",
        actor: "human",
        input: z.void() as unknown as z.ZodType<never>,
        dirties: [],
        ready: () => null,
        run: (ctx) => ctx.write([{ path: ["value"], value: "first" }]),
      },
    },
  });
  try {
    const { result } = renderHook(() => useRoute(manifest, { work: "shared" }));
    act(() => acceptWork({ kind: "snapshot", key: "initialize-absent", value: null } as never));
    await act(async () => expect(await result.current.actions.initialize.run()).toBeNull());
    expect(expectedRevision).toBe(0);
  } finally {
    cleanup();
    fetch.mockRestore();
    subscribe.mockRestore();
  }
});

/**
 * The kernel's inventory atom is shared and lives ~400 ms past its last unmount, so a test that
 * needs to feed the inventory itself waits for the previous mount to be disposed first.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 450));

const openInventory = (address: string | null) => ({
  kind: "snapshot",
  key: "inventory",
  value: {
    sessions: [
      {
        connected: true,
        sessionId: "revit",
        sdkSessionId: "friendly-recovery-name",
        openDocumentCount: 1,
        openDocuments: [{ openId: "doc", address, title: "Unsaved", isFamilyDocument: false }],
      },
    ],
  },
});

const gateManifest = () =>
  defineRoute({
    key: "document-work-gate",
    name: "Document Work gate",
    needs: "project",
    work: {
      route: "document-work-gate",
      title: "Document Work gate",
      description: "proof",
      schema: z.object({}),
      agentWriteMask: [],
      commands: {},
    },
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

const PIN = JSON.stringify({ kind: "open", ref: { session: "revit", openId: "doc" } });

test("an unsaved document's Work subscribes under its exact open lifetime", async () => {
  await settle();
  const requests: unknown[] = [];
  let inventory!: Parameters<typeof peReadings.subscribe>[1];
  const subscribe = vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    requests.push(request);
    if (request.kind === "inventory") inventory = accept;
    return () => {};
  });
  const manifest = gateManifest();
  try {
    // Nothing bound at all: there is no lifetime to key by and no Work is asked for.
    const unbound = renderHook(() => useRoute(manifest));
    expect(requests).not.toContainEqual(expect.objectContaining({ kind: "work" }));
    expect(unbound.result.current.work.doc).toBeNull();
    expect(unbound.result.current.work.ephemeral).toBe(false);
    unbound.unmount();

    // A bound document with no Address: the Work keys by `{ session, openId }`, never by title
    // and never by an invented Address.
    const open = renderHook(() => useRoute(manifest, { target: PIN }));
    act(() => inventory(openInventory(null) as never));
    expect(requests).toContainEqual({
      kind: "work",
      route: "document-work-gate",
      target: null,
      open: { session: "revit", openId: "doc" },
    });
    expect(open.result.current.work.key).toMatchObject({
      target: null,
      open: { session: "revit", openId: "doc" },
    });
    expect(open.result.current.work.ephemeral).toBe(true);
    open.unmount();

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

test("Save As moves the Work key to the Address and carries the open lifetime with it", async () => {
  await settle();
  const requests: unknown[] = [];
  let inventory!: Parameters<typeof peReadings.subscribe>[1];
  const subscribe = vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    requests.push(request);
    if (request.kind === "inventory") inventory = accept;
    return () => {};
  });
  const manifest = gateManifest();
  try {
    const { result } = renderHook(() => useRoute(manifest, { target: PIN }));
    act(() => inventory(openInventory(null) as never));
    expect(result.current.work.ephemeral).toBe(true);

    // Save As: the same lifetime now has an Address. The key moves, and the lifetime rides along
    // so the host can carry the addressless Work over exactly once.
    act(() => inventory(openInventory("C:\\Models\\Saved.rvt") as never));
    expect(result.current.work.key).toMatchObject({
      target: "C:\\Models\\Saved.rvt",
      open: { session: "revit", openId: "doc" },
    });
    expect(result.current.work.ephemeral).toBe(false);
    expect(requests).toContainEqual({
      kind: "work",
      route: "document-work-gate",
      target: "C:\\Models\\Saved.rvt",
      open: { session: "revit", openId: "doc" },
    });
  } finally {
    cleanup();
    subscribe.mockRestore();
  }
});

test("the unsaved document closes: the host's discard draws the receipt, the web asks for nothing", async () => {
  await settle();
  let inventory!: Parameters<typeof peReadings.subscribe>[1];
  let world!: Parameters<typeof peReadings.subscribe>[1];
  const subscribe = vi.spyOn(peReadings, "subscribe").mockImplementation((request, accept) => {
    if (request.kind === "inventory") inventory = accept;
    if (request.kind === "world") world = accept;
    return () => {};
  });
  const posts: string[] = [];
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    posts.push(input as string);
    return new Response(JSON.stringify({ ok: true, revision: 0 }));
  });
  const manifest = gateManifest();
  const Harness = () => {
    const handle = useRoute(manifest, { target: PIN });
    return <Situation handle={handle} sentence={null} target={{ session: null, document: null }} />;
  };
  try {
    const view = render(<Harness />);
    act(() => inventory(openInventory(null) as never));
    expect(view.queryByText(/unsaved document closed/)).toBeNull();

    // The host swept the Work when the document closed and says what it removed. The web never
    // asked for it: no discard is posted, before or after the inventory catches up.
    await act(async () => {
      world({
        kind: "event",
        key: "world",
        value: {
          type: "route_workspace",
          action: "discard",
          route: "document-work-gate",
          scope: {
            route: "document-work-gate",
            target: null,
            open: { session: "revit", openId: "doc" },
          },
          removed: 1,
          ok: true,
        },
      } as never);
    });
    expect(
      view.getByText("unsaved document closed — the Work staged on it was discarded"),
    ).toBeTruthy();
    expect(posts.filter((url) => url.includes("/discard"))).toEqual([]);

    // No confirm dialog: the receipt is dismissable and nothing is asked of the person.
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: /dismiss/i }));
    });
    expect(view.queryByText(/unsaved document closed/)).toBeNull();
  } finally {
    cleanup();
    fetch.mockRestore();
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
