// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { JOIN_KEY } from "@pe/ducts-domain/sheet/inputs";
import { isValidElement } from "react";
import type { LedgerBody } from "../ducts/sheet/mount";
import type {
  Observation,
  WorkWriteOutcome,
} from "../../../../packages/agent-contracts/src/work-journal-door";
import { createWitness } from "../fans/cutover.test-support";

const closes: (() => void)[] = [];
afterEach(() =>
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);
const settle = (write: unknown) =>
  new Promise<WorkWriteOutcome>((resolve) =>
    (write as Observation<WorkWriteOutcome>).subscribe(
      (outcome) => {
        if (outcome.kind !== "pending") resolve(outcome);
      },
      () => {},
    ),
  );

// ADR 0030 rule 9: Fans stages a /ducts join cell through the ducts owner's handle and journal.
test("a targeted Work verb lands in the owner's journal through the declared reading's handle", async () => {
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.fans.readingStatus("ductsWork").snapshot.current).toBe(true));
  f.fans.refresh("sheet");
  await vi.waitFor(() => expect(f.fans.readingStatus("sheet").snapshot.current).toBe(true));
  f.fans.refresh("pricing");
  expect(f.fans.readingStatus("pricing").snapshot.current).toBe(true);
  const sheet = f.fans.readingStatus("sheet").snapshot;
  const basis = sheet.current
    ? (sheet.value as { open: { overview: { basis: string } } }).open.overview.basis
    : null;
  const before = f.fans.readingStatus("ductsWork").snapshot as unknown as {
    handle: { revision: number };
  };
  const ownRevision = f.fans.work()?.revision;
  const acks: { by: string; label?: string; route: string }[] = [];
  closes.push(
    f.ws.subscribe((event) => {
      if (event.ok) acks.push({ by: event.by, label: event.label, route: event.route });
    }),
  );
  const pair: [string, string] = ["10:1", "30:1"];
  const ledger = f.fans.read("sheet-ledger");
  if (!isValidElement<Parameters<typeof LedgerBody>[0]>(ledger))
    throw Error("Fans Ledger did not render");
  const press = () =>
    ledger.props.ctx.verbs.ductsEdit({
      edits: { joins: [{ pair, verdict: "accept" }] },
      history: { label: "accept join → 30x30 · from /ducts" },
      basis,
    });
  // Both presses read the same owner handle; the owner revision admits one and fences the other.
  const [first, replay] = await Promise.all([settle(press()), settle(press())]);
  expect(first).toMatchObject({ kind: "accepted" });
  expect(replay).toMatchObject({ kind: "refused", refusal: { code: "stale_revision" } });
  await vi.waitFor(() =>
    expect(f.owner.work()?.value).toMatchObject({
      assumptions: {
        [JOIN_KEY(pair)]: { edit: { value: { kind: "verdict", verdict: "connect" } } },
      },
    }),
  );
  expect(f.owner.work()?.revision).toBe(before.handle.revision + 1);
  await vi.waitFor(() =>
    expect(f.fans.readingStatus("ductsWork").snapshot).toMatchObject({
      current: true,
      handle: { revision: before.handle.revision + 1 },
    }),
  );
  expect(f.fans.work()?.revision).toBe(ownRevision);
  expect(acks.filter((ack) => ack.route === "ducts")).toEqual([
    expect.objectContaining({ by: "human", label: "accept join → 30x30 · from /ducts" }),
  ]);
  expect(acks.filter((ack) => ack.route === "fans")).toEqual([]);
  expect(f.fans.readingStatus("pricing").snapshot.current).toBe(false);
});

test("a targeted Work verb refuses when the declared owner reading is not current", async () => {
  const f = await createWitness(closes);
  expect(() =>
    f.fans.invoke("ductsEdit", {
      edits: { joins: [{ pair: ["1:1", "2:1"], verdict: "accept" }] },
      basis: null,
    }),
  ).toThrow();
});
