import { expect, test, vi } from "vite-plus/test";
import { actionReceiptSchema, actionStatusSchema, type Receipt } from "@pe/agent-contracts";
import type { ReceiptFeedState } from "../../../packages/agent-contracts/src/work-journal-door.ts";
import { observeWorkReceipts } from "../src/work-receipt-feed.ts";
const key = { binding: "host", route: "note", target: null } as const;
const row = (id: string, state = "succeeded", revision = 1): Receipt =>
  ({
    revision,
    body: {
      kind: "action",
      value: actionReceiptSchema.parse({
        id,
        key: "test.write",
        state,
        ...(state === "succeeded" ? { result: {} } : {}),
        input: {},
        target: { kind: "host" },
        caller: { kind: "human", via: "local" },
        basis: null,
        steps: [],
        prepared: { state: "unprepared" },
        recovery: [],
        startedAt: "2026-11-03T00:00:00Z",
        ...(state === "unknown" ? { error: "lost", status: 500 } : {}),
      }),
    },
  }) as Receipt;
test("subscribe before snapshot, bound terminals by count/bytes, retain every nonterminal", async () => {
  let deliver!: (row: Receipt) => void;
  let ready!: (rows: Receipt[]) => void;
  const stop = vi.fn();
  const journal = {
    subscribe: vi.fn((_query: unknown, listener: (row: Receipt) => void) => {
      deliver = listener;
      return stop;
    }),
    read: vi.fn(
      () =>
        new Promise<Receipt[]>((resolve) => {
          ready = resolve;
        }),
    ),
  };
  const values: ReceiptFeedState[] = [];
  const release = observeWorkReceipts(
    journal,
    { key, target: null },
    (value) => values.push(value),
    { maxCount: 1, maxBytes: 2 },
  );
  deliver(row("running", "running"));
  deliver(row("unknown", "unknown"));
  ready([row("old"), row("waiting", "waiting")]);
  await Promise.resolve();
  const snapshot = values.at(-1);
  expect(snapshot).toMatchObject({ kind: "ready", receipts: { from: 2, through: 4 } });
  if (snapshot?.kind !== "ready") throw Error("missing acquisition");
  expect(snapshot.receipts.rows.map((row) => row.id)).toEqual(["waiting", "running", "unknown"]);
  deliver(row("running", "succeeded", 2));
  expect(values.at(-1)).toMatchObject({
    kind: "receipt",
    cursor: 5,
    receipt: { id: "running", state: "succeeded" },
  });
  const count = values.length;
  deliver(row("running", "succeeded", 2));
  expect(values).toHaveLength(count);
  // A trimmed terminal cannot be reintroduced by a duplicate emission.
  release();
  expect(stop).toHaveBeenCalledOnce();
});
test("two observers share cursor order and only last release detaches the host action feed", async () => {
  let deliver!: (row: Receipt) => void;
  const stop = vi.fn();
  const journal = {
    subscribe: vi.fn((_query: unknown, listener: (row: Receipt) => void) => {
      deliver = listener;
      return stop;
    }),
    read: vi.fn(async () => [row("one")]),
  };
  const a: ReceiptFeedState[] = [],
    b: ReceiptFeedState[] = [];
  const releaseA = observeWorkReceipts(journal, { key, target: null }, (value) => a.push(value));
  await Promise.resolve();
  const releaseB = observeWorkReceipts(journal, { key, target: null }, (value) => b.push(value));
  deliver(row("one", "succeeded", 2));
  expect(a.at(-1)).toEqual(b.at(-1));
  expect(journal.subscribe).toHaveBeenCalledOnce();
  releaseA();
  expect(stop).not.toHaveBeenCalled();
  releaseB();
  expect(stop).toHaveBeenCalledOnce();
});

test("scope membership is target OR consumed Work, including a refused basis", async () => {
  const consumed = {
    kind: "work",
    probe: { handle: { key, revision: 1 }, paths: [["a"]] },
    expected: { a: 1 },
  };
  const other = (id: string, consumes: unknown[] = [], refusal?: unknown) =>
    ({
      ...row(id),
      body: {
        kind: "action",
        value: actionReceiptSchema.parse({
          ...((row(id).body as { value: unknown }).value as object),
          target: { kind: "session", session: "other" },
          consumes,
          ...(refusal ? { refusal } : {}),
        }),
      },
    }) as Receipt;
  const journal = {
    subscribe: () => () => {},
    read: async () => [
      row("target"),
      other("consumed", [consumed]),
      other("basis", [], { kind: "stale", consumed: [consumed] }),
      other("foreign"),
    ],
  };
  const values: ReceiptFeedState[] = [];
  const release = observeWorkReceipts(journal, { key, target: null }, (value) =>
    values.push(value),
  );
  await Promise.resolve();
  const ready = values.at(-1);
  if (ready?.kind !== "ready") throw Error("missing acquisition");
  expect(ready.receipts.rows.map((row) => row.id)).toEqual(["target", "consumed", "basis"]);
  release();
});

test("a failed acquisition retires its feed and later subscribers reacquire", async () => {
  const stop = vi.fn();
  const journal = {
    subscribe: vi.fn(() => stop),
    read: vi
      .fn<() => Promise<Receipt[]>>()
      .mockRejectedValueOnce(Error("journal unavailable"))
      .mockResolvedValue([]),
  };
  const first: ReceiptFeedState[] = [];
  const releaseFirst = observeWorkReceipts(journal, { key, target: null }, (v) => first.push(v));
  await Promise.resolve();
  expect(first.at(-1)).toMatchObject({ kind: "failed" });
  const second: ReceiptFeedState[] = [];
  const releaseSecond = observeWorkReceipts(journal, { key, target: null }, (v) => second.push(v));
  releaseFirst();
  await Promise.resolve();
  expect(second.at(-1)).toMatchObject({ kind: "ready" });
  const releaseThird = observeWorkReceipts(journal, { key, target: null }, () => {});
  expect(journal.read).toHaveBeenCalledTimes(2);
  expect(journal.subscribe).toHaveBeenCalledTimes(2);
  releaseSecond();
  releaseThird();
  expect(stop).toHaveBeenCalledTimes(2);
});

test("byte trimming counts UTF-8, array overhead and replacement sizes exactly", async () => {
  let deliver!: (value: Receipt) => void;
  const a = row("a\u00e9"),
    b = row("b\u00e9"),
    c = row("c\u00e9");
  const body = (value: Receipt) => {
    if (value.body.kind !== "action") throw Error("expected action");
    return value.body.value;
  };
  // The feed bounds the status projection it emits, not the durable receipt.
  const status = (value: Receipt) => actionStatusSchema.parse(body(value));
  const maxBytes = new TextEncoder().encode(JSON.stringify([status(b), status(c)])).byteLength;
  const journal = {
    subscribe: (_query: unknown, listener: (value: Receipt) => void) => {
      deliver = listener;
      return () => {};
    },
    read: async () => [a, b, c],
  };
  const releases: (() => void)[] = [];
  const snapshot = () => {
    let latest: ReceiptFeedState | undefined;
    releases.push(
      observeWorkReceipts(
        journal,
        { key, target: null },
        (v) => {
          latest = v;
        },
        { maxCount: 100, maxBytes },
      ),
    );
    return latest;
  };
  snapshot();
  await Promise.resolve();
  expect(snapshot()).toMatchObject({
    kind: "ready",
    receipts: { from: 2, through: 3, rows: [{ id: "b\u00e9" }, { id: "c\u00e9" }] },
  });
  const oversized = row("c\u00e9", "running", 2);
  body(oversized).input = { text: "\u00e9".repeat(maxBytes) };
  deliver(oversized);
  expect(snapshot()).toMatchObject({
    kind: "ready",
    receipts: { from: 3, rows: [{ id: "c\u00e9", state: "running" }] },
  });
  deliver(row("c\u00e9", "succeeded", 3));
  deliver(row("d\u00e9"));
  expect(snapshot()).toMatchObject({
    kind: "ready",
    receipts: { from: 3, through: 6, rows: [{ id: "c\u00e9" }, { id: "d\u00e9" }] },
  });
  const belowBoundary: ReceiptFeedState[] = [];
  const releaseBelow = observeWorkReceipts(
    { ...journal },
    { key, target: null },
    (v) => belowBoundary.push(v),
    { maxCount: 100, maxBytes: maxBytes - 1 },
  );
  await Promise.resolve();
  expect(belowBoundary.at(-1)).toMatchObject({
    kind: "ready",
    receipts: { from: 3, rows: [{ id: "c\u00e9" }] },
  });
  releaseBelow();
  releases.forEach((release) => release());
});

test("T1: completed over-budget Plan and Apply stay in a recreated ready as bounded statuses", async () => {
  // Field shape (H1): a ~415 KB Plan and a ~174 KB Apply, almost all `prepared` and `result`.
  const consumed = {
    kind: "work",
    probe: { handle: { key, revision: 28 }, paths: [["flows"]] },
    expected: { flows: { 4: 250 } },
  };
  const heavy = (id: string, bytes: number, revision = 1) =>
    ({
      revision,
      body: {
        kind: "action",
        value: actionReceiptSchema.parse({
          ...((row(id).body as { value: unknown }).value as object),
          key: id === "plan" ? "ducts.plan-losses" : "ducts.apply-losses",
          target: { kind: "session", session: "s" },
          consumes: [consumed],
          prepared: { state: "ready", value: { writes: "x".repeat(bytes) } },
          result: { value: { writes: "y".repeat(bytes / 4) } },
        }),
      },
    }) as Receipt;
  const foreign = {
    ...row("foreign"),
    body: {
      kind: "action",
      value: actionReceiptSchema.parse({
        ...((row("foreign").body as { value: unknown }).value as object),
        target: { kind: "session", session: "other" },
      }),
    },
  } as Receipt;
  const maxBytes = 512 * 1024;
  let deliver!: (row: Receipt) => void;
  const durable = [heavy("plan", 330_000), heavy("apply", 140_000), foreign];
  const open = () => {
    const values: ReceiptFeedState[] = [];
    const release = observeWorkReceipts(
      {
        subscribe: (_query, listener) => ((deliver = listener), () => {}),
        read: async () => durable,
      },
      { key, target: { kind: "session", session: "s" } } as never,
      (value) => values.push(value),
      { maxCount: 256, maxBytes },
    );
    return { values, release };
  };
  const first = open();
  await Promise.resolve();
  // A live terminal emission is the same bounded projection as ready.
  deliver(heavy("plan", 330_000, 2));
  const live = first.values.at(-1);
  expect(live).toMatchObject({ kind: "receipt", receipt: { id: "plan", state: "succeeded" } });
  expect(live).not.toHaveProperty("receipt.prepared");
  first.release();
  // Full reload: the browser owner is recreated and the host rebuilds ready from durable rows.
  const second = open();
  await Promise.resolve();
  const ready = second.values.at(-1);
  if (ready?.kind !== "ready") throw Error("missing acquisition");
  expect(ready.receipts.rows.map((row) => row.id)).toEqual(["plan", "apply"]);
  expect(ready.receipts.from).toBe(0);
  for (const row of ready.receipts.rows) {
    expect(row).toMatchObject({ consumes: [consumed], outcome: { state: "succeeded" } });
    for (const heavyField of ["steps", "prepared", "recovery", "result"])
      expect(row).not.toHaveProperty(heavyField);
  }
  expect(new TextEncoder().encode(JSON.stringify(ready.receipts.rows)).byteLength).toBeLessThan(maxBytes);
  second.release();
});
