import { describe, expect, it, vi } from "vite-plus/test";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { inspectAtomRegistry } from "./atom-inspect";

const withoutTimes = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutTimes);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "at" && key !== "lastChangeAt")
        .map(([key, child]) => [key, withoutTimes(child)]),
    );
  return value;
};

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
    const snapshot = inspector.snapshot();

    expect(snapshot.census).toEqual({ nodes: 2, edges: 1, subscribed: 0 });
    expect(snapshot.nodes.map(({ label }) => label)).toEqual(["test/count", "test/doubled"]);
  });

  it("counts observed value changes and joins the latest cause", () => {
    const { registry, count, doubled, inspector } = makeFixture();

    inspector.note({ verb: "increment", key: "count" });
    registry.set(count, 2);
    registry.get(doubled);
    const snapshot = inspector.snapshot();

    expect(snapshot.nodes.map(({ recomputes }) => recomputes)).toEqual([1, 1]);
    expect(snapshot.changes).toHaveLength(2);
    expect(snapshot.changes.every(({ cause }) => cause?.verb === "increment")).toBe(true);
  });

  it("keeps only the last 100 observed changes", () => {
    const { registry, count, doubled, inspector } = makeFixture();

    for (let value = 2; value <= 106; value++) {
      inspector.note({ verb: "set", key: String(value) });
      registry.set(count, value);
      registry.get(doubled);
      inspector.snapshot();
    }

    expect(inspector.snapshot().changes).toHaveLength(100);
    expect(inspector.snapshot().changes.at(-1)?.cause?.key).toBe("106");
  });

  it("returns deterministic snapshots when the registry is unchanged", () => {
    vi.setSystemTime(new Date("2026-08-24T12:00:00Z"));
    const { inspector } = makeFixture();

    expect(withoutTimes(inspector.snapshot())).toEqual(withoutTimes(inspector.snapshot()));
  });
});
