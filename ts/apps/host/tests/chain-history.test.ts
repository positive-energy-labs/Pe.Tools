import { expect, test } from "vite-plus/test";
import { actionReceiptSchema, type WorkWriteAck } from "@pe/agent-contracts";
import { createWorkJournal } from "@pe/runtime/work-journal";

const key = { binding: "host", route: "ducts", target: null } as const;
const edit = (revision: number, value: number): WorkWriteAck => ({
  key,
  kind: "apply",
  by: "pea",
  base: revision - 1,
  revision,
  at: revision,
  press: `edit-${revision}`,
  label: `Flow ${value}`,
  undoable: true,
  patches: [{ path: ["flow"], value }],
  inverse: [{ path: ["flow"], value: 900 }],
});
const receipt = (id: string, state: "succeeded" | "cancelled", revision: number, value: number) =>
  actionReceiptSchema.parse({
    id,
    key: "ducts.apply-losses",
    state,
    ...(state === "succeeded" ? { result: {} } : { error: "rejected by you", status: 499 }),
    caller: { kind: "pea", context: "chain", thread: "chain" },
    basis: null,
    target: { kind: "host" },
    input: {},
    prepared: { state: "unprepared" },
    steps: [],
    recovery: [],
    startedAt: `2026-11-03T00:00:0${revision}Z`,
    consumes: [
      {
        kind: "work",
        probe: { handle: { key, revision }, paths: [["flow"]] },
        expected: { flow: value },
      },
    ],
  });

test("J: a landed edit stays written when a later command consuming the same value is rejected", () => {
  const journal = createWorkJournal(key);
  journal.accept(edit(1, 975));
  const record = (row: ReturnType<typeof receipt>) =>
    journal.record({
      kind: "receipt",
      at: row.startedAt,
      receiptId: row.id,
      paths: [["flow"]],
      outcome: row.outcome,
      basis: { receipt: row },
    });
  record(receipt("landed", "succeeded", 1, 975));
  record(receipt("rejected-same", "cancelled", 2, 975));
  expect(journal.read().undo[0]!.notWritten).toBeUndefined();
  journal.accept(edit(2, 1050));
  record(receipt("rejected-new", "cancelled", 3, 1050));
  const steps = journal.read().undo;
  expect(steps[0]!.notWritten).toBeUndefined();
  expect(steps[1]!.notWritten).toMatchObject({ invocation: "rejected-new", rejected: true });
});
