import { workFingerprintSchema } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { createWorkFeedClient } from "./work-feed-client";
import { createFixtureWorkDoor } from "./fixture-work-door";
import type {
  WorkScope,
  Observation,
  JournalCommandId,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import type { InvocationBasis } from "../../../../packages/agent-contracts/src/route-kernel-page";
const scope: WorkScope = {
  route: "note",
  fingerprint: workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),
  key: { binding: "host", route: "note", target: null },
  target: null,
  subject: null,
};
const write = {
  patches: [{ path: ["amount"], value: 2 }],
  kind: "apply" as const,
  expectedRevision: 0,
  press: "p",
};
const invocation = {} as InvocationBasis;
const ack = {
  key: scope.key,
  kind: "apply" as const,
  by: "human" as const,
  press: "p",
  base: 0,
  revision: 1,
  patches: write.patches,
  inverse: [{ path: ["amount"], value: 0 }],
  undoable: true,
};
const finish = <A extends { kind: string }>(observation: Observation<A>) =>
  new Promise<A>((resolve) =>
    observation.subscribe(
      (value) => {
        if (value.kind !== "pending") resolve(value);
      },
      () => {},
    ),
  );
test("Work submits authentic ack, refusal and current stale revision without journal admission", async () => {
  const writer = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, revision: 1, write: ack })
    .mockResolvedValueOnce({ ok: false, kind: "refused", error: "No", hint: "Fix" })
    .mockResolvedValueOnce({
      ok: false,
      kind: "refused",
      code: "stale_revision",
      error: "Moved",
      hint: "Rebase",
      revision: 9,
    });
  const submit = vi.fn();
  const door = createWorkFeedClient(
    { subscribe: () => () => {}, dirty: () => {} },
    { write: writer, submit },
  );
  expect(await finish(door.submitWork(scope, write, invocation))).toEqual({
    kind: "accepted",
    ack,
  });
  expect((await finish(door.submitWork(scope, write, invocation))).kind).toBe("refused");
  expect(await finish(door.submitWork(scope, write, invocation))).toMatchObject({
    kind: "refused",
    refusal: { code: "stale_revision", revision: 9 },
  });
  expect(writer).toHaveBeenCalledWith(scope.key, write, invocation);
  expect(submit).not.toHaveBeenCalled();
});
test("native command survives observer departure and expires outside bounded replay", async () => {
  const submit = vi.fn().mockImplementation(async (command) => ({
    state: "succeeded",
    id: command.id,
    result: { saved: command.id },
  }));
  const door = createWorkFeedClient(
    { subscribe: () => () => {}, dirty: () => {} },
    { write: vi.fn(), submit },
    1,
  );
  const command = (id: string) => ({
    id,
    key: "test",
    target: { kind: "host" as const },
    input: {},
  });
  const first = door.submit(command("first"));
  first.accepted.subscribe(
    () => {},
    () => {},
  )();
  await finish(first.accepted);
  expect(door.accepted(first.handle.id)).toMatchObject({
    kind: "accepted-native",
    receiptId: "first",
    outcome: "committed",
    result: { saved: "first" },
  });
  expect(first.key).toBe("test");
  await finish(door.submit(command("second")).accepted);
  expect(door.accepted("first" as JournalCommandId)).toMatchObject({
    kind: "rejected",
    failure: "expired",
  });
});
test("fixture Work stores are isolated and native commands refuse", async () => {
  const spec = {
    route: "note",
    title: "Note",
    description: "",
    schema: z.object({ amount: z.number() }),
  };
  const a = createFixtureWorkDoor(spec, { amount: 0 }),
    b = createFixtureWorkDoor(spec, { amount: 0 });
  const seen: unknown[] = [];
  a.open(scope).subscribe(
    (v) => seen.push(v),
    () => {},
  );
  expect((await finish(a.submitWork(scope, write, invocation))).kind).toBe("accepted");
  expect(seen.at(-1)).toMatchObject({ kind: "ack", ack: { revision: 1 } });
  const other: unknown[] = [];
  b.open(scope).subscribe(
    (v) => other.push(v),
    () => {},
  );
  await expect
    .poll(() => other.at(-1))
    .toMatchObject({
      kind: "ready",
      snapshot: { revision: 0, value: { amount: 0 } },
    });
  expect(await finish(a.submitWork(scope, write, invocation))).toMatchObject({
    kind: "refused",
    refusal: { code: "stale_revision", revision: 1 },
  });
  const reopened: unknown[] = [];
  const stop = a.open(scope).subscribe(
    (value) => reopened.push(value),
    () => {},
  );
  await expect
    .poll(() => reopened.at(-1))
    .toMatchObject({
      kind: "ready",
      snapshot: { revision: 1, value: { amount: 2 } },
      history: { acks: [{ base: 0, revision: 1, inverse: [{ path: ["amount"], value: 0 }] }] },
    });
  expect(
    await finish(
      a.submitWork(
        scope,
        {
          kind: "restore",
          press: null,
          expectedRevision: 1,
          restoreOf: 1,
          patches: [{ path: ["amount"], value: 0 }],
        },
        invocation,
      ),
    ),
  ).toMatchObject({ kind: "accepted", ack: { base: 1, revision: 2, restoreOf: 1 } });
  expect(reopened.at(-1)).toMatchObject({
    kind: "ack",
    ack: { patches: [{ path: ["amount"], value: 0 }] },
  });
  stop();
  expect(
    await finish(
      a.submit({ id: "native", key: "test", target: { kind: "host" }, input: {} }).accepted,
    ),
  ).toMatchObject({ kind: "rejected", failure: "unavailable" });
});
