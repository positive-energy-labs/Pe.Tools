import { expect, test } from "vite-plus/test";
import { z } from "zod";
import {
  bindWork,
  actionStatusSchema,
  invocationOutcome,
  refusalText,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { RouteWorkspace } from "../src/route-workspace.ts";
import { createWorkJournal } from "../src/work-journal.ts";
import { createWorkJournal as browserJournal } from "../../../apps/web/src/shell/journal.ts";

function fixture(limits?: { maxCount: number; maxBytes: number }) {
  const key = bindWork("history-proof", null, "one");
  let saved: unknown = null;
  const options = {
    workHistoryLimits: limits,
    registrations: [
      {
        historyDetail: z.strictObject({ row: z.string() }),
        spec: {
          route: key.route,
          title: "History",
          description: "Proof",
          schema: z.object({ a: z.number().default(0), b: z.number().default(0) }),
        },
      },
    ],
    store: {
      getState: async () => structuredClone(saved),
      setState: async ({ value }: { value: unknown }) => {
        saved = structuredClone(value);
      },
    },
  };
  let host = new RouteWorkspace(options);
  const edit = async (by: "human" | "pea", press: string | null, a: number, b?: number) => {
    const current = await host.view(key, key.route);
    const result = await host.write(key, key.route, by, {
      kind: "apply",
      press,
      expectedRevision: current!.revision,
      patches: [{ path: ["a"], value: a }, ...(b === undefined ? [] : [{ path: ["b"], value: b }])],
    });
    if (!result.ok) throw Error(refusalText(result));
    return result;
  };
  return {
    key,
    edit,
    get host() {
      return host;
    },
    snapshot: () =>
      new Promise<{
        doc: unknown;
        revision: number;
        history: { from: number; acks: WorkWriteAck[] };
      }>((resolve, reject) => {
        const stop = host.observeFeed(
          key,
          (value) => {
            stop();
            resolve(
              value as {
                doc: unknown;
                revision: number;
                history: { from: number; acks: WorkWriteAck[] };
              },
            );
          },
          () => {},
          reject,
        );
      }),
    restart() {
      host = new RouteWorkspace(options);
      return host;
    },
  };
}

test("web and Pea share the reducer; a two-write press restores as one step across restart", async () => {
  expect(browserJournal).toBe(createWorkJournal);
  const f = fixture();
  const web = browserJournal(f.key);
  web.accept((await f.edit("human", "two-writes", 1)).write);
  web.accept((await f.edit("human", "two-writes", 2)).write);
  expect(web.read().undo).toHaveLength(1);
  f.restart();
  expect(await f.host.step(f.key, f.key.route, "pea", "undo", 2)).toMatchObject({
    ok: true,
    revision: 4,
    doc: { a: 0 },
  });
  const replayed: WorkWriteAck[] = [];
  const stop = f.host.observeAccepted(f.key, (ack) => {
    replayed.push(ack);
    web.accept(ack);
  });
  await f.host.view(f.key, f.key.route); // waits behind serialized replay
  expect(web.read().undo).toHaveLength(0);
  expect(web.read().redo).toHaveLength(1);
  expect(web.read().moves.map(({ kind }) => kind)).toEqual(["apply", "apply", "undo"]);
  stop();
  f.restart();
  expect(await f.host.step(f.key, f.key.route, "human", "redo", 4)).toMatchObject({
    ok: true,
    revision: 6,
    doc: { a: 2 },
  });
  expect(
    replayed.filter(({ kind }) => kind === "restore").map(({ restoreOf }) => restoreOf),
  ).toEqual([2, 1]);
});

test("durable replay exceeds 100 writes, deduplicates delivery, and scopes equal presses by author", async () => {
  const f = fixture();
  await f.edit("human", "same", 1);
  await f.edit("pea", "same", 2);
  for (let i = 3; i <= 131; i++) await f.edit("pea", null, i);
  f.restart();
  const web = browserJournal(f.key);
  const stop = f.host.observeAccepted(f.key, (ack) => {
    web.accept(ack);
    web.accept(ack);
  });
  await f.host.view(f.key, f.key.route);
  expect(web.read().moves).toHaveLength(131);
  expect(web.read().undo).toHaveLength(131);
  expect(
    web
      .read()
      .undo.slice(0, 2)
      .map(({ id }) => id),
  ).toEqual(["human:same", "pea:same"]);
  expect(web.read().moves[0]).toMatchObject({ revision: 1, by: "human" });
  stop();
});

test("restore identity is exact even when inverse patches repeat; missing identity refuses", async () => {
  const f = fixture();
  const first = await f.edit("human", "one", 1);
  await f.edit("human", "two", 0);
  const third = await f.edit("human", "three", 1);
  expect(third.write.inverse).toEqual(first.write.inverse);
  const unknown = await f.host.write(f.key, f.key.route, "pea", {
    kind: "restore",
    press: null,
    patches: third.write.inverse,
    expectedRevision: 3,
  });
  expect(unknown.ok).toBe(false);
  const result = await f.host.step(f.key, f.key.route, "pea", "undo", 3);
  expect(result).toMatchObject({
    ok: true,
    write: { restoreOf: 3, step: "human:three" },
    doc: { a: 0 },
  });
});

test("a durable publish remains a barrier after restart even when values return", async () => {
  const f = fixture();
  await f.edit("human", "edit", 1);
  await f.host.publish(f.key, f.key.route, [{ path: ["a"], value: 2 }], 1);
  await f.host.publish(f.key, f.key.route, [{ path: ["a"], value: 1 }], 2);
  f.restart();
  expect((await f.host.step(f.key, f.key.route, "pea", "undo", 3)).ok).toBe(false);
  expect(await f.host.view(f.key, f.key.route)).toMatchObject({ revision: 3, doc: { a: 1 } });
});

test("receipt-confirmed retirement is committed history after restart, never changed elsewhere", async () => {
  const f = fixture();
  await f.edit("human", "flow-edit", 950);
  await f.host.publish(f.key, f.key.route, [{ path: ["a"], value: 0 }], 1, "ducts-write");
  f.restart();
  const journal = createWorkJournal(f.key);
  journal.name(() => ({ label: "Edit fan airflow" }));
  const stop = f.host.observeAccepted(f.key, (ack) => journal.accept(ack));
  await f.host.view(f.key, f.key.route);
  expect(journal.read().undo[0]).toMatchObject({
    id: "human:flow-edit",
    by: "human",
    label: "Edit fan airflow",
    barrier: { receiptId: "ducts-write" },
  });
  expect(journal.read().undo[0]!.superseded).toBeUndefined();
  expect(
    (
      await journal.undo(async () => {
        throw Error("must not write");
      })
    ).ok,
  ).toBe(false);
  stop();
});

test("a delayed Work read cannot clear accepted undo history", async () => {
  const f = fixture();
  const journal = browserJournal(f.key);
  const written = await f.edit("human", "edit", 2);
  journal.accept(written.write);
  journal.observe({ revision: written.revision, doc: written.doc });
  journal.observe({ revision: written.revision - 1, doc: { a: 0, b: 0 } });
  expect(journal.read().undo).toHaveLength(1);
  expect(
    await journal.undo((write) => f.host.write(f.key, f.key.route, "human", write)),
  ).toMatchObject({ ok: true });
});

test("Reject flags consumed intent without reverting it; later edits and a successful retry stay distinct", async () => {
  const f = fixture(),
    journal = createWorkJournal(f.key);
  const previous = await f.edit("pea", "previous", 1000);
  journal.accept(previous.write);
  const human = await f.edit("human", "human-b", 1000, 7);
  journal.accept(human.write);
  const edit = await f.edit("pea", "authored", 1050);
  journal.accept(edit.write);
  const receipt = actionStatusSchema.parse({
    id: "reject",
    key: "test.write",
    state: "cancelled",
    error: "rejected by you",
    status: 499,
    caller: { kind: "pea", context: "minted", thread: "thread" },
    basis: null,
    target: { kind: "host" },
    input: {},
    startedAt: "2026-11-02T15:00:00Z",
    effects: [{ kind: "file", path: "C:/model" }],
    consumes: [
      {
        kind: "work",
        probe: { handle: { key: f.key, revision: edit.revision }, paths: [["a"], ["b"]] },
        expected: { a: 1050, b: 7 },
      },
    ],
  });
  const record = (row: typeof receipt) =>
    journal.record({
      kind: "receipt",
      at: row.startedAt,
      paths: [["a"]],
      outcome: invocationOutcome(row),
      basis: { receipt: row },
    });
  record(receipt);
  expect(journal.read().undo[0]!.notWritten).toBeUndefined();
  expect(journal.read().undo[1]!.notWritten).toMatchObject({ rejected: false });
  expect(journal.read().undo[2]).toMatchObject({
    notWritten: { invocation: "reject", reason: "rejected by you", rejected: true },
  });
  expect(journal.read().undo[2]!.barrier).toBeUndefined();
  expect((await f.host.view(f.key, f.key.route))!.doc).toMatchObject({ a: 1050 });
  const late = createWorkJournal(f.key);
  late.record({
    kind: "receipt",
    at: receipt.startedAt,
    outcome: invocationOutcome(receipt),
    basis: { receipt },
  });
  late.accept(edit.write);
  expect(late.read().undo[0]!.notWritten?.invocation).toBe("reject");
  const { error, status, ...base } = receipt as typeof receipt & { error: string; status: number };
  record(
    actionStatusSchema.parse({
      ...base,
      id: "retry",
      state: "succeeded",
      startedAt: "2026-11-02T15:01:00Z",
    }),
  );
  expect(journal.read().undo[2]!.notWritten).toBeUndefined();
});

test("a fresh history acquisition during undo interrupts the old cursor without losing its accepted restore", async () => {
  const f = fixture();
  const first = await f.edit("human", "one", 1);
  const journal = createWorkJournal(f.key);
  const snapshot = { revision: 1, doc: { a: 1, b: 0 } };
  const history = { from: 1, acks: [first.write] };
  journal.restoreView(snapshot, history);
  let request: import("@pe/agent-contracts").WorkWrite | undefined;
  let finish: ((value: import("@pe/agent-contracts").RouteStateWriteResult) => void) | undefined;
  const undo = journal.undo((write) => {
    request = write;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  journal.restoreView(snapshot, history);
  if (!request || !finish) throw Error("Restore did not dispatch");
  const accepted = await f.host.write(f.key, f.key.route, "human", request);
  finish(accepted);
  expect(await undo).toMatchObject({ ok: false, code: "interrupted" });
  expect(journal.read().undo).toHaveLength(0);
  expect(journal.read().redo).toHaveLength(1);
  expect(journal.read().redo[0]!.cursor).toBe(0);
  expect(journal.read().revision).toBe(2);
});

test("history metadata survives host restart and counts toward the retained byte window", async () => {
  const f = fixture({ maxCount: 10, maxBytes: 3300 });
  for (let revision = 0; revision < 2; revision++) {
    expect(
      await f.host.write(f.key, f.key.route, "human", {
        kind: "apply",
        press: `meta-${revision}`,
        label: "Edit row",
        meta: { row: "x".repeat(2000) },
        expectedRevision: revision,
        patches: [{ path: ["a"], value: revision + 1 }],
      }),
    ).toMatchObject({ ok: true, write: { meta: { row: "x".repeat(2000) } } });
  }
  f.restart();
  const view = await f.snapshot();
  expect(view?.history.acks).toHaveLength(1);
  expect(view?.history.acks[0]?.meta).toEqual({ row: "x".repeat(2000) });
  const journal = createWorkJournal(f.key);
  journal.restoreView({ revision: view!.revision, doc: view!.doc }, view!.history);
  expect(journal.entries()[0]).toMatchObject({
    detail: "available",
    meta: { row: "x".repeat(2000) },
  });
});

test.each([
  [{ row: 42 }, "invalid_meta"],
  [{ row: "\u00e9".repeat(2048) }, "meta_too_large"],
] as const)(
  "host refuses invalid or oversized meta without evicting the undo window: %s",
  async (meta, code) => {
    const f = fixture();
    await f.edit("human", "retained", 1);
    expect(
      await f.host.write(f.key, f.key.route, "human", {
        kind: "apply",
        press: "bad-meta",
        label: "Bad detail",
        meta,
        expectedRevision: 1,
        patches: [{ path: ["a"], value: 2 }],
      }),
    ).toMatchObject({ ok: false, kind: "refused", code });
    f.restart();
    const view = await f.snapshot();
    expect(view).toMatchObject({ revision: 1, doc: { a: 1 } });
    expect(view?.history.acks.map((ack) => ack.press)).toEqual(["retained"]);
    expect(await f.host.step(f.key, f.key.route, "human", "undo", 1)).toMatchObject({
      ok: true,
      doc: { a: 0 },
    });
  },
);

test("per-author undo per document: Pea's and a person's undo each revert only their own edit and leave the other's", async () => {
  const f = fixture();
  await f.edit("human", "mine", 1);
  const pea = await f.host.write(f.key, f.key.route, "pea", {
    kind: "apply",
    press: "yours",
    expectedRevision: (await f.host.view(f.key, f.key.route))!.revision,
    patches: [{ path: ["b"], value: 2 }],
  });
  if (!pea.ok) throw Error(refusalText(pea));
  // The person's step is not last; their own undo still reaches it and leaves Pea's `b`.
  expect(await f.host.step(f.key, f.key.route, "human", "undo", pea.revision, true)).toMatchObject({
    ok: true,
    write: { step: "human:mine" },
    doc: { a: 0, b: 2 },
  });
  f.restart();
  const after = (await f.host.view(f.key, f.key.route))!.revision;
  expect(await f.host.step(f.key, f.key.route, "pea", "undo", after, true)).toMatchObject({
    ok: true,
    write: { step: "pea:yours" },
    doc: { a: 0, b: 0 },
  });
  // Nothing of the person's is left to undo; their redo brings back only their own edit.
  const last = (await f.host.view(f.key, f.key.route))!.revision;
  expect((await f.host.step(f.key, f.key.route, "human", "undo", last, true)).ok).toBe(false);
  expect(await f.host.step(f.key, f.key.route, "human", "redo", last, true)).toMatchObject({
    ok: true,
    doc: { a: 1, b: 0 },
  });
});
