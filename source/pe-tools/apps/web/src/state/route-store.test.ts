import { Effect } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { defineRouteState } from "@pe/agent-contracts";

import {
  createRouteStoreCore,
  docAtom,
  feed,
  hostRead,
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
    await expect(core.runVerb("bad", async () => Promise.reject(hostError))).rejects.toBe(hostError);
    expect(registry.get(core.failure)).toMatchObject({ kind: "host", message: "host broke" });
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

  it("returns one document atom for the same route and thread", () => {
    const spec = defineRouteState({
      route: "test-route",
      title: "Test",
      description: "Test",
      schema: z.object({ value: z.string() }),
      agentWriteMask: [],
      commands: {},
    });

    expect(docAtom(spec, { threadId: "thread-1" })).toBe(
      docAtom({ ...spec }, { threadId: "thread-1" }),
    );
    expect(docAtom(spec, { threadId: "thread-2" })).not.toBe(
      docAtom(spec, { threadId: "thread-1" }),
    );
  });
});
