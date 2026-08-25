import { describe, expect, it, vi } from "vite-plus/test";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { inspectAtomRegistry } from "./atom-inspect";

const makeFixture = () => {
  const registry = AtomRegistry.make();
  const count = Atom.make(1).pipe(Atom.keepAlive, Atom.withLabel("test/count"));
  const doubled = Atom.make((get) => get(count) * 2).pipe(
    Atom.keepAlive,
    Atom.withLabel("test/doubled"),
  );
  registry.get(doubled);
  return { registry, count, doubled, inspector: inspectAtomRegistry(registry) };
};

describe("atom registry inspector", () => {
  it("reports the node census and dependency edges", () => {
    const { inspector } = makeFixture();
    const snapshot = inspector.inspect();

    expect(snapshot.census).toEqual({ nodes: 2, edges: 1, subscribed: 0 });
    expect(snapshot.nodes.map(({ label }) => label)).toEqual(["test/count", "test/doubled"]);
  });

  it("counts observed value changes and joins the latest cause", () => {
    const { registry, count, doubled, inspector } = makeFixture();

    inspector.note({ verb: "increment", key: "count" });
    registry.set(count, 2);
    registry.get(doubled);
    const snapshot = inspector.inspect();

    expect(snapshot.nodes.map(({ recomputes }) => recomputes)).toEqual([1, 1]);
    expect(snapshot.changes).toHaveLength(2);
    expect(snapshot.changes.every(({ cause }) => cause?.verb === "increment")).toBe(true);

    registry.set(count, 3);
    registry.get(doubled);
    expect(inspector.inspect().changes.at(-1)?.cause).toBeNull();
  });

  it("keeps only the last 100 observed changes", () => {
    const { registry, count, doubled, inspector } = makeFixture();

    for (let value = 2; value <= 106; value++) {
      inspector.note({ verb: "set", key: String(value) });
      registry.set(count, value);
      registry.get(doubled);
      inspector.inspect();
    }

    expect(inspector.inspect().changes).toHaveLength(100);
    expect(inspector.inspect().changes.at(-1)?.cause?.key).toBe("106");
  });

  it("changes the inspection snapshot when a verb note is observed", () => {
    vi.setSystemTime(new Date("2026-08-24T12:00:00Z"));
    const { registry, count, doubled, inspector } = makeFixture();
    const before = inspector.inspect();

    inspector.note({ verb: "increment", key: "count" });
    registry.set(count, 2);
    registry.get(doubled);

    expect(inspector.inspect()).not.toEqual(before);
    expect(inspector.inspect().changes.at(-1)?.cause).toEqual({ verb: "increment", key: "count" });
  });

  it("does not fire a host read while inspecting a cached feed", () => {
    const registry = AtomRegistry.make();
    const hostRead = vi.fn(() => AsyncResult.initial());
    const feed = Atom.make(hostRead).pipe(Atom.withLabel("test/feed"));
    registry.get(feed);
    hostRead.mockClear();

    inspectAtomRegistry(registry).inspect();

    expect(hostRead).not.toHaveBeenCalled();
  });
});
