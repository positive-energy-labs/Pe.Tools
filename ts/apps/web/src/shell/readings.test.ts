import { describe, expect, it, vi } from "vite-plus/test";
import type { ActionReceipt, ExecutionTarget, ReadingDecl } from "@pe/agent-contracts";
import {
  createReadingGraph,
} from "./readings";
import {
  type ReadingContext,
  type ReadingDelivery,
  type ReadingLog,
  type ReadingScope,
  type ReadingSource,
  type UseSource,
} from "./source-contract";





type Page = { filter: string; pose: number };
const target = (openId = "A", session = "session"): ExecutionTarget => ({
  kind: "document",
  ref: { session, openId },
});
const scope = (overrides: Partial<ReadingScope<Page, { amount: number }>> = {}) => ({
  target: target(),
  workKey: { binding: "workspace" as const, route: "test", target: null, work: "work-A" },
  workRevision: 1,
  page: { filter: "all", pose: 0 },
  work: { amount: 1 },
  ...overrides,
});
const decl = (source: string, extra: Partial<ReadingDecl<Page>> = {}): ReadingDecl<Page> => ({
  kind: "use",
  source,
  retire: "target",
  ...extra,
});
function controlled<T = number>(kind: "use" | "feed" = "use") {
  const attempts: {
    context: ReadingContext;
    deliver: ReadingDelivery<T>;
    close: ReturnType<typeof vi.fn>;
  }[] = [];
  const source: UseSource<T> = {
    kind,
    open(context, deliver) {
      const close = vi.fn();
      attempts.push({ context, deliver, close });
      return close;
    },
  };
  return { source, attempts };
}
function fixture(
  readings: Record<string, ReadingDecl<Page>>,
  sources: Record<string, ReadingSource>,
) {
  const logs: ReadingLog[] = [];
  const graph = createReadingGraph(
    { readings },
    { sources, scope: scope(), log: (entry) => logs.push(entry) },
  );
  return { graph, logs };
}
const done = (deliver: ReadingDelivery<number>, value: number, revision = 1) =>
  deliver({ kind: "complete", value, revision, sourceVersion: `v${value}` });
const receipt = (
  overrides: Partial<Pick<ActionReceipt, "id" | "state" | "effects" | "target" | "input">> = {},
) => ({
  id: "receipt",
  state: "succeeded" as const,
  target: target(),
  effects: [{ kind: "document" as const, ref: { session: "session", openId: "A" } }],
  ...overrides,
});

describe("reading graph", () => {
  
  it("a failed prerequisite settles its dependent with the failure words even without a value", () => {
    const input = controlled();
    const derive = vi.fn(() => 1);
    const { graph } = fixture(
      { input: decl("input"), price: decl("price", { kind: "derive", deps: ["input"] }) },
      { input: input.source, price: { kind: "derive", derive } },
    );
    const release = graph.mount(["price"]);
    input.attempts[0]!.deliver({ kind: "failure", error: "No duct network" });
    expect(graph.get("price")).toMatchObject({
      status: "failed",
      error: "input failed: No duct network",
      current: false,
    });
    expect(derive).not.toHaveBeenCalled();
    release();
    graph.dispose();
  });
  

  

  

  

  

  

  

  

  

  it.each(["use", "feed"] as const)(
    "receipt-dirtied mounted %s reacquires with a fenced generation and derives from the new answer",
    (kind) => {
      const read = controlled(kind);
      const { graph, logs } = fixture(
        {
          model: decl("model", { kind }),
          twice: decl("twice", { kind: "derive", deps: ["model"] }),
        },
        {
          model: { ...read.source, dirties: ["snapshot"] },
          twice: { kind: "derive", derive: (ctx) => Number(ctx.inputs.model.value) * 2 },
        },
      );
      const release = graph.mount(["twice"]);
      const before = read.attempts[0];
      done(before.deliver, 2);
      expect(graph.get("twice")).toMatchObject({ value: 4, current: true });
      graph.acceptReceipt(receipt(), ["snapshot"]);
      expect(read.attempts).toHaveLength(2);
      const fresh = read.attempts[1];
      expect(before.context.signal.aborted).toBe(true);
      expect(fresh.context.attempt.generation).toBeGreaterThan(before.context.attempt.generation);
      expect(fresh.context.trigger.kind).toBe("demand");
      done(before.deliver, 99, 2);
      expect(graph.get("model").current).toBe(false);
      expect(graph.get("twice").current).toBe(false);
      expect(logs.at(-1)?.kind).toBe("drop");
      done(fresh.deliver, 3);
      expect(graph.get("twice")).toMatchObject({ value: 6, current: true });
      graph.acceptReceipt(receipt(), ["snapshot"]);
      expect(read.attempts).toHaveLength(2);
      release();
      graph.dispose();
    },
  );

  it("receipt-dirtied unmounted readings stay stale until new mounted demand", () => {
    const read = controlled();
    const { graph } = fixture({ model: decl("model") }, { model: read.source });
    const release = graph.mount(["model"]);
    done(read.attempts[0].deliver, 1);
    release();
    graph.acceptReceipt(receipt());
    expect(read.attempts).toHaveLength(1);
    expect(graph.get("model")).toMatchObject({ value: 1, current: false, status: "stale" });
    const remounted = graph.mount(["model"]);
    expect(read.attempts).toHaveLength(2);
    done(read.attempts[1].deliver, 2);
    expect(graph.get("model")).toMatchObject({ value: 2, current: true });
    remounted();
    graph.dispose();
  });

  

  it("receipt-dirtied mounted workers acquire a new generation and reject the old job's delivery", () => {
    const jobs: { context: ReadingContext; deliver: ReadingDelivery<number> }[] = [];
    const stop = vi.fn();
    const connect = vi.fn(() => ({
      update: (context: ReadingContext, deliver: ReadingDelivery<number>) => {
        jobs.push({ context, deliver });
      },
      stop,
    }));
    const { graph } = fixture(
      { price: decl("price", { kind: "worker" }) },
      { price: { kind: "worker", algorithmVersion: "v1", connect } },
    );
    const release = graph.mount(["price"]);
    const before = jobs[0];
    graph.acceptReceipt(receipt());
    expect(jobs).toHaveLength(2);
    expect(jobs[1].context.attempt.generation).toBeGreaterThan(before.context.attempt.generation);
    done(before.deliver, 1);
    expect(graph.get("price").current).toBe(false);
    done(jobs[1].deliver, 2);
    expect(graph.get("price")).toMatchObject({ value: 2, current: true });
    // The graph leases one worker across attempts; only the graph stops it.
    expect(connect).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    release();
    graph.dispose();
  });

  

  

  

  

  

  

  

  

  

  
});







// A stream may be alive yet never complete: progress cannot extend the attempt deadline.


