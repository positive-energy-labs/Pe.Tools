import { fixtureCommand, invokeCommand, registerFixtureCommand } from "./command-fixture.ts";
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
import { z } from "zod";
import type { CommandExecutor } from "../src/command-executor.ts";

const dirs: string[] = [];

test("an executor recovers an uncertain file from actual bytes and resumes without repeating it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-file-recovery-"));
  dirs.push(dir);
  const path = join(dir, "journal.jsonl");
  const output = join(dir, "written.txt");
  const source = "exact\r\noriginal file bytes\r\n";
  let writes = 0,
    preparations = 0;
  const factory: CommandExecutor = {
    definition: {
      says: "Write",
      needs: "nothing",
      effect: "command",
      dirties: [],
      input: z.object({}),
    },
    bind: async () => ({
      effects: [{ kind: "file", path: output }],
      prepare: async () => {
        preparations++;
        return { source };
      },
    }),
    prepared: z.object({ source: z.string() }),
    run: async (_context, execution) => {
      const prepared = execution.prepared as { source: string };
      return execution.step(
        "file",
        "write",
        { path: output, source: prepared.source },
        async () => {
          writes++;
          await writeFile(output, prepared.source);
          throw Error("Host lost the writer completion after its rename");
        },
      );
    },
    recover: async (step) => {
      if (step.kind !== "file") return { step, evidence: { inspected: false } };
      const actual = await readFile(output, "utf8");
      return {
        step: actual === source ? { ...step, state: "succeeded", result: { path: output } } : step,
        evidence: { path: output, matched: actual === source },
      };
    },
  };
  const owner = new ActionJournal(path);
  const crossing = crossingOf("human");
  registerFixtureCommand(owner, "test.file-write", factory);
  await owner.invoke(
    { id: "file-write", key: "test.file-write", target: { kind: "host" }, input: {} },
    crossing,
  );
  expect(await owner.wait("file-write")).toMatchObject({ state: "unknown" });
  const restarted = new ActionJournal(path);
  registerFixtureCommand(restarted, "test.file-write", factory);
  const recovered = await restarted.recover("file-write");
  expect(recovered.steps).toMatchObject([{ kind: "file", state: "succeeded" }]);
  await restarted.resume("file-write", crossing);
  expect(await restarted.wait("file-write")).toMatchObject({
    state: "succeeded",
    result: { path: output },
  });
  expect(await readFile(output, "utf8")).toBe(source);
  expect(writes).toBe(1);
  expect(preparations).toBe(1);
});
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
  let outcome: "missing" | "cancelled" = "missing";
  const recover = (step: import("@pe/agent-contracts").ActionStep) =>
    readNativeReceipt(step, originalProcess, async () =>
      sdkEnvelope(
        outcome === "missing"
          ? { state: "missing", requestId: step.id }
          : {
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
            },
      ),
    );
  registerFixtureCommand(
    restarted,
    action.key,
    fixtureCommand(
      [],
      async () => null,
      async () => null,
      [],
      [],
      { recover },
    ),
  );
  const missing = await restarted.recover(action.id);
  expect(missing.state).toBe("unknown");
  const missingNative = (await restarted.read({ kinds: ["native"] }))[0]!;
  expect(missingNative.body).toMatchObject({
    verdict: "missing",
  });
  await restarted.recover(action.id);
  expect(await restarted.read({ kinds: ["native"] })).toEqual([missingNative]);
  outcome = "cancelled";
  const cancelled = await restarted.recover(action.id);
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
