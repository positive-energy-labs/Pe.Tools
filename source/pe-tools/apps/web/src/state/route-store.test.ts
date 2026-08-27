import { Effect } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { address, type RouteStateSpec } from "@pe/agent-contracts";

import { inspectAtomRegistry } from "./atom-inspect";
import {
  createRouteStoreCore,
  docAtom,
  docWriter,
  feed,
  hostRead,
  routeConflictAtom,
  type Slice,
  unbound,
  VerbRefused,
} from "./route-store";

describe("route store kit", () => {
  it("projects every feed state and keeps lane, stale, and seam honest", async () => {
    const read = await Effect.runPromise(hostRead(["doc"], async () => ["a"]));
    const seam = { needs: "a document" };
    const options = (values: string[]) => values.map((id) => ({ id, label: id }));
    const rows = [
      feed(AsyncResult.initial(), options, "read", seam),
      feed(AsyncResult.fail(Error("nope")), options, "live", seam),
      feed(AsyncResult.success(unbound<string[]>([], ["none"])), options, "fixture", seam),
      feed(AsyncResult.success(read), options, "read", seam),
      feed(AsyncResult.success(read, { waiting: true }), options, "read", seam),
    ];

    expect(rows.map(({ state, lane, stale, seam }) => [state, lane, stale, seam?.needs])).toEqual([
      ["loading", "read", false, "a document"],
      ["error", "live", false, "a document"],
      ["ready", "fixture", false, "a document"],
      ["ready", "read", false, undefined],
      ["ready", "read", true, undefined],
    ]);
    expect(rows[1]?.note).toContain("nope");
    expect(rows[3]).toMatchObject({ options: [{ id: "a", label: "a" }], basis: ["doc"] });
  });

  it("refuses overlap, rethrows host errors, receipts success, and invalidates named keys", async () => {
    const registry = AtomRegistry.make();
    const set = registry.set.bind(registry);
    const writes: unknown[] = [];
    Reflect.set(registry, "set", (atom: Atom.Writable<any, any>, value: unknown) => {
      writes.push(value);
      set(atom, value);
    });
    const core = createRouteStoreCore("test", registry);
    let finish!: () => void;
    const first = core.runVerb(
      "first",
      () => new Promise<string>((resolve) => (finish = () => resolve("done"))),
      ["snapshot"],
    );
    await Promise.resolve();

    await expect(core.runVerb("second", async () => "no")).rejects.toBeInstanceOf(VerbRefused);
    expect(registry.get(core.failure)).toMatchObject({ kind: "busy", verb: "second" });
    finish();
    await expect(first).resolves.toBe("done");
    expect(registry.get(core.receipt)).toMatchObject({ verb: "first", text: "done" });
    expect(writes).toContainEqual(["snapshot"]);
    expect(writes.findIndex((value) => value === registry.get(core.receipt))).toBeLessThan(
      writes.findIndex((value) => Array.isArray(value) && value[0] === "snapshot"),
    );

    const hostError = Error("host broke");
    await expect(core.runVerb("bad", async () => Promise.reject(hostError))).rejects.toBe(
      hostError,
    );
    expect(registry.get(core.failure)).toMatchObject({ kind: "host", message: "host broke" });
    await expect(
      core.runVerb("write", async () => ({
        ok: false,
        error: "the patched document is invalid",
        hint: "snapshot.world.zones.43.zone.color: expected string",
      })),
    ).rejects.toThrow(
      "the patched document is invalid: snapshot.world.zones.43.zone.color: expected string",
    );
    expect(registry.get(core.failure)).toMatchObject({
      kind: "host",
      verb: "write",
      message:
        "the patched document is invalid: snapshot.world.zones.43.zone.color: expected string",
    });
    expect(registry.get(core.receipt)).toBeNull();
    core.dispose();
  });

  it("disposes once and releases owned mounts in reverse order", () => {
    const registry = AtomRegistry.make();
    const mount = registry.mount.bind(registry);
    const released: string[] = [];
    Reflect.set(registry, "mount", (atom: Atom.Atom<any>) => {
      const release = mount(atom);
      return () => {
        released.push(atom.label?.[0] ?? "unlabelled");
        release();
      };
    });
    const core = createRouteStoreCore("test", registry);
    core.owned("a", Atom.make(1));
    core.owned("b", Atom.make(2));

    core.dispose();
    const releasedOnce = released.length;
    core.dispose();

    expect(released.slice(0, 2)).toEqual(["test/b", "test/a"]);
    expect(released).toHaveLength(releasedOnce);
  });

  it("keeps the app inspector live when one of two route stores is disposed", async () => {
    vi.useFakeTimers();
    const registry = AtomRegistry.make({ defaultIdleTTL: 4 });
    const first = createRouteStoreCore("first", registry);
    const second = createRouteStoreCore("second", registry);
    first.owned("value", Atom.make(1));
    const remaining = second.owned("value", Atom.make(1));
    const inspector = inspectAtomRegistry(registry);
    const changed = vi.fn();
    const unsubscribe = inspector.subscribe(changed);
    try {
      inspector.inspect();
      first.dispose();
      registry.set(remaining, 2);
      await vi.advanceTimersByTimeAsync(100);
      expect(changed).toHaveBeenCalled();
      const node = inspector.inspect().nodes.find(({ label }) => label === "second/value");
      expect(node).toBeDefined();
      expect(inspector.refresh(node!.id)).toBe(true);
    } finally {
      unsubscribe();
      inspector.dispose();
      first.dispose();
      second.dispose();
      registry.dispose();
      vi.useRealTimers();
    }
  });

  it("returns the registry node census to baseline after disposal and idle TTL", async () => {
    vi.useFakeTimers();
    const registry = AtomRegistry.make({ defaultIdleTTL: 4 });
    const baseline = registry.getNodes().size;
    const core = createRouteStoreCore("test", registry);
    core.owned("value", Atom.make(1));
    try {
      expect(registry.getNodes().size).toBeGreaterThan(baseline);
      core.dispose();
      await vi.advanceTimersByTimeAsync(20);
      expect(registry.getNodes().size).toBe(baseline);
    } finally {
      core.dispose();
      registry.dispose();
      vi.useRealTimers();
    }
  });

  it("returns one document atom for the same route and thread", () => {
    const schema = z.object({ value: z.string() });
    const spec = {
      route: "test-route",
      title: "Test",
      description: "Test",
      schema,
      agentWriteMask: [],
      commands: {},
    } satisfies RouteStateSpec<typeof schema>;

    expect(docAtom(spec, { documentAddress: address("C:\\Models\\One.rvt") })).toBe(
      docAtom({ ...spec }, { documentAddress: address("C:\\Models\\One.rvt") }),
    );
    expect(docAtom(spec, { documentAddress: address("C:\\Models\\Two.rvt") })).not.toBe(
      docAtom(spec, { documentAddress: address("C:\\Models\\One.rvt") }),
    );
  });

  it("carries revisions and external ids, advances successful writes, and types conflicts", async () => {
    const schema = z.object({ value: z.string() });
    const spec = {
      route: "test-route",
      title: "Test",
      description: "Test",
      schema,
      agentWriteMask: [],
      commands: {
        local: { description: "Local", actor: "any", input: z.object({}) },
        external: {
          description: "External",
          actor: "human",
          input: z.object({}),
          mutatesExternal: true,
        },
      },
    } satisfies RouteStateSpec<typeof schema>;
    const registry = AtomRegistry.make({ defaultIdleTTL: 400 });
    const core = createRouteStoreCore("test-writer", registry);
    const slice = core.owned(
      "slice/document",
      Atom.make<AsyncResult.AsyncResult<Slice<z.infer<typeof schema>>, Error>>(
        AsyncResult.initial(),
      ),
    );
    const response = (body: unknown) => Response.json(body);
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ ok: true, revision: 8 }))
      .mockResolvedValueOnce(response({ ok: true, revision: 9 }))
      .mockResolvedValueOnce(response({ ok: true, revision: 10 }))
      .mockResolvedValueOnce(response({ ok: false, code: "request_id_conflict" }))
      .mockResolvedValueOnce(response({ ok: false, code: "stale_revision" }));
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000005",
    );
    const writer = docWriter(
      spec,
      { documentAddress: address("C:\\Models\\One.rvt") },
      registry,
      slice,
    );
    registry.set(routeConflictAtom, false);

    await expect(writer.apply([{ path: ["value"], value: "next" }])).resolves.toMatchObject({
      ok: false,
      error: "route document is not hydrated",
    });
    expect(request).not.toHaveBeenCalled();
    registry.set(
      slice,
      AsyncResult.success({
        doc: { value: "before" },
        revision: 7,
        hydrated: true,
        connected: true,
        error: null,
        peaActive: false,
      }),
    );
    await writer.apply([{ path: ["value"], value: "next" }]);
    await writer.command("local", {});
    await writer.command("external", {});
    await writer.command("local", {});
    expect(registry.get(routeConflictAtom)).toBe(false);
    await writer.apply([{ path: ["value"], value: "draft" }], 3);

    expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({
      patches: [{ path: ["value"], value: "next" }],
      expectedRevision: 7,
    });
    expect(JSON.parse(request.mock.calls[1]![1]!.body as string)).toEqual({
      command: "local",
      input: {},
      expectedRevision: 8,
    });
    expect(JSON.parse(request.mock.calls[2]![1]!.body as string)).toEqual({
      command: "external",
      input: {},
      expectedRevision: 9,
      requestId: "00000000-0000-4000-8000-000000000005",
    });
    expect(JSON.parse(request.mock.calls[3]![1]!.body as string)).toEqual({
      command: "local",
      input: {},
      expectedRevision: 10,
    });
    expect(JSON.parse(request.mock.calls[4]![1]!.body as string)).toEqual({
      patches: [{ path: ["value"], value: "draft" }],
      expectedRevision: 3,
    });
    expect(registry.get(routeConflictAtom)).toBe(true);
    core.dispose();
    registry.dispose();
  });
});
