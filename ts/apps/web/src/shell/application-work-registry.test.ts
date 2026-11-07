import { expect, test, vi } from "vite-plus/test";
import { actionReceiptSchema, actionStatusSchema, type WorkWriteAck } from "@pe/agent-contracts";
import type {
  WorkJournalDoor,
  ReceiptFeedState,
  WorkScope,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import { createApplicationWorkRegistry } from "./application-work-registry";
const key = { binding: "host", route: "note", target: null } as const;
const ack = (revision: number, path: string, by: "human" | "pea" = "human"): WorkWriteAck => ({
  key,
  kind: "apply",
  by,
  base: revision - 1,
  revision,
  at: revision,
  press: `edit-${revision}`,
  label: path,
  patches: [{ path: [path], value: revision }],
  inverse: [{ path: [path], value: 0 }],
  undoable: true,
});
const state = {
  kind: "ready" as const,
  snapshot: { handle: { key, revision: 2 }, revision: 2, value: { a: 1, b: 2 } },
  history: { from: 1, acks: [ack(1, "a"), ack(2, "b")] },
};
// The feed carries the compact status the host projects, never the full durable receipt.
const receipt = (state: "succeeded" | "cancelled") =>
  actionStatusSchema.parse(actionReceiptSchema.parse({
    id: "native",
    key: "test.write",
    state,
    ...(state === "succeeded" ? { result: {} } : { error: "rejected by you", status: 499 }),
    caller: { kind: "pea", context: "test", thread: "test" },
    basis: null,
    target: { kind: "host" },
    input: {},
    prepared: { state: "unprepared" },
    steps: [],
    recovery: [],
    startedAt: "2026-11-03T00:00:00Z",
    effects: [{ kind: "file", path: "C:/result" }],
    consumes: [
      {
        kind: "work",
        probe: { handle: { key, revision: 2 }, paths: [["a"]] },
        expected: { a: 1, b: 2 },
      },
    ],
  }));
function fixture(initial = state) {
  const registry = createApplicationWorkRegistry();
  let deliver!: (state: ReceiptFeedState) => void;
  const stop = vi.fn();
  const door = {
    receipts: () => ({
      subscribe(listener: typeof deliver) {
        deliver = listener;
        return stop;
      },
    }),
  } satisfies Pick<WorkJournalDoor, "receipts">;
  const lease = registry.acquire(key);
  lease.entry.connect({ key } as WorkScope, door);
  lease.entry.restore(initial);
  return { registry, lease, stop, emit: (value: unknown) => deliver(value as ReceiptFeedState) };
}
test("two Places share one journal and the last release drops it; ready rebuilds after full release", () => {
  const f = fixture();
  const second = f.registry.acquire({ ...key });
  expect(second.entry).toBe(f.lease.entry);
  const before = f.lease.entry.journal.read().moves;
  f.lease.release();
  expect(f.stop).not.toHaveBeenCalled();
  second.release();
  expect(f.stop).toHaveBeenCalledOnce();
  const remount = f.registry.acquire(key);
  remount.entry.restore(state);
  expect(remount.entry.journal.read().moves).toEqual(before);
  remount.release();
});
test("Reject annotates only consumed edits and higher cursor wins once per receipt", () => {
  const f = fixture();
  f.emit({ kind: "receipt", cursor: 2, receipt: receipt("cancelled") });
  f.emit({ kind: "receipt", cursor: 1, receipt: receipt("succeeded") });
  expect(f.lease.entry.activity()).toHaveLength(1);
  expect(f.lease.entry.journal.read().undo.map((step) => !!step.notWritten)).toEqual([true, false]);
  expect(Object.isFrozen(f.lease.entry.activity()[0])).toBe(true);
  f.lease.release();
});

test("a successful preview with no effects leaves its consumed Work undoable", async () => {
  const f = fixture({
    ...state,
    snapshot: { handle: { key, revision: 1 }, revision: 1, value: { a: 1, b: 0 } },
    history: { from: 1, acks: [ack(1, "a")] },
  });
  f.emit({ kind: "receipt", cursor: 1, receipt: { ...receipt("succeeded"), effects: [] } });
  const write = vi.fn(async () => { throw Error("restore reached the write door"); });
  const result = await f.lease.entry.journal.undo(write);
  expect(result).toMatchObject({ code: "write-refused" });
  expect(write).toHaveBeenCalledOnce();
  f.lease.release();
});
test("ready receipts restore native undo barriers after reload, irrespective of feed order", async () => {
  for (const order of ["receipts-first", "history-first"]) {
    const history = {
      ...state,
      snapshot: { handle: { key, revision: 1 }, revision: 1, value: { a: 1, b: 0 } },
      history: { from: 1, acks: [ack(1, "a")] },
    };
    const f = fixture(history);
    const ready = {
      kind: "ready",
      receipts: { rows: [receipt("succeeded")], from: 1, through: 1 },
    };
    if (order === "receipts-first") f.emit(ready);
    f.lease.entry.restore(history);
    if (order === "history-first") f.emit(ready);
    const write = vi.fn();
    expect(await f.lease.entry.journal.undo(write)).toMatchObject({ ok: false, code: "barrier" });
    expect(write).not.toHaveBeenCalled();
    f.lease.release();
  }
});

test("T1: a trimmed ready window blocks undo with a typed barrier; a complete one does not", async () => {
  for (const from of [5, 1]) {
    const f = fixture();
    f.emit({ kind: "ready", receipts: { rows: [], from, through: 9 } });
    const write = vi.fn(async () => {
      throw Error("written");
    });
    const undo = await f.lease.entry.journal.undo(write).catch((error: Error) => error.message);
    if (from === 5) {
      expect(undo).toMatchObject({
        ok: false,
        code: "barrier",
        barrier: { receiptId: "receipts:trimmed-below:5" },
      });
      expect(write).not.toHaveBeenCalled();
    } else expect(write).toHaveBeenCalled();
    f.lease.release();
  }
});
