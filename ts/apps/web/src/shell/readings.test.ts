import type { ActionReceipt, ExecutionTarget, ReadingDecl } from "@pe/agent-contracts";
import { describe, expect, it, vi } from "vite-plus/test";
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

it("receipt invalidation neither reopens ports nor retries a timed-out verb capture", () => {
    const input = controlled();
    const capture = controlled();
    const close = vi.fn();
    const open = vi.fn(() => ({ value: "service", close }));
    const { graph } = fixture(
      {
        input: decl("input"),
        native: decl("native", { deps: ["input"] }),
        service: decl("service", { kind: "port", deps: ["input"] }),
      },
      { input: input.source, native: capture.source, service: { kind: "port", open } },
    );
    const release = graph.mount(["native", "service"]);
    done(input.attempts[0].deliver, 1);
    graph.start("native", "capture");
    const timedOut = capture.attempts.at(-1)!;
    timedOut.deliver({ kind: "failure", error: "Native operation timed out" });
    const count = capture.attempts.length;
    graph.acceptReceipt(receipt({ state: "unknown" }));
    done(input.attempts.at(-1)!.deliver, 2);
    expect(capture.attempts).toHaveLength(count);
    expect(timedOut.context.signal.aborted).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(graph.get("service")).toMatchObject({ value: "service", current: true });
    graph.start("native", "inspected-retry");
    expect(capture.attempts).toHaveLength(count + 1);
    release();
    graph.dispose();
    expect(close).toHaveBeenCalledTimes(1);
  });

it("invalidation releases invocation demand instead of leaving an aborted capture pinned", () => {
    const read = controlled();
    const { graph } = fixture({ matrix: decl("read") }, { read: read.source });
    graph.start("matrix", "capture");
    const old = read.attempts[0];
    graph.documentChanged({ session: "session", openId: "A" });
    expect(old.close).toHaveBeenCalledTimes(1);
    const release = graph.mount(["matrix"]);
    // Invalidation never blindly retries. A new press is needed after inspecting the cause.
    expect(read.attempts).toHaveLength(1);
    release();
    graph.start("matrix", "new-capture");
    const fresh = read.attempts.at(-1)!;
    done(fresh.deliver, 1);
    graph.finish("matrix", "new-capture");
    expect(fresh.close).toHaveBeenCalledTimes(1);
    expect(graph.get("matrix")).toMatchObject({ value: 1, current: false });
    graph.dispose();
  });

it("publishes verb pending before acquisition and survives pane unmount until completion", () => {
    const read = controlled();
    const { graph } = fixture({ matrix: decl("read") }, { read: read.source });
    const release = graph.mount(["matrix"]);
    const seen: string[] = [];
    const unwatch = graph.subscribe("matrix", () => seen.push(graph.get("matrix").status));
    const attempt = graph.start("matrix", "press");
    expect(seen[0]).toBe("pending");
    const capture = read.attempts.at(-1)!;
    expect(capture.context.attempt).toBe(attempt);
    expect(read.attempts[0].context.trigger).toEqual({ kind: "demand" });
    expect(capture.context.trigger).toEqual({ kind: "verb", invocation: "press" });
    release();
    expect(capture.context.signal.aborted).toBe(false);
    capture.deliver({ kind: "part", value: 1, revision: 1 });
    expect(graph.get("matrix").current).toBe(false);
    done(capture.deliver, 2, 2);
    // Its invocation can consume the fresh basis even after its pane left.
    expect(graph.get("matrix")).toMatchObject({ value: 2, complete: true, current: true });
    expect(capture.close).not.toHaveBeenCalled();
    graph.finish("matrix", "other-press");
    expect(capture.close).not.toHaveBeenCalled();
    graph.finish("matrix", "press");
    expect(graph.get("matrix")).toMatchObject({ value: 2, complete: true, current: false });
    expect(capture.close).toHaveBeenCalledTimes(1);
    expect(capture.context.signal.aborted).toBe(true);
    unwatch();
    graph.dispose();
  });

it("pane release retains its subscription; explicit Stop revokes every publication path", () => {
    const read = controlled();
    const { graph, logs } = fixture({ matrix: decl("read") }, { read: read.source });
    const release = graph.mount(["matrix"]);
    const paneRead = read.attempts[0];
    release();
    // ADR 0027 rule 9: a hidden pane keeps its demand subscription and its old content.
    expect(paneRead.context.signal.aborted).toBe(false);
    done(paneRead.deliver, 1);
    expect(graph.get("matrix")).toMatchObject({ value: 1, current: true });
    graph.start("matrix", "press");
    const verbRead = read.attempts.at(-1)!;
    graph.cancel("matrix", "other-press");
    expect(verbRead.context.signal.aborted).toBe(false);
    graph.cancel("matrix", "press");
    done(verbRead.deliver, 2);
    expect(graph.get("matrix").current).toBe(false);
    expect(logs.filter((log) => log.kind === "drop")).toHaveLength(1);
    graph.dispose();
  });

});

// A stream may be alive yet never complete: progress cannot extend the attempt deadline.
