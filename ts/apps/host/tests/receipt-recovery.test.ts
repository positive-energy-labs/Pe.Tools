import { invokeCommand } from "./command-fixture.ts";
import { receiptGoldenEnvelope } from "../../../packages/agent-contracts/tests/receipt-fixture.ts";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { type Receipt } from "@pe/agent-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { BridgeError } from "../src/bridge.ts";
import { readNativeReceipt } from "../src/native-receipts.ts";
import { originalProcess, sdkEnvelope } from "./native-receipt-fixture.ts";
import { crossingOf } from "./callers.ts";
import { writeJournal } from "./journal-fixture.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "pe-receipt-recovery-"));
  dirs.push(dir);
  const path = join(dir, "actions.json");
  const intent = {
    id: "private caller admission",

    key: "test.native",
    ...crossingOf("human"),
    effects: [{ kind: "session" as const, session: "receipt-recovery-session" }],
    target: { kind: "host" as const },
    input: { bytes: "\r\noriginal\r\n" },
  };
  const owner = new ActionJournal(path, () => ({
    ...receiptGoldenEnvelope.stamp!,
    component: "host",
  }));
  let dispatches = 0;
  await invokeCommand(
    owner,
    intent,
    async () => ({ originalProcess, frozen: "\r\nunchanged\r\n" }),
    (ex) =>
      ex.step("native", "test.native", { bytes: "exact" }, async () => {
        dispatches++;
        throw new BridgeError("lost transport", 503);
      }),
  );
  const action = await owner.wait(intent.id);
  return { path, owner, intent, action, dispatches: () => dispatches };
}

test("missing recovery preserves unknown; exact cancellation joins the original native UUID without dispatch", async () => {
  const { path, owner, action, dispatches, intent } = await fixture();
  expect(action.state).toBe("unknown");
  const root = (await owner.read({ kinds: ["action"] }))[0]!;
  const restarted = new ActionJournal(path);
  const seen: Receipt[] = [];
  restarted.subscribe({}, (r) => {
    seen.push(r);
  });
  const missing = await restarted.recover(action.id, (step) =>
    readNativeReceipt(step, originalProcess, async () =>
      sdkEnvelope({ state: "missing", requestId: step.id }),
    ),
  );
  expect(missing.state).toBe("unknown");
  const missingNative = (await restarted.read({ kinds: ["native"] }))[0]!;
  expect(missingNative.body).toMatchObject({
    verdict: "missing",
  });
  await restarted.recover(action.id, (step) =>
    readNativeReceipt(step, originalProcess, async () =>
      sdkEnvelope({ state: "missing", requestId: step.id }),
    ),
  );
  expect(await restarted.read({ kinds: ["native"] })).toEqual([missingNative]);
  const cancelled = await restarted.recover(action.id, (step) =>
    readNativeReceipt(step, originalProcess, async () =>
      sdkEnvelope({
        state: "cancelled",
        requestId: step.id,
        receipt: {
          requestId: step.id,
          key: step.key,
          pid: originalProcess.pid,
          processStartUtc: originalProcess.processStartUtc,
          verdict: "cancelled",
        },
        response: { error: "stopped at checkpoint", statusCode: 499 },
      }),
    ),
  );
  expect(cancelled.state).toBe("cancelled");
  await invokeCommand(
    restarted,
    intent,
    async () => {
      throw Error("must not prepare twice");
    },
    async () => {
      throw Error("must not dispatch twice");
    },
  );
  expect(dispatches()).toBe(1);
  const native = (await restarted.read({ kinds: ["native"] })).at(-1)!;
  expect(native.id).toBe(missingNative.id);
  expect(native.revision).toBe(missingNative.revision + 1);
  expect(native.join).toEqual({
    actionId: root.join.actionId,
    parentRequestId: root.join.requestId,
    requestId: action.steps[0]!.id,
  });
  expect(native.body).toMatchObject({
    kind: "native",
    verdict: "cancelled",
    localRef: { process: originalProcess },
  });
  expect(seen.filter((r) => r.body.kind === "action").at(-1)!.body).toEqual({
    kind: "action",
    value: cancelled,
  });
  expect(seen.some((r) => r.body.kind === "action" && r.body.value.state === "succeeded")).toBe(
    false,
  );
});

test("restart converts running to unknown once; a malformed journal is never overwritten", async () => {
  const { path, action } = await fixture();
  const {
    error: _error,
    status: _status,
    ...attempt
  } = action as typeof action & { error?: string; status?: number };
  const {
    error: _stepError,
    status: _stepStatus,
    ...step
  } = action.steps[0] as (typeof action.steps)[0] & { error?: string; status?: number };
  await writeJournal(path, [
    { ...attempt, state: "running", steps: [{ ...step, state: "running" }] },
  ]);
  const restarted = new ActionJournal(path);
  expect((await restarted.list())[0]!.state).toBe("unknown");
  const receipts = await restarted.read({});
  expect(await new ActionJournal(path).read({})).toEqual(receipts);
  for (const malformed of [
    { version: 4, actions: [], extra: true },
    { version: 4, receipts: [...receipts, ...receipts], mappings: {} },
  ]) {
    const bytes = JSON.stringify(malformed);
    await writeFile(path, bytes);
    await expect(new ActionJournal(path).read({})).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(bytes);
  }
});
