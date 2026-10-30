import { describe, expect, it, vi } from "vite-plus/test";
import type { ActionReceipt, ExecutionTarget, ReadingDecl } from "@pe/agent-contracts";
import {
  createReadingGraph,
  ReadingGraphRefusal,
  type ReadingContext,
  type ReadingDelivery,
  type ReadingLog,
  type ReadingScope,
  type ReadingSource,
  type UseSource,
} from "./readings";
import { workerSource, type ReadingWorkerPort, type ReadingWorkerRequest } from "./readings-worker";
import { subscriptionSource } from "./readings-use";
import type { Readings } from "../readings";

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
  overrides: Partial<Pick<ActionReceipt, "id" | "state" | "effects" | "target">> = {},
) => ({
  id: "receipt",
  state: "succeeded" as const,
  target: target(),
  effects: [{ kind: "document" as const, ref: { session: "session", openId: "A" } }],
  ...overrides,
});

describe("reading graph", () => {
  it("fences all first-A deliveries after A → B → A, even with the same Work and args", () => {
    const read = controlled();
    const { graph, logs } = fixture({ matrix: decl("matrix") }, { matrix: read.source });
    const release = graph.mount(["matrix"]);
    graph.start("matrix", "press-A");
    const firstA = read.attempts.at(-1)!;
    firstA.deliver({ kind: "part", value: 1, revision: 1 });
    expect(graph.get("matrix")).toMatchObject({
      status: "partial",
      current: false,
      complete: false,
    });
    graph.update(scope({ target: target("B") }));
    graph.update(scope());
    const returnedA = read.attempts.at(-1)!;
    const before = graph.get("matrix");
    firstA.deliver({ kind: "part", value: 100, revision: 2 });
    done(firstA.deliver, 200, 3);
    firstA.deliver({ kind: "failure", error: "late error" });
    expect(graph.get("matrix")).toBe(before);
    expect(firstA.context.signal.aborted).toBe(true);
    expect(returnedA.context.attempt.generation).toBeGreaterThan(firstA.context.attempt.generation);
    expect(logs.filter((log) => log.kind === "drop")).toHaveLength(3);
    done(returnedA.deliver, 3);
    expect(graph.get("matrix")).toMatchObject({ value: 3, current: true, complete: true });
    expect(graph.get("matrix").basis?.attempt).toEqual(returnedA.context.attempt);
    release();
    graph.dispose();
  });

  it("retires on independent Work identity changes and never reuses a generation", () => {
    const read = controlled();
    const { graph } = fixture(
      { reading: decl("read", { retire: "never" }) },
      { read: read.source },
    );
    const release = graph.mount(["reading"]);
    const old = read.attempts[0];
    graph.update(
      scope({ workKey: { binding: "workspace", route: "test", target: null, work: "work-2" } }),
    );
    graph.update(scope());
    done(old.deliver, 1);
    expect(graph.get("reading").current).toBe(false);
    expect(read.attempts.map((a) => a.context.attempt.generation)).toEqual([1, 2, 3]);
    release();
    graph.dispose();
  });

  it("derives topologically only when declared dependencies change", () => {
    const a = controlled();
    const b = controlled();
    const derive = vi.fn((context: ReadingContext) => Number(context.inputs.a.value) * 2);
    const { graph } = fixture(
      {
        twice: decl("twice", { kind: "derive", deps: ["a"] }),
        a: decl("a"),
        b: decl("b"),
      },
      { a: a.source, b: b.source, twice: { kind: "derive", derive } },
    );
    const release = graph.mount(["twice", "b"]);
    expect(derive).not.toHaveBeenCalled();
    done(a.attempts[0].deliver, 2);
    expect(graph.get("twice")).toMatchObject({ value: 4, current: true });
    expect(derive).toHaveBeenCalledTimes(1);
    done(b.attempts[0].deliver, 99);
    graph.update(scope({ page: { filter: "all", pose: 10 } }));
    expect(derive).toHaveBeenCalledTimes(1);
    done(a.attempts[0].deliver, 3, 2);
    expect(derive).toHaveBeenCalledTimes(2);
    expect(graph.get("twice").value).toBe(6);
    // A stale input can still be inspected, but cannot produce a mutation basis.
    a.attempts[0].deliver({ kind: "stale" });
    expect(graph.get("twice")).toMatchObject({ value: 6, complete: true, current: false });
    release();
    graph.dispose();
  });

  it("refuses cycles, missing dependencies, sources and kind mismatches before acquisition", () => {
    const read = controlled();
    const cases: Record<string, ReadingDecl<Page>>[] = [
      { a: decl("read", { deps: ["a"] }) },
      { a: decl("read", { deps: ["b"] }), b: decl("read", { deps: ["a"] }) },
      { a: decl("read", { deps: ["missing"] }) },
      { a: decl("missing") },
      { a: decl("read", { kind: "worker" }) },
    ];
    for (const readings of cases)
      expect(() => fixture(readings, { read: read.source })).toThrow(ReadingGraphRefusal);
    expect(read.attempts).toHaveLength(0);
  });

  it("pins dependency acquisition for a verb and stays pending until inputs arrive", () => {
    const read = controlled();
    const derive = vi.fn((context: ReadingContext) => Number(context.inputs.matrix.value) + 1);
    const { graph } = fixture(
      {
        matrix: decl("read"),
        rows: decl("rows", { kind: "derive", deps: ["matrix"] }),
      },
      { read: read.source, rows: { kind: "derive", derive } },
    );
    graph.start("rows", "press");
    expect(graph.get("rows").status).toBe("pending");
    expect(derive).not.toHaveBeenCalled();
    expect(read.attempts[0].context.signal.aborted).toBe(false);
    done(read.attempts[0].deliver, 4);
    expect(graph.get("rows")).toMatchObject({ value: 5, complete: true, current: true });
    graph.finish("rows", "press");
    expect(graph.get("rows").current).toBe(false);
    expect(read.attempts[0].close).toHaveBeenCalledTimes(1);
    graph.dispose();
  });

  it("returns a failed attempt without throwing, and retires its previous value on scope change", () => {
    const { graph, logs } = fixture(
      { failing: decl("failing") },
      {
        failing: {
          kind: "use",
          open: () => {
            throw Error("offline");
          },
        },
      },
    );
    const attempt = graph.start("failing", "press");
    expect(attempt.generation).toBe(1);
    expect(graph.get("failing")).toMatchObject({ current: false, error: "offline" });
    expect(logs.at(-1)?.kind).toBe("failure");
    graph.update(scope({ target: target("B") }));
    expect(graph.get("failing").value).toBeUndefined();
    expect(graph.get("failing").previous).toBeUndefined();
    graph.dispose();
  });

  it("retires target and page readings independently, ignores pose, and keeps never sources", () => {
    const read = controlled();
    const { graph } = fixture(
      {
        target: decl("read", { args: (p) => p.filter }),
        page: decl("read", { retire: "page", args: (p) => p.filter }),
        never: decl("read", { retire: "never" }),
      },
      { read: read.source },
    );
    const release = graph.mount(["target", "page", "never"]);
    const initial = [...read.attempts];
    graph.update(scope({ page: { filter: "all", pose: 1 } }));
    expect(read.attempts).toHaveLength(3);
    graph.update(scope({ page: { filter: "picked", pose: 1 } }));
    expect(read.attempts).toHaveLength(4);
    expect(initial[0].context.signal.aborted).toBe(false);
    expect(initial[1].context.signal.aborted).toBe(true);
    graph.update(scope({ target: target("B"), page: { filter: "picked", pose: 1 } }));
    expect(read.attempts).toHaveLength(6);
    expect(initial[2].context.signal.aborted).toBe(false);
    release();
    graph.dispose();
  });

  it("invalidates successful, partial and late receipts by effect scope and dirties", () => {
    const read = controlled();
    const { graph, logs } = fixture(
      {
        matrix: decl("read"),
        catalogs: decl("catalogs"),
      },
      {
        read: { ...read.source, dirties: ["families"] },
        catalogs: { ...read.source, effects: () => [{ kind: "file", path: "catalog.json" }] },
      },
    );
    const release = graph.mount(["matrix", "catalogs"]);
    const matrix = read.attempts[0];
    done(matrix.deliver, 1);
    done(read.attempts[1].deliver, 2);
    graph.acceptReceipt(
      receipt({ effects: [{ kind: "document", ref: { session: "session", openId: "B" } }] }),
      ["families"],
    );
    expect(graph.get("matrix").current).toBe(true);
    graph.acceptReceipt(receipt({ id: "partial", state: "incomplete" }), ["families"]);
    expect(graph.get("matrix")).toMatchObject({ previous: 1, current: false, status: "pending" });
    expect(graph.get("catalogs").current).toBe(true);
    done(matrix.deliver, 99, 2);
    expect(graph.get("matrix").previous).toBe(1);
    expect(logs.at(-1)?.kind).toBe("drop");
    graph.start("matrix", "refresh");
    done(read.attempts.at(-1)!.deliver, 3);
    graph.acceptReceipt(
      receipt({ id: "late", effects: [{ kind: "session", session: "session" }] }),
      ["families"],
    );
    expect(graph.get("matrix").current).toBe(false);
    graph.acceptReceipt(receipt({ id: "file", effects: [{ kind: "file", path: "catalog.json" }] }));
    expect(graph.get("catalogs").current).toBe(false);
    graph.start("matrix", "again");
    done(read.attempts.at(-1)!.deliver, 5);
    graph.acceptReceipt(receipt({ id: "unknown-effects", state: "unknown", effects: [] }));
    expect(graph.get("matrix").current).toBe(false);
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

  it("receipt-dirtied mounted workers acquire a new generation and reject the old job's delivery", () => {
    const jobs: { context: ReadingContext; deliver: ReadingDelivery<number> }[] = [];
    const { graph } = fixture(
      { price: decl("price", { kind: "worker" }) },
      {
        price: {
          kind: "worker",
          algorithmVersion: "v1",
          connect: () => ({
            update: (context, deliver) => {
              jobs.push({ context, deliver });
            },
            stop: vi.fn(),
          }),
        },
      },
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
    release();
    graph.dispose();
  });

  it("marks document changes stale and cannot admit a pre-change completion", () => {
    const read = controlled();
    const { graph } = fixture({ matrix: decl("read") }, { read: read.source });
    const release = graph.mount(["matrix"]);
    done(read.attempts[0].deliver, 1);
    graph.documentChanged({ session: "other-session", openId: "A" });
    expect(graph.get("matrix").current).toBe(true);
    graph.documentChanged({ session: "session", openId: "A" });
    done(read.attempts[0].deliver, 2, 2);
    expect(graph.get("matrix")).toMatchObject({ value: 1, complete: true, current: false });
    release();
    graph.dispose();
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

  it("explicit Stop and pane-only release revoke every publication path", () => {
    const read = controlled();
    const { graph, logs } = fixture({ matrix: decl("read") }, { read: read.source });
    const release = graph.mount(["matrix"]);
    const paneRead = read.attempts[0];
    release();
    done(paneRead.deliver, 1);
    graph.start("matrix", "press");
    const verbRead = read.attempts.at(-1)!;
    graph.cancel("matrix", "other-press");
    expect(verbRead.context.signal.aborted).toBe(false);
    graph.cancel("matrix", "press");
    done(verbRead.deliver, 2);
    expect(graph.get("matrix").current).toBe(false);
    expect(logs.filter((log) => log.kind === "drop")).toHaveLength(2);
    graph.dispose();
  });

  it("rejects regressive progress and a complete → partial regression", () => {
    const read = controlled();
    const { graph, logs } = fixture({ matrix: decl("read") }, { read: read.source });
    const release = graph.mount(["matrix"]);
    const { deliver } = read.attempts[0];
    deliver({ kind: "part", value: 2, revision: 2 });
    deliver({ kind: "part", value: 1, revision: 1 });
    done(deliver, 3, 3);
    deliver({ kind: "part", value: 4, revision: 4 });
    deliver({ kind: "pending" });
    done(deliver, 100, Number.NaN);
    expect(graph.get("matrix")).toMatchObject({ value: 3, current: true });
    expect(logs.filter((log) => log.kind === "drop")).toHaveLength(4);
    release();
    graph.dispose();
  });

  it("gives ports lifecycle without receipts and feeds a guarded log sink", () => {
    const close = vi.fn();
    const feed = controlled("feed");
    const { graph, logs } = fixture(
      {
        harness: decl("harness", { kind: "port", retire: "never" }),
        world: decl("world", { kind: "feed" }),
      },
      {
        harness: { kind: "port", open: () => ({ value: { send: () => "accepted" }, close }) },
        world: feed.source,
      },
    );
    const release = graph.mount(["harness", "world"]);
    expect(graph.get("harness").status).toBe("ready");
    graph.acceptReceipt(receipt());
    expect(close).not.toHaveBeenCalled();
    graph.start("world", "follow");
    const live = feed.attempts.at(-1)!;
    live.deliver({ kind: "log", id: "1", value: "changed" });
    live.deliver({ kind: "log", id: "1", value: "changed" });
    expect(logs.filter((log) => log.kind === "feed")).toHaveLength(1);
    graph.update(scope({ target: target("B") }));
    live.deliver({ kind: "log", id: "2", value: "late" });
    expect(logs.at(-1)?.kind).toBe("drop");
    release();
    graph.dispose();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes a port which finishes opening after disposal", async () => {
    let resolve!: (session: { value: string; close: () => void }) => void;
    const close = vi.fn();
    const { graph, logs } = fixture(
      { service: decl("service", { kind: "port" }) },
      {
        service: {
          kind: "port",
          open: () =>
            new Promise((accept) => {
              resolve = accept;
            }),
        },
      },
    );
    const release = graph.mount(["service"]);
    graph.dispose();
    resolve({ value: "session", close });
    await Promise.resolve();
    expect(close).toHaveBeenCalledTimes(1);
    expect(logs.at(-1)?.kind).toBe("drop");
    release();
  });

  it("uses the existing subscription door and treats changed/offline frames as stale", async () => {
    let frame!: Parameters<Readings["subscribe"]>[1];
    const close = vi.fn();
    const resources: Readings = {
      subscribe: vi.fn((_request, listener) => {
        frame = listener;
        return close;
      }),
      dirty: vi.fn(),
    };
    const source = subscriptionSource({
      resources,
      request: () => ({ kind: "inventory" }),
      decode: (value) => Number(value),
    });
    const { graph } = fixture({ inventory: decl("inventory") }, { inventory: source });
    const release = graph.mount(["inventory"]);
    await Promise.resolve();
    frame({ kind: "snapshot", key: "inventory", value: 1 });
    expect(graph.get("inventory").current).toBe(true);
    frame({ kind: "snapshot", key: "inventory", value: 1, changed: true });
    expect(graph.get("inventory")).toMatchObject({ value: 1, current: false, status: "stale" });
    frame({ kind: "stale", key: "inventory" });
    expect(graph.get("inventory").current).toBe(false);
    release();
    graph.dispose();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("a subscription feed folds each ordered event once and also sends it to the log", async () => {
    let frame!: Parameters<Readings["subscribe"]>[1];
    const resources: Readings = {
      subscribe: (_request, listener) => {
        frame = listener;
        return () => {};
      },
      dirty: vi.fn(),
    };
    const source = subscriptionSource({
      resources,
      kind: "feed",
      request: () => ({ kind: "world" }),
      decode: (value) => Number(value),
      fold: (previous, event) => (previous ?? 0) + Number(event),
    });
    const { graph, logs } = fixture(
      { events: decl("events", { kind: "feed" }) },
      { events: source },
    );
    const release = graph.mount(["events"]);
    await Promise.resolve();
    frame({ kind: "event", key: "world", id: 1, value: 2 });
    frame({ kind: "event", key: "world", id: 1, value: 2 });
    frame({ kind: "event", key: "world", id: 2, value: 3 });
    expect(graph.get("events")).toMatchObject({ value: 5, current: true });
    expect(logs.filter((log) => log.kind === "feed").map((log) => log.value)).toEqual([2, 3]);
    frame({ kind: "gap", key: "world", id: 3, dropped: 1 });
    frame({ kind: "event", key: "world", id: 4, value: 1 });
    expect(graph.get("events")).toMatchObject({ value: 6, current: false });
    frame({ kind: "snapshot", key: "world", value: 10 });
    frame({ kind: "event", key: "world", id: 5, value: 1 });
    expect(graph.get("events")).toMatchObject({ value: 11, current: true });
    release();
    graph.dispose();
  });
});

it("runs one worker job plus latest, decodes obsolete deltas, and publishes only latest inputs", () => {
  const requests: ReadingWorkerRequest<number>[] = [];
  const terminate = vi.fn();
  const port: ReadingWorkerPort<number, number, number> = {
    postMessage: (request) => requests.push(request),
    terminate,
    onmessage: null,
    onerror: null,
  };
  const source = workerSource({
    algorithmVersion: "algorithm-2",
    spawn: () => port,
    input: (context) => (context.work as { amount: number }).amount,
    applyDelta: (previous, delta) => (previous ?? 0) + delta,
  });
  const { graph, logs } = fixture(
    { price: decl("price", { kind: "worker", retire: "page", args: (p) => p.filter }) },
    { price: source },
  );
  const release = graph.mount(["price"]);
  graph.start("price", "solve");
  graph.update(scope({ workRevision: 2, work: { amount: 2 } }));
  graph.update(scope({ workRevision: 3, work: { amount: 3 } }));
  release();
  expect(requests.map((r) => r.input)).toEqual([1]);
  port.onmessage!({ data: { id: requests[0].id, delta: 10 } });
  expect(graph.get("price").value).toBeUndefined();
  expect(requests.map((r) => r.input)).toEqual([1, 3]);
  expect(logs.at(-1)?.kind).toBe("drop");
  port.onmessage!({ data: { id: requests[1].id, delta: 3 } });
  expect(graph.get("price")).toMatchObject({
    value: 13,
    current: true,
    complete: true,
    basis: { workRevision: 3, algorithmVersion: "algorithm-2" },
  });
  expect(requests[1].key).toContain("algorithm-2");
  graph.finish("price", "solve");
  graph.dispose();
  expect(terminate).toHaveBeenCalledTimes(1);
});

it("worker identity includes input versions and never displays the preceding input's result", () => {
  const read = controlled();
  const requests: ReadingWorkerRequest<number>[] = [];
  const port: ReadingWorkerPort<number, number> = {
    postMessage: (request) => requests.push(request),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
  };
  const source = workerSource({
    algorithmVersion: "v1",
    spawn: () => port,
    input: (context) => Number(context.inputs.model.value),
  });
  const { graph } = fixture(
    {
      model: decl("model"),
      computed: decl("computed", { kind: "worker", deps: ["model"] }),
    },
    { model: read.source, computed: source },
  );
  const release = graph.mount(["computed"]);
  done(read.attempts[0].deliver, 1);
  done(read.attempts[0].deliver, 2, 2);
  done(read.attempts[0].deliver, 3, 3);
  expect(requests).toHaveLength(1);
  port.onmessage!({ data: { id: requests[0].id, result: 10 } });
  expect(graph.get("computed").value).toBeUndefined();
  expect(requests.map((request) => request.input)).toEqual([1, 3]);
  expect(requests[0].key).not.toBe(requests[1].key);
  port.onmessage!({ data: { id: requests[1].id, result: 30 } });
  expect(graph.get("computed")).toMatchObject({ value: 30, current: true });
  expect(graph.get("computed").basis?.inputs.model).toBe(graph.get("model").version);
  release();
  graph.dispose();
});

it("worker errors end pending honestly and an explicit refresh gets a new channel", () => {
  const ports: ReadingWorkerPort<number, number>[] = [];
  const terminations: ReturnType<typeof vi.fn>[] = [];
  const source = workerSource({
    algorithmVersion: "v1",
    input: () => 1,
    spawn: () => {
      const terminate = vi.fn();
      terminations.push(terminate);
      const port: ReadingWorkerPort<number, number> = {
        postMessage: vi.fn(),
        terminate,
        onmessage: null,
        onerror: null,
      };
      ports.push(port);
      return port;
    },
  });
  const { graph } = fixture(
    { computed: decl("computed", { kind: "worker" }) },
    { computed: source },
  );
  const release = graph.mount(["computed"]);
  ports[0].onerror!({ message: "worker crashed" });
  expect(graph.get("computed")).toMatchObject({
    status: "failed",
    current: false,
    error: "worker crashed",
  });
  expect(terminations[0]).toHaveBeenCalledTimes(1);
  graph.start("computed", "retry-after-inspection");
  expect(ports).toHaveLength(2);
  ports[1].onmessage!({ data: { id: 1, result: 2 } });
  expect(graph.get("computed")).toMatchObject({ value: 2, current: true });
  release();
  graph.dispose();
  expect(terminations[1]).toHaveBeenCalledTimes(1);
});
