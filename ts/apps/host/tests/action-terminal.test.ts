/**
 * One table over every terminal-state site of the action journal: completion (an executor returns or
 * throws), recovery (native receipts settle uncertain steps), and restart (a running row is reloaded).
 * Each step's effect answers with a chosen outcome; the executor keeps going after a step error so a
 * row can hold any mix of step states.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vite-plus/test";
import type { ActionReceipt, ActionStep } from "@pe/agent-contracts";
import { ActionIncomplete, ActionJournal } from "../src/action-journal.ts";
import { BridgeError } from "../src/bridge.ts";
import { readNativeReceipt } from "../src/native-receipts.ts";
import { originalProcess, sdkEnvelope } from "./native-receipt-fixture.ts";

type Outcome = "succeeded" | "failed" | "dispatchedFailure" | "cancelled" | "unknown";
type End = "return" | "rethrow" | "incomplete" | "hostError";
type Terminal = { state: ActionReceipt["state"]; notDispatched: boolean };

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function journalPath() {
  const dir = await mkdtemp(join(tmpdir(), "pe-terminal-"));
  dirs.push(dir);
  return join(dir, "actions.json");
}
const admission = (id: string) => ({
  id,
  kind: "workflow" as const,
  key: "test.terminal",
  actor: "human" as const,
  destination: { kind: "host" as const },
  input: {},
  bases: {},
});
const answer = (outcome: Outcome) => {
  if (outcome === "succeeded") return { ok: true };
  if (outcome === "failed") throw new BridgeError("refused", 409, { notDispatched: true });
  if (outcome === "dispatchedFailure")
    throw new BridgeError("native failed", 422, { dispatched: true, result: { receipt: "kept" } });
  if (outcome === "cancelled") throw new BridgeError("cancelled", 499);
  throw new BridgeError("reply lost", 503);
};

const failedStep = (step: ActionStep): ActionStep => ({
  id: step.id,
  kind: step.kind,
  key: step.key,
  input: step.input,
  state: "failed",
  error: "native failed",
  status: 409,
});
const terminal = (row: ActionReceipt): Terminal => ({
  state: row.state,
  notDispatched: "notDispatched" in row && row.notDispatched === true,
});

async function complete(steps: Outcome[], end: End, prepareFails = false) {
  const journal = new ActionJournal(await journalPath());
  const id = randomUUID();
  await journal.admit(
    admission(id),
    async () => {
      if (prepareFails) throw Error("preparation refused");
      return {};
    },
    async (execution) => {
      let last: unknown;
      for (const [index, outcome] of steps.entries())
        try {
          await execution.step("native", `step-${index}`, { index }, async () => answer(outcome));
        } catch (error) {
          last = error;
        }
      if (end === "return") return "done";
      if (end === "rethrow") throw last;
      if (end === "incomplete") throw new ActionIncomplete("partial", { partial: true });
      throw Error("host code failed");
    },
  );
  return journal.wait(id);
}

// Completion: steps (in order) and how the executor ends.
const completion: [Outcome[], End, Terminal][] = [
  [[], "return", { state: "succeeded", notDispatched: false }],
  [["succeeded"], "return", { state: "succeeded", notDispatched: false }],
  [["failed"], "return", { state: "succeeded", notDispatched: false }],
  [["failed"], "rethrow", { state: "failed", notDispatched: true }],
  [["dispatchedFailure"], "rethrow", { state: "failed", notDispatched: false }],
  [["cancelled"], "rethrow", { state: "cancelled", notDispatched: false }],
  [["unknown"], "rethrow", { state: "unknown", notDispatched: false }],
  [["succeeded", "failed"], "rethrow", { state: "incomplete", notDispatched: false }],
  [["succeeded", "cancelled"], "rethrow", { state: "cancelled", notDispatched: false }],
  [["succeeded", "unknown"], "rethrow", { state: "unknown", notDispatched: false }],
  [["succeeded"], "incomplete", { state: "incomplete", notDispatched: false }],
  [["succeeded", "unknown"], "incomplete", { state: "unknown", notDispatched: false }],
  // Changed: an error in host code after a known effect is a known partial, not an uncertain effect.
  [["succeeded"], "hostError", { state: "incomplete", notDispatched: false }],
  // Changed: an error before any step is a pre-effect failure; every effect is a recorded step.
  [[], "hostError", { state: "failed", notDispatched: true }],
  [[], "incomplete", { state: "failed", notDispatched: true }],
  // Changed: an earlier uncertain step is never hidden by a later refusal, cancel, or return.
  [["unknown", "failed"], "rethrow", { state: "unknown", notDispatched: false }],
  [["unknown", "cancelled"], "rethrow", { state: "unknown", notDispatched: false }],
  [["unknown"], "return", { state: "unknown", notDispatched: false }],
];
test.each(completion)("completion %j then %s", async (steps, end, expected) => {
  expect(terminal(await complete(steps, end))).toEqual(expected);
});
test("completion: a preparation that throws is failed and not dispatched", async () => {
  expect(terminal(await complete([], "return", true))).toEqual({
    state: "failed",
    notDispatched: true,
  });
});

test("completion: a dispatched native failure keeps its authoritative result", async () => {
  const row = await complete(["dispatchedFailure"], "rethrow");
  expect(row).toMatchObject({
    state: "failed",
    evidence: { result: { receipt: "kept" } },
    steps: [{ state: "failed", evidence: { result: { receipt: "kept" } } }],
  });
  expect(row).not.toHaveProperty("notDispatched");
});

// Recovery: an unknown row whose unknown steps the native receipt settles, in order.
const recovery: [Outcome[], Outcome[], Terminal | "throws"][] = [
  [["unknown"], ["unknown"], { state: "unknown", notDispatched: false }],
  [["unknown"], ["failed"], { state: "failed", notDispatched: true }],
  [["unknown"], ["cancelled"], { state: "cancelled", notDispatched: false }],
  // Recovery cannot know the executor finished after its effects; resume settles it.
  [["unknown"], ["succeeded"], { state: "unknown", notDispatched: false }],
  [["succeeded", "unknown"], ["succeeded"], { state: "unknown", notDispatched: false }],
  // Fixed: recover used to throw here (unknown-only fields reached the cancelled receipt).
  [["succeeded", "unknown"], ["cancelled"], { state: "cancelled", notDispatched: false }],
  // Changed: a known effect followed by a proven refusal is incomplete, as at completion.
  [["succeeded", "unknown"], ["failed"], { state: "incomplete", notDispatched: false }],
  [["unknown", "unknown"], ["failed", "cancelled"], { state: "cancelled", notDispatched: false }],
  [["unknown", "unknown"], ["failed", "failed"], { state: "failed", notDispatched: true }],
];
test.each(recovery)("recovery %j settled as %j", async (steps, settled, expected) => {
  const path = await journalPath();
  const journal = new ActionJournal(path);
  const id = randomUUID();
  await journal.admit(
    admission(id),
    async () => ({}),
    async (execution) => {
      let last: unknown;
      for (const [index, outcome] of steps.entries())
        try {
          await execution.step("native", `step-${index}`, { index }, async () => answer(outcome));
        } catch (error) {
          last = error;
        }
      throw last;
    },
  );
  expect((await journal.wait(id)).state).toBe("unknown");
  let next = 0;
  const recovering = journal.recover(id, async (step: ActionStep) => {
    const outcome = settled[next++]!;
    const base = { id: step.id, kind: step.kind, key: step.key, input: step.input };
    const settledStep: ActionStep =
      outcome === "succeeded"
        ? { ...base, state: "succeeded", result: { ok: true } }
        : outcome === "failed"
          ? { ...base, state: "failed", error: "refused", status: 409, notDispatched: true }
          : outcome === "cancelled"
            ? { ...base, state: "cancelled", error: "cancelled", status: 499 }
            : step;
    return { step: settledStep, evidence: { outcome } };
  });
  if (expected === "throws") await expect(recovering).rejects.toThrow();
  else expect(terminal(await recovering)).toEqual(expected);
});

test("recovery keeps an authoritative native failure without inventing non-dispatch", async () => {
  const path = await journalPath();
  const journal = new ActionJournal(path);
  const id = randomUUID();
  await journal.admit(
    admission(id),
    async () => ({}),
    async (execution) => {
      await execution.step("native", "step-0", {}, async () => answer("unknown"));
    },
  );
  await journal.wait(id);

  const recovered = await journal.recover(id, async (step) => ({
    step: failedStep(step),
    evidence: { verdict: "failed" },
  }));

  expect(recovered).toMatchObject({ state: "failed", error: "native failed", status: 409 });
  expect(recovered).not.toHaveProperty("notDispatched");
});

// Restart: a row still running when the host stops, reloaded from disk.
async function restart(steps: ActionStep["state"][], prepared: boolean) {
  const path = await journalPath();
  const id = randomUUID();
  const row = {
    ...admission(id),
    request: {},
    steps: steps.map((state, index) => ({
      id: randomUUID(),
      kind: "native",
      key: `step-${index}`,
      input: { index },
      state,
      ...(state === "succeeded" ? { result: { ok: true } } : {}),
    })),
    preparation: prepared ? { state: "ready", value: {} } : { state: "unprepared" },
    recovery: [],
    publication: { state: "unrequested" },
    startedAt: new Date().toISOString(),
    state: "running",
  };
  delete (row as { input?: unknown }).input;
  await writeFile(path, JSON.stringify({ version: 3, actions: [row] }));
  const journal = new ActionJournal(path);
  const reloaded = (await journal.list(undefined, id))[0]!;
  expect(JSON.parse(await readFile(path, "utf8")).actions[0].state).toBe(reloaded.state);
  return reloaded;
}
const restarts: [ActionStep["state"][], boolean, Terminal][] = [
  [["running"], true, { state: "unknown", notDispatched: false }],
  [["succeeded", "running"], true, { state: "unknown", notDispatched: false }],
  // Changed: a restart before any step is a pre-effect failure; between known steps, a known partial.
  [[], true, { state: "failed", notDispatched: true }],
  [["succeeded"], true, { state: "incomplete", notDispatched: false }],
  // Changed: before preparation froze nothing can have dispatched. The old unknown row could be
  // neither recovered nor resumed, so it blocked its destination for good.
  [[], false, { state: "failed", notDispatched: true }],
];
test.each(restarts)("restart with steps %j, prepared %s", async (steps, prepared, expected) => {
  expect(terminal(await restart(steps, prepared))).toEqual(expected);
});

// Hazard 3 (headless research, 2026-09-26): a crashed script's unknown action refused every action
// on the host, for every session, and recovery could not settle it because the SDK read the dead
// pid as unreadable (Win32 error 31) rather than dead.
const onDocument = (id: string, session: string, openId: string) => ({
  ...admission(id),
  kind: "operation" as const,
  key: "scripting.execute",
  destination: { kind: "document" as const, ref: { session, openId } },
});
const nativeLeaf = async () => ({ kind: "native-leaf", process: originalProcess });
async function crashedOn(journal: ActionJournal, session: string, openId: string) {
  const id = randomUUID();
  await journal.admit(onDocument(id, session, openId), nativeLeaf, async (execution) =>
    execution.step("native", "scripting.execute", {}, async () => answer("unknown")),
  );
  expect((await journal.wait(id)).state).toBe("unknown");
  return id;
}
const admitOn = (journal: ActionJournal, session: string, openId: string) =>
  journal.admit(onDocument(randomUUID(), session, openId), nativeLeaf, async () => "done");

test("an unknown action on session A, document X does not block session B, document Y", async () => {
  const journal = new ActionJournal(await journalPath());
  await crashedOn(journal, "session-a", "doc-x");
  const other = await admitOn(journal, "session-b", "doc-y");
  expect((await journal.wait(other.id)).state).toBe("succeeded");
  // Another document on the same session is a different destination too.
  const sibling = await admitOn(journal, "session-a", "doc-y");
  expect((await journal.wait(sibling.id)).state).toBe("succeeded");
});

test("an unknown action on session A, document X blocks A/X and a session-wide action on A", async () => {
  const journal = new ActionJournal(await journalPath());
  const crashed = await crashedOn(journal, "session-a", "doc-x");
  await expect(admitOn(journal, "session-a", "doc-x")).rejects.toThrow(
    `action '${crashed}' is unknown; recover that attempt`,
  );
  await expect(
    journal.admit(
      {
        ...onDocument(randomUUID(), "session-a", "doc-x"),
        destination: { kind: "session", session: "session-a" },
      },
      nativeLeaf,
      async () => "done",
    ),
  ).rejects.toThrow(/recover that attempt/);
});

const sdkRead = (state: string, codes: string[]) => async (args: readonly string[]) => {
  const requestId = args[args.indexOf("result") + 1]!;
  const envelope = JSON.parse(sdkEnvelope({ state, requestId, receipt: null, response: null }));
  envelope.diagnostics = codes.map((code) => ({ code, detail: code, fix: null }));
  return JSON.stringify(envelope);
};
const gone: [string, Parameters<typeof sdkRead>, boolean][] = [
  // Wave-1 SDK verdict: the incarnation is dead.
  ["the SDK reports the process dead", ["abandoned", ["op.process-dead"]], false],
  // Until then: unreadable pid, but the same SDK session re-registered as a new process.
  [
    "liveness is unknown and the session reconnected as a new pid",
    ["pending", ["op.liveness-unknown"]],
    true,
  ],
];
test.each(gone)("recovery settles failed when %s", async (_, [state, codes], successor) => {
  const journal = new ActionJournal(await journalPath());
  const id = await crashedOn(journal, "session-a", "doc-x");
  const recovered = await journal.recover(id, (step) =>
    readNativeReceipt(
      step,
      originalProcess,
      sdkRead(state, codes),
      successor
        ? { sdkSessionId: "agent-1", pid: originalProcess.pid + 1, processStartUtcUnixMs: 5000 }
        : undefined,
    ),
  );
  expect(recovered).toMatchObject({
    state: "failed",
    status: 503,
    error: `Revit process ${originalProcess.pid} ended before 'scripting.execute' recorded an outcome`,
    evidence: { result: { process: originalProcess, sdk: { state } } },
  });
  expect(recovered).not.toHaveProperty("notDispatched");
  // Settled, so it no longer blocks its own destination.
  const next = await admitOn(journal, "session-a", "doc-x");
  expect((await journal.wait(next.id)).state).toBe("succeeded");
});

test("unreadable liveness without a successor process stays unknown", async () => {
  const journal = new ActionJournal(await journalPath());
  const id = await crashedOn(journal, "session-a", "doc-x");
  for (const successor of [
    undefined,
    // The session re-registered from the SAME process: nothing proves it died.
    {
      sdkSessionId: "agent-1",
      pid: originalProcess.pid,
      processStartUtcUnixMs: Date.parse(originalProcess.processStartUtc),
    },
  ])
    expect(
      (
        await journal.recover(id, (step) =>
          readNativeReceipt(
            step,
            originalProcess,
            sdkRead("pending", ["op.liveness-unknown"]),
            successor,
          ),
        )
      ).state,
    ).toBe("unknown");
});
