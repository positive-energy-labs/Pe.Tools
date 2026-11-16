import { expect, test } from "vite-plus/test";
import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { stateFixture } from "../../../tests/isolated-home/storage.ts";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { ActionJournal, journalKind } from "../src/action-journal.ts";
import { readJournalSnapshot } from "../src/journal-snapshot.ts";
import {
  actionAdmissionSchema,
  actionReceiptSchema,
  executionTargetSchema,
  persistedActionReceiptSchema,
  persistedReceiptSchema,
  persistActionReceipt,
  persistReceipt,
  projectActionReceipt,
} from "@pe/agent-contracts";
import { Effect } from "effect";

const id = "retained-original";
const uuid = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const broker = {
  kind: "document" as const,
  ref: { session: "session-bfc14fe1f03e7233", openId: "original-open" },
};
const exact = {
  kind: "document" as const,
  ref: {
    session: "pe.app-25",
    processIncarnation: { pid: 82836, startedAt: 1000 },
    openId: "original-open",
  },
};
const caller = { kind: "human" as const, via: "local" as const };
const process = {
  pid: 82836,
  processStartUtc: "2026-11-16T17:00:00Z",
  executable: "C:\\Revit.exe",
};
const action = (
  target: typeof broker | typeof exact = broker,
  state: "succeeded" | "unknown" = "succeeded",
) =>
  persistedActionReceiptSchema.parse({
    id,
    key: "families.apply",
    state,
    ...(state === "succeeded"
      ? { result: { confirmed: true } }
      : { error: "unanswered", status: 503 }),
    caller,
    basis: null,
    target,
    input: { originalWorkKey: "families/open:session-bfc14fe1f03e7233/original-open" },
    consumes: [
      {
        kind: "work",
        probe: {
          handle: {
            key: { binding: "open", route: "families", target: null, open: broker.ref },
            revision: 7,
          },
          paths: [],
        },
        expected: {},
      },
    ],
    steps: [
      {
        id: uuid(4),
        key: "original-native-key",
        kind: "native",
        input: { original: 7 },
        process,
        transport: "sdk",
        state: state === "succeeded" ? "succeeded" : "unknown",
        ...(state === "succeeded"
          ? { result: { confirmed: true } }
          : { error: "unanswered", status: 503 }),
      },
    ],
    prepared: {
      state: "ready",
      value: { originalWorkKey: "families/open:session-bfc14fe1f03e7233/original-open" },
    },
    recovery: [],
    startedAt: "2026-11-16T18:00:00Z",
  });
const envelope = (value: ReturnType<typeof action>) =>
  persistedReceiptSchema.parse({
    schema: 1,
    id: uuid(3),
    revision: 1,
    at: "2026-11-16T18:00:00Z",
    stamp: null,
    join: { actionId: uuid(1), requestId: uuid(2) },
    body: { kind: "action", value },
  });
const bytes = (value: ReturnType<typeof action>) =>
  Buffer.from(
    [
      JSON.stringify({ version: 8 }),
      JSON.stringify({ mapping: [JSON.stringify(["action", id]), uuid(1)] }),
      JSON.stringify({ mapping: [JSON.stringify(["action-request", id]), uuid(2)] }),
      JSON.stringify({ receipt: envelope(value) }),
      "",
    ].join("\n"),
  );
async function journal(value: ReturnType<typeof action>) {
  const dir = await mkdtemp(join(tmpdir(), "retained-receipt-"));
  const file = journalKind.in(stateFixture(dir), "journal.jsonl");
  const original = bytes(value);
  await writeFile(file.path, original);
  return {
    owner: new ActionJournal(file, () => Date.parse("2026-11-16T18:01:00Z")),
    file,
    original,
  };
}

test("v8 retained target and nested Work evidence roundtrip without an epoch change", () => {
  for (const target of [exact, broker]) {
    const original = action(target);
    const snapshot = readJournalSnapshot(bytes(original))!;
    expect(snapshot.discarded).toBeNull();
    expect(snapshot.receipts).toHaveLength(1);
    const row = snapshot.receipts[0]!;
    expect(persistReceipt(row)).toEqual({
      ...envelope(original),
      body: {
        kind: "action",
        value: { ...original, outcome: projectActionReceipt(original).outcome },
      },
    });
    if (row.body.kind !== "action") throw Error("Missing action");
    expect(row.body.value).toMatchObject({ state: "succeeded", result: { confirmed: true } });
    expect(persistActionReceipt(row.body.value).target).toEqual(target);
    expect(row.body.value.consumes).toEqual(original.consumes);
    expect(row.body.value.prepared).toEqual(original.prepared);
    expect(row.body.value.steps).toEqual(original.steps);
  }
});

test("unavailable-original is inspectable and never a fresh admission target", () => {
  const original = action();
  const view = actionReceiptSchema.parse({
    ...original,
    target: { kind: "unavailable-original", original: broker },
  });
  expect(persistActionReceipt(view).target).toEqual(broker);
  expect(
    actionAdmissionSchema.safeParse({
      id,
      key: original.key,
      input: original.input,
      target: view.target,
    }).success,
  ).toBe(false);
  expect(view.outcome).toEqual(projectActionReceipt(original).outcome);
});

test("retained original-id observation and retry preserve disk identity and do not resolve a new label", async () => {
  // Before S2's cut the unsupported exact tuple exercises the same unavailable projection.
  // The archive compatibility check runs these tests against S2's actual live schema as well.
  const original = action(executionTargetSchema.safeParse(exact).success ? broker : exact);
  const f = await journal(original);
  try {
    const observed = (await f.owner.readFor(caller, undefined, id))[0]!;
    expect(observed.target).toEqual({ kind: "unavailable-original", original: original.target });
    expect(await f.owner.resume(id, { caller, basis: null })).toEqual(observed);
    const retry = { id, key: original.key, target: original.target, input: original.input };
    expect(await f.owner.invoke(retry, { caller, basis: null })).toEqual(observed);
    await expect(
      f.owner.invoke({ ...retry, id: "fresh" }, { caller, basis: null }),
    ).rejects.toThrow();
    await expect(
      f.owner.invoke({ ...retry, input: {} }, { caller, basis: null }),
    ).rejects.toThrow();
    expect(await readFile(f.file.path)).toEqual(f.original);
    expect((await f.owner.list(undefined, id))[0]?.steps[0]?.id).toBe(uuid(4));
  } finally {
    await f.owner.close();
  }
});

test("historical unknown recovery queries only original native evidence and cannot continue effects", async () => {
  const original = action(
    executionTargetSchema.safeParse(exact).success ? broker : exact,
    "unknown",
  );
  const f = await journal(original);
  let observations = 0;
  f.owner.bindCommands({
    probe: async () => {
      throw Error("No current probe");
    },
    resolve: () => ({
      definition: {
        says: "held",
        needs: "document",
        effect: "command",
        dirties: [],
        input: z.record(z.string(), z.unknown()),
      },
      prepared: z.unknown(),
      bind: async () => {
        throw Error("No fresh bind");
      },
      run: () => Effect.die("No fresh effect"),
      recover: async (step, prepared, target) => {
        observations++;
        expect(step.id).toBe(uuid(4));
        expect(step.key).toBe("original-native-key");
        expect(step.process).toEqual(process);
        expect(prepared).toEqual(
          original.prepared.state === "ready" ? original.prepared.value : undefined,
        );
        expect(target).toEqual({ kind: "unavailable-original", original: original.target });
        return {
          step: { ...step, state: "succeeded", result: { confirmed: true } },
          evidence: { requestId: step.id, process },
        };
      },
    }),
  });
  try {
    const observed = await f.owner.recover(id);
    expect(observations).toBe(1);
    expect(observed.steps[0]).toMatchObject({
      id: uuid(4),
      key: "original-native-key",
      state: "succeeded",
    });
    expect(observed.target).toEqual({ kind: "unavailable-original", original: original.target });
    expect(observed.prepared).toEqual(original.prepared);
    const stored = readJournalSnapshot(await readFile(f.file.path))!;
    expect(stored.discarded).toBeNull();
    const latest = stored.receipts.at(-1)!;
    expect(latest.body.kind).toBe("action");
    if (latest.body.kind === "action")
      expect(persistActionReceipt(latest.body.value).target).toEqual(original.target);
  } finally {
    await f.owner.close();
  }
});
