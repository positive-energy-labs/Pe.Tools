import { expect, test, vi } from "vite-plus/test";
import { actionReceiptSchema, type Receipt } from "@pe/agent-contracts";
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
