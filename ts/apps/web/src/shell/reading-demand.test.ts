import { expect, test, vi } from "vite-plus/test";
import {
  createReadingGraph,
} from "./readings";
import {
  type ReadingContext,
  type ReadingDelivery,
  type ReadingScope} from "./source-contract";

test("observation, scope changes, invalidation and elapsed deadlines cannot fail an undemanded reading", () => {
  vi.useFakeTimers();
  const open = vi.fn((_ctx: ReadingContext, deliver: ReadingDelivery) =>
    deliver({ kind: "failure", error: "source refused" }),
  );
  const scope: ReadingScope = {
    target: { kind: "host" },
    workKey: null,
    workRevision: null,
    page: {},
    work: null,
  };
  const graph = createReadingGraph(
    { readings: { matrix: { kind: "use", source: "matrix", retire: "target" } } },
    {
      sources: { matrix: { kind: "use", open } },
      scope,
      log: () => {},
      waitS: 1,
    },
  );
  try {
    const unwatch = graph.subscribe("matrix", () => {});
    graph.update({ ...scope, target: { kind: "session", session: "next" } });
    graph.acceptReceipt({ id: "other", state: "succeeded", target: scope.target, effects: [] }, [
      "matrix",
    ]);
    vi.advanceTimersByTime(10_000);
    expect(open).not.toHaveBeenCalled();
    expect(graph.get("matrix").status).not.toBe("failed");
    expect(graph.status(["matrix"])).not.toContain("failed");
    const release = graph.mount(["matrix"]);
    expect(open).toHaveBeenCalledTimes(1);
    expect(graph.get("matrix")).toMatchObject({ status: "failed", error: "source refused" });
    release();
    unwatch();
  } finally {
    graph.dispose();
    vi.useRealTimers();
  }
});
