import { elementSubject } from "@pe/ducts-domain/work-subject";
import { snapshot } from "@pe/ducts-domain/test-fixture";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { fansDocumentSchema, ductsDocumentSchema, workKey } from "@pe/agent-contracts";
import type {
  Observation,
  WorkWriteOutcome,
} from "../../../../packages/agent-contracts/src/work-journal-door.ts";
import { createWitness } from "@pe/fans-web/cutover.test-support";
const closes: (() => void)[] = [];
const partNode = snapshot.nodes.find(node => node.kind === "fitting")!;
const part = elementSubject(partNode);
const terminal = elementSubject(snapshot.nodes.find(node => node.kind === "terminal")!);
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
test("human calculation/drop/flow edits stay in Fans Work, preserve siblings and restore named history after a cold shell reload", async () => {
  const f = await witness();

  await vi.waitFor(() => {
    expect(f.owner.workBasis()).not.toBeNull();
    expect(f.fans.workBasis()).not.toBeNull();
  });
  expect(workKey(f.owner.workBasis()!.token.scope.identity.work!)).not.toBe(
    workKey(f.fans.workBasis()!.token.scope.identity.work!),
  );
  const edits = [
    {
      history: { label: "Fan calculation" },
      patches: [
        { path: ["calculation", "fanFlow"], value: { edit: { value: { kind: "balanced-design", source: "test" } } } },
      ],
    },
    {
      history: {
        label: "Part drop DS-1",
        clear: true,
        rowKey: `part-drop:${partNode.id}`,
        was: "0.18 in-wg",
        row: { label: "DS-1", section: "parts", ids: [partNode.id] },
      },
      patches: [{ path: ["componentDrops", part], value: { edit: { value: { inWg: 0.18 } } } }],
    },
    {
      history: { label: "Set terminal flow" },
      patches: [
        {
          path: ["flows", terminal],
          value: { edit: { value: 200 } },
        },
      ],
    },
  ];
  for (const edit of edits)
    expect(
      await settle(f.fans.invoke("edit", edit) as Observation<WorkWriteOutcome>),
    ).toMatchObject({ kind: "accepted" });
  expect(ductsDocumentSchema.parse(f.owner.work()!.value).rules).toEqual({});
  expect(f.owner.work()?.revision).toBe(0);
  const value = fansDocumentSchema.parse(f.fans.work()!.value);
  expect(value.calculation.fanFlow?.edit?.value).toEqual({ kind: "balanced-design", source: "test" });
  expect(value.componentDrops[part]?.edit?.value.inWg).toBe(0.18);
  f.fans.close();
  const next = f.mount(f.admitted.presenter);
  await vi.waitFor(() => expect(next.workBasis()).not.toBeNull());
  expect(next.timeline()!.rows.flatMap(row => row.kind === "edit" ? [row.label] : [])).toEqual(
    edits.map((edit) => edit.history.label),
  );
  expect(await next.stepTimeline("undo")).toBeNull();
  expect(fansDocumentSchema.parse(next.work()!.value).flows).toEqual({});
  await vi.waitFor(() => expect(next.timeline()?.redo).toBeTruthy());
  expect(await next.stepTimeline("redo")).toBeNull();
  expect(fansDocumentSchema.parse(next.work()!.value).flows).toHaveProperty(terminal);
});

test("W06: one-press Revert is a new edit; cleared-row Restore uses the host inverse", async () => {
  const f = await witness();
  await vi.waitFor(() => expect(f.fans.workBasis()).not.toBeNull());
  const edit = {
    history: { label: "Part drop DS-1" },
    patches: [{ path: ["componentDrops", part], value: { edit: { value: { inWg: 0.18 } } } }],
  };
  expect(await settle(f.fans.invoke("edit", edit) as Observation<WorkWriteOutcome>)).toMatchObject({
    kind: "accepted",
  });
  const clear = {
    history: {
      label: "Revert DS-1",
      clear: true,
      rowKey: `part-drop:${partNode.id}`,
      was: "0.18 in-wg",
      row: { label: "DS-1", section: "parts", ids: [partNode.id] },
    },
    patches: [{ path: ["componentDrops", part, "edit"], value: null }],
  };
  expect(await settle(f.fans.invoke("edit", clear) as Observation<WorkWriteOutcome>)).toMatchObject(
    { kind: "accepted" },
  );
  expect(fansDocumentSchema.parse(f.fans.work()!.value).componentDrops[part]?.edit).toBeNull();
  await vi.waitFor(() => expect(f.fans.timeline()?.undo?.label).toBe("Revert DS-1"));
  expect(await f.fans.stepTimeline("undo")).toBeNull();
  expect(
    fansDocumentSchema.parse(f.fans.work()!.value).componentDrops[part]?.edit?.value.inWg,
  ).toBe(0.18);
  await vi.waitFor(() => expect(f.fans.timeline()?.rows.at(-1)).toMatchObject({ kind: "restore" }));
  await vi.waitFor(() => expect(f.fans.timeline()?.redo).toBeTruthy());
  expect(await f.fans.stepTimeline("redo")).toBeNull();
  expect(fansDocumentSchema.parse(f.fans.work()!.value).componentDrops[part]?.edit).toBeNull();
});

test("W07/X01: a new workspace reacquires Pea history and never replays an old value over the snapshot", async () => {
  const f = await witness();
  await vi.waitFor(() => expect(f.fans.workBasis()).not.toBeNull());
  const key = f.fans.workBasis()!.token.scope.identity.work!;
  expect(
    await f.ws.apply(
      key,
      "fans",
      "pea",
      [{ path: ["componentDrops", terminal], value: { edit: { value: { inWg: 0.25 } } } }],
      0,
      false,
      { press: "pea-drop", kind: "apply", label: "Pea part drop" },
    ),
  ).toMatchObject({ ok: true });
  await vi.waitFor(() => expect(f.fans.timeline()!.rows.flatMap(row => row.kind === "edit" ? [row.label] : []).at(-1)).toBe("Pea part drop"));
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close());
  const next = await createWitness(closes, f.saved);
  await vi.waitFor(() => expect(next.fans.workBasis()).not.toBeNull());
  expect(
    fansDocumentSchema.parse(next.fans.work()!.value).componentDrops[terminal]?.edit?.value.inWg,
  ).toBe(0.25);
  await vi.waitFor(() => expect(next.fans.timeline()?.rows.flatMap(row => row.kind === "edit" ? [row.label] : [])).toEqual(["Pea part drop"]));
  expect(next.fans.timeline()!.undo).toBeNull();
  expect(await next.fans.stepTimeline("undo")).toEqual({ message: "Nothing to undo" });
  expect(fansDocumentSchema.parse(next.fans.work()!.value).componentDrops[terminal]?.edit?.value.inWg).toBe(0.25);
});

test("Fans starts with empty inputs and undo after the ducts Work split", async () => {
  const f = await witness();
  await vi.waitFor(() => expect(f.owner.workBasis()).not.toBeNull());
  await settle(f.owner.invoke("edit", { patches: [{ path: ["rules", "elbow"], value: { edit: { value: { table: "CD3-1" } } } }] }) as Observation<WorkWriteOutcome>);
  expect(fansDocumentSchema.parse(f.fans.work()?.value)).toEqual(fansDocumentSchema.parse({}));
  expect(f.fans.timeline()?.rows ?? []).toEqual([]);
  expect(f.fans.work()?.revision).toBe(0);
  expect(ductsDocumentSchema.parse(f.owner.work()?.value).rules.elbow?.edit?.value.table).toBe("CD3-1");
});
