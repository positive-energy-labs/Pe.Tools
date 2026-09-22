import { describe, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { inspectAtomRegistry } from "./atom-inspect";

describe("read-only owner inspector", () => {
  it("retains original token, observation subject, request and causal evidence without starting producers", () => {
    const registry = AtomRegistry.make();
    const service = vi.fn(() => Effect.succeed(1));
    const producer = Atom.make(Effect.suspend(service));
    const work = Atom.make({
      revision: 3,
      basis: { versionToken: "original-file-token" },
      proposal: "edited",
    });
    const reading = Atom.make(
      AsyncResult.success({ subject: { session: "A", openId: "original" }, status: "ready" }),
    );
    const operation = Atom.make({
      request: { zoneGuid: "original-zone" },
      destination: { openId: "original" },
      steps: [{ key: "native", requestId: "original-request" }],
      cause: null,
    });
    registry.get(work);
    registry.get(reading);
    registry.get(operation);
    const inspector = inspectAtomRegistry(registry);
    const before = registry.getNodes().size;
    const release = inspector.expose("pane-a", {
      work: { authored: work },
      readings: { snapshot: reading, unstarted: producer },
      operations: { admitted: operation },
    });
    const changed = vi.fn();
    const unsubscribe = inspector.subscribe(changed);
    const snapshot = inspector.inspect();
    expect(service).not.toHaveBeenCalled();
    expect(registry.getNodes().size).toBe(before);
    expect(registry.get(work).revision).toBe(3);
    const text = JSON.stringify(snapshot.owners);
    for (const original of ["original-file-token", "original-zone", "original-request", "original"])
      expect(text).toContain(original);
    expect(snapshot.owners[0]?.references.readings?.unstarted).toMatchObject({
      state: "uninitialized",
      value: null,
    });
    expect(inspector).not.toHaveProperty("set");
    expect(inspector).not.toHaveProperty("refresh");
    expect(inspector).not.toHaveProperty("note");
    unsubscribe();
    release();
    registry.dispose();
  });

  it("never recomputes a stale producer or attributes an unrelated write", () => {
    const registry = AtomRegistry.make();
    const count = Atom.make(1).pipe(Atom.keepAlive);
    const read = vi.fn();
    const derived = Atom.make((get) => {
      read();
      return get(count) * 2;
    }).pipe(Atom.keepAlive);
    registry.get(derived);
    const inspector = inspectAtomRegistry(registry);
    const stop = inspector.subscribe(() => inspector.inspect());
    registry.set(count, 2);
    const calls = read.mock.calls.length;
    inspector.inspect();
    inspector.notify();
    expect(read).toHaveBeenCalledTimes(calls);
    expect(inspector.inspect()).not.toHaveProperty("changes");
    stop();
    registry.dispose();
  });
});
