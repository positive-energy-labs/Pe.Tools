import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vite-plus/test";
import type { ActionReceipt, ActionStep } from "@pe/agent-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { BridgeError } from "../src/bridge.ts";
import { readNativeReceipt } from "../src/native-receipts.ts";
import { originalProcess, sdkEnvelope } from "./native-receipt-fixture.ts";
import { crossingOf } from "./callers.ts";
import { readJournal, writeJournal } from "./journal-fixture.ts";

type Outcome = "succeeded" | "failed" | "dispatchedFailure" | "cancelled" | "unknown";
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
  ...crossingOf("human"),
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

const terminal = (row: ActionReceipt): Terminal => ({
  state: row.state,
  notDispatched: "notDispatched" in row && row.notDispatched === true,
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
  await writeJournal(path, [row]);
  const journal = new ActionJournal(path);
  const reloaded = (await journal.list(undefined, id))[0]!;
  const [stored] = (await readJournal(path)).receipts;
  expect(stored!.body.kind === "action" && stored!.body.value.state).toBe(reloaded.state);
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
    ["running", ["op.liveness-unknown"]],
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
            sdkRead("running", ["op.liveness-unknown"]),
            successor,
          ),
        )
      ).state,
    ).toBe("unknown");
});
