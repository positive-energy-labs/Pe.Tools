import { invokeCommand } from "./command-fixture.ts";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
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
import { refused, type StepRecovery } from "../src/command-executor.ts";

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

  key: "test.terminal",
  ...crossingOf("human"),
  target: { kind: "host" as const },
  input: {},
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
  const owner = new ActionJournal(path);
  let crash = "";
  await invokeCommand(
    owner,
    admission(id),
    async () => {
      if (!prepared) {
        crash = await readFile(path, "utf8");
        throw Error("Host stopped before preparation");
      }
      return {};
    },
    async (execution) => {
      for (const [index, state] of steps.entries()) {
        await execution.step("native", `step-${index}`, { index }, async () => {
          if (state === "running") {
            crash = await readFile(path, "utf8");
            throw new BridgeError("Host stopped in dispatch", 503);
          }
          return { ok: true };
        });
      }
      crash = await readFile(path, "utf8");
      throw Error("Host stopped between steps");
    },
  );
  await owner.wait(id);
  await owner.close();
  // Restore bytes captured at the real persistence boundary, never synthesize current records.
  await writeFile(path, crash);
  const journal = new ActionJournal(path);
  const reloaded = (await journal.list(undefined, id))[0]!;
  const [stored] = await new ActionJournal(path).read({});
  expect(stored!.body.kind === "action" && stored!.body.value.state).toBe(reloaded.state);
  return reloaded;
}
const restarts: [ActionStep["state"][], boolean, Terminal][] = [
  [["running"], true, { state: "unknown", notDispatched: false }],
  [["succeeded", "running"], true, { state: "unknown", notDispatched: false }],
  // Changed: a restart before any step is a pre-effect failure; between known steps, a known partial.
  [[], true, { state: "failed", notDispatched: true }],
  [["succeeded"], true, { state: "incomplete", notDispatched: false }],
  // Changed: before prepared froze nothing can have dispatched. The old unknown row could be
  // neither recovered nor resumed, so it blocked its target for good.
  [[], false, { state: "failed", notDispatched: true }],
];
test.each(restarts)("restart with steps %j, prepared %s", async (steps, prepared, expected) => {
  expect(terminal(await restart(steps, prepared))).toEqual(expected);
});

// The generated catalog, never the key's spelling, says a succeeded step changed nothing (Read, or a
// TransactRead that rolls back). A refusal after one is a known refusal; after any other step it is partial.
const plan = { fittings: [], terminals: [], components: [], equipment: [], terminalFlows: [], equipmentFlows: [], store: {} };
async function refusedAfter(path: string, key: string) {
  const journal = new ActionJournal(path);
  const id = randomUUID();
  let crash = "";
  await invokeCommand(journal, admission(id), async () => ({}), async (execution) => {
    await execution.step("native", key, plan, async () => ({ ok: true }));
    crash = await readFile(path, "utf8");
    throw refused("Shared type cannot be scoped", "ducts.plan-refused");
  });
  const row = await journal.wait(id);
  await journal.close();
  return { id, row, crash };
}
test.each([
  ["ducts.apply.plan", { state: "failed", notDispatched: false }],
  ["ducts.apply", { state: "incomplete", notDispatched: false }],
  ["uncataloged.step", { state: "incomplete", notDispatched: false }],
] as const)("a refusal after a succeeded %s step settles %j", async (key, expected) => {
  const { row } = await refusedAfter(await journalPath(), key);
  expect(terminal(row)).toEqual(expected);
  expect(row.outcome?.state).toBe(expected.state === "failed" ? "refused" : "outcome-unknown");
});
test("a recovered Read step without its catalog stamp stays a conservative effect", async () => {
  const path = await journalPath();
  const { id, crash } = await refusedAfter(path, "ducts.apply.plan");
  expect(crash).toMatch(/"effect":"Read",?/);
  await writeFile(path, crash.replace(/"effect":"Read",?/g, ""));
  const [reloaded] = await new ActionJournal(path).list(undefined, id);
  expect(terminal(reloaded!)).toEqual({ state: "incomplete", notDispatched: false });
});

// Hazard 3 (headless research, 2026-09-26): a crashed script's unknown action refused every action
// on the host, for every session, and recovery could not settle it because the SDK read the dead
// pid as unreadable (Win32 error 31) rather than dead.
const onDocument = (id: string, session: string, openId: string) => ({
  ...admission(id),

  key: `test.terminal.${id}`,
  target: { kind: "document" as const, ref: { session, openId } },
});
const nativeLeaf = async () => ({ kind: "native-leaf", process: originalProcess });
async function crashedOn(
  journal: ActionJournal,
  session: string,
  openId: string,
  recover?: StepRecovery,
) {
  const id = randomUUID();
  await invokeCommand(
    journal,
    onDocument(id, session, openId),
    nativeLeaf,
    async (execution) =>
      execution.step("native", "scripting.execute", {}, async () => answer("unknown")),
    false,
    { recover },
  );
  expect((await journal.wait(id)).state).toBe("unknown");
  return id;
}
const admitOn = (journal: ActionJournal, session: string, openId: string) =>
  invokeCommand(journal, onDocument(randomUUID(), session, openId), nativeLeaf, async () => "done");

test("an unknown action on session A, document X does not block session B, document Y", async () => {
  const journal = new ActionJournal(await journalPath());
  await crashedOn(journal, "session-a", "doc-x");
  const other = await admitOn(journal, "session-b", "doc-y");
  expect((await journal.wait(other.id)).state).toBe("succeeded");
  // Another document on the same session is a different target too.
  const sibling = await admitOn(journal, "session-a", "doc-y");
  expect((await journal.wait(sibling.id)).state).toBe("succeeded");
});

test("an unknown action on session A, document X blocks A/X and a session-wide action on A", async () => {
  const journal = new ActionJournal(await journalPath());
  const crashed = await crashedOn(journal, "session-a", "doc-x");
  await expect(admitOn(journal, "session-a", "doc-x")).resolves.toMatchObject({
    state: "failed",
    notDispatched: true,
    error: `action '${crashed}' is unknown; recover that attempt before submitting another`,
  });
  await expect(
    invokeCommand(
      journal,
      {
        ...onDocument(randomUUID(), "session-a", "doc-x"),
        target: { kind: "session", session: "session-a" },
      },
      nativeLeaf,
      async () => "done",
    ),
  ).resolves.toMatchObject({
    state: "failed",
    notDispatched: true,
    error: expect.stringContaining("recover that attempt"),
  });
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
  const recover: StepRecovery = (step) =>
    readNativeReceipt(
      step,
      originalProcess,
      sdkRead(state, codes),
      successor
        ? { sdkSessionId: "agent-1", pid: originalProcess.pid + 1, processStartUtcUnixMs: 5000 }
        : undefined,
    );
  const id = await crashedOn(journal, "session-a", "doc-x", recover);
  const recovered = await journal.recover(id);
  expect(recovered).toMatchObject({
    state: "failed",
    status: 503,
    error: `Revit process ${originalProcess.pid} ended before 'scripting.execute' recorded an outcome`,
    evidence: { result: { process: originalProcess, sdk: { state } } },
  });
  expect(recovered).not.toHaveProperty("notDispatched");
  // Settled, so it no longer blocks its own target.
  const next = await admitOn(journal, "session-a", "doc-x");
  expect((await journal.wait(next.id)).state).toBe("succeeded");
});

test("unreadable liveness without a successor process stays unknown", async () => {
  const journal = new ActionJournal(await journalPath());
  let successor: Parameters<typeof readNativeReceipt>[3];
  const recover: StepRecovery = (step) =>
    readNativeReceipt(
      step,
      originalProcess,
      sdkRead("running", ["op.liveness-unknown"]),
      successor,
    );
  const id = await crashedOn(journal, "session-a", "doc-x", recover);
  for (successor of [
    undefined,
    // The session re-registered from the SAME process: nothing proves it died.
    {
      sdkSessionId: "agent-1",
      pid: originalProcess.pid,
      processStartUtcUnixMs: Date.parse(originalProcess.processStartUtc),
    },
  ])
    expect((await journal.recover(id)).state).toBe("unknown");
});
