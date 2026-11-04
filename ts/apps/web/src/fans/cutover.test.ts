import { afterEach, expect, test, vi } from "vite-plus/test";
import { ductsDocumentSchema, workKey, type WorkWriteAck } from "@pe/agent-contracts";
import type {
  Observation,
  WorkWriteOutcome,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import { presentInputHistory } from "../ducts/sheet/input-history";
import { createWitness } from "./cutover.test-support";
import { admit } from "./admission.fixture";
const closes: (() => void)[] = [];
afterEach(() =>
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);
const settle = (write: Observation<WorkWriteOutcome>) =>
  new Promise<WorkWriteOutcome>((resolve) =>
    write.subscribe(
      (value) => {
        if (value.kind !== "pending") resolve(value);
      },
      () => {},
    ),
  );
const witness = () => createWitness(closes);
test("exclusive admission has one Ducts owner and a Fans presenter with the same Work fingerprint", async () => {
  const { owner, presenter, hostOwner, hostPresenter } = await admit();
  expect(owner.data.work).toHaveProperty("schema", "work");
  expect(presenter.data.work).toEqual({ route: "ducts" });
  expect(presenter.workFingerprint).toBe(owner.workFingerprint);
  expect(hostPresenter.resolvedWork!.spec).toEqual(hostOwner.resolvedWork!.spec);
});
test("human slot/drop/join edits share canonical Work, preserve siblings and restore named history after a cold shell reload", async () => {
  const f = await witness();
  await vi.waitFor(() => {
    expect(f.owner.workBasis()).not.toBeNull();
    expect(f.fans.workBasis()).not.toBeNull();
  });
  expect(workKey(f.owner.workBasis()!.token.scope.identity.work!)).toBe(
    workKey(f.fans.workBasis()!.token.scope.identity.work!),
  );
  const edits = [
    {
      history: { label: "Fan flow slot" },
      patches: [
        { path: ["labelParameter"], value: { edit: { value: "PE_M_Fan_AirFlow" } } },
      ],
    },
    {
      history: {
        label: "Part drop DS-1",
        clear: true,
        rowKey: "part-drop:7",
        was: "0.18 in-wg",
        row: { label: "DS-1", section: "parts", ids: [7] },
      },
      patches: [{ path: ["rules", "7"], value: { edit: { value: { table: "0.18" } } } }],
    },
    {
      history: { label: "Accept duct join" },
      patches: [
        {
          path: ["assumptions", "join:7:1|8:0"],
          value: { edit: { value: { kind: "verdict", verdict: "connect" } } },
        },
      ],
    },
  ];
  for (const edit of edits)
    expect(
      await settle(f.fans.invoke("edit", edit) as Observation<WorkWriteOutcome>),
    ).toMatchObject({ kind: "accepted" });
  expect(f.owner.work()!.value).toEqual(f.fans.work()!.value);
  const value = ductsDocumentSchema.parse(f.owner.work()!.value);
  expect(value.labelParameter.edit?.value).toBe("PE_M_Fan_AirFlow");
  expect(value.rules["7"]?.edit?.value.table).toBe("0.18");
  f.fans.close();
  const next = f.mount(f.admitted.presenter);
  await vi.waitFor(() => expect(next.workBasis()).not.toBeNull());
  expect(next.journal()!.moves.map((move) => move.label)).toEqual(
    edits.map((edit) => edit.history.label),
  );
  expect(next.history!.entries.map((entry) => entry.label)).toEqual(
    edits.map((edit) => edit.history.label),
  );
  expect(await next.history!.undo()).toMatchObject({ ok: true });
  expect(ductsDocumentSchema.parse(next.work()!.value).assumptions).toEqual({});
  expect(await next.history!.redo()).toMatchObject({ ok: true });
  expect(ductsDocumentSchema.parse(next.work()!.value).assumptions).toHaveProperty("join:7:1|8:0");
  const history = presentInputHistory(
    next.history!.entries as Parameters<typeof presentInputHistory>[0],
    null,
  );
  expect(history.last?.words).toBe("");
  expect(
    next
      .journal()!
      .receipts.map((ack: WorkWriteAck) => ack.meta)
      .filter(Boolean),
  ).toHaveLength(3);
});

test("W06: one-press Revert is a new edit; cleared-row Restore uses the host inverse", async () => {
  const f = await witness();
  await vi.waitFor(() => expect(f.fans.workBasis()).not.toBeNull());
  const edit = {
    history: { label: "Part drop DS-1" },
    patches: [{ path: ["rules", "7"], value: { edit: { value: { table: "0.18" } } } }],
  };
  expect(await settle(f.fans.invoke("edit", edit) as Observation<WorkWriteOutcome>)).toMatchObject({
    kind: "accepted",
  });
  const clear = {
    history: {
      label: "Revert DS-1",
      clear: true,
      rowKey: "part-drop:7",
      was: "0.18 in-wg",
      row: { label: "DS-1", section: "parts", ids: [7] },
    },
    patches: [{ path: ["rules", "7", "edit"], value: null }],
  };
  expect(await settle(f.fans.invoke("edit", clear) as Observation<WorkWriteOutcome>)).toMatchObject(
    { kind: "accepted" },
  );
  expect(ductsDocumentSchema.parse(f.fans.work()!.value).rules["7"]?.edit).toBeNull();
  const history = presentInputHistory(
    f.fans.history!.entries as Parameters<typeof presentInputHistory>[0],
    null,
  );
  expect(history.cleared).toMatchObject({
    rowKey: "part-drop:7",
    was: "0.18 in-wg",
    row: { label: "DS-1", ids: [7] },
  });
  expect(await f.fans.history!.undo(history.cleared!.press)).toMatchObject({ ok: true });
  expect(
    ductsDocumentSchema.parse(f.fans.work()!.value).rules["7"]?.edit?.value.table,
  ).toBe("0.18");
  expect(f.fans.journal()!.receipts.at(-1)).toMatchObject({ kind: "restore", restoreOf: 2 });
  expect(await f.fans.history!.redo()).toMatchObject({ ok: true });
  expect(ductsDocumentSchema.parse(f.fans.work()!.value).rules["7"]?.edit).toBeNull();
});

test("W07/X01: a new workspace reacquires Pea history and never replays an old value over the snapshot", async () => {
  const f = await witness();
  await vi.waitFor(() => expect(f.fans.workBasis()).not.toBeNull());
  const key = f.fans.workBasis()!.token.scope.identity.work!;
  expect(
    await f.ws.apply(
      key,
      "ducts",
      "pea",
      [{ path: ["rules", "8"], value: { edit: { value: { table: "0.25" } } } }],
      0,
      false,
      { press: "pea-drop", kind: "apply", label: "Pea part drop" },
    ),
  ).toMatchObject({ ok: true });
  await vi.waitFor(() => expect(f.fans.history!.entries.at(-1)?.label).toBe("Pea part drop"));
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close());
  const next = await createWitness(closes, f.saved);
  await vi.waitFor(() => expect(next.fans.workBasis()).not.toBeNull());
  expect(
    ductsDocumentSchema.parse(next.fans.work()!.value).rules["8"]?.edit?.value.table,
  ).toBe("0.25");
  expect(next.fans.history!.entries.map((entry) => entry.label)).toEqual(["Pea part drop"]);
  expect(await next.fans.history!.undo()).toMatchObject({ ok: true });
  expect(ductsDocumentSchema.parse(next.fans.work()!.value).rules).toEqual({});
});
